// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title PrescriptionRegistryV2
 * @dev Upgraded Smart Contract for Secure Digital Prescription System
 * Includes secure lifecycle management, RBAC, double-usage prevention, and audit trails.
 */
contract PrescriptionRegistryV2 {
    
    enum Status { CREATED, ACTIVE, USED, EXPIRED }

    struct Prescription {
        bytes32 id;
        address issuer;          // Doctor who created it
        address pharmacy;        // Pharmacy who last dispensed it (or 0x0 if not used)
        address lastUpdater;      // Address that last modified the record
        bytes32 prescriptionHash; // Hash of off-chain details (patient, meds, diagnosis) - replaces raw data
        uint256 quantity;         // Total quantity of meds (informational/validation)
        uint256 usageCount;       // Number of times dispensed
        uint256 maxUsage;         // Max allowed dispensations
        uint256 expiryDate;       // Unix timestamp of expiry
        Status status;            // Current lifecycle state
        uint256 timestamp;        // Creation timestamp
    }

    // Storage
    mapping(bytes32 => Prescription) public prescriptions;
    mapping(address => bool) public doctors;
    mapping(address => bool) public pharmacies;

    address public owner;

    // Events
    event PrescriptionCreated(bytes32 indexed id, address indexed issuer, bytes32 prescriptionHash);
    event PrescriptionDispensed(bytes32 indexed id, address indexed pharmacy, uint256 remainingUsage);
    event PrescriptionUsed(bytes32 indexed id, address indexed pharmacy); // Fired when fully used
    event PrescriptionExpired(bytes32 indexed id);
    event PrescriptionVerified(bytes32 indexed id, address indexed verifier, Status status); // For audit trail
    event RoleGranted(bytes32 role, address indexed account);
    event BatchRegistered(string batchId, bytes32 hash, address indexed pharmacy);

    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyDoctor() {
        require(doctors[msg.sender], "Not a doctor");
        _;
    }

    modifier onlyPharmacy() {
        require(pharmacies[msg.sender], "Not a pharmacy");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // --- Role Management ---

    function registerDoctor(address _doctor) external onlyOwner {
        doctors[_doctor] = true;
        emit RoleGranted(keccak256("DOCTOR"), _doctor);
    }

    function registerPharmacy(address _pharmacy) external onlyOwner {
        pharmacies[_pharmacy] = true;
        emit RoleGranted(keccak256("PHARMACY"), _pharmacy);
    }

    // --- Prescription Lifecycle ---

    /**
     * @dev Issues a new prescription.
     * @param _id Unique ID of the prescription (generated off-chain)
     * @param _prescriptionHash Hash of the critical prescription data (integrity check)
     * @param _quantity Total quantity prescribed (optional, can be 0 if handled off-chain)
     * @param _expiryDate Expiry timestamp
     * @param _maxUsage How many times it can be dispensed (e.g., refills)
     */
    function issuePrescription(
        bytes32 _id, 
        bytes32 _prescriptionHash, 
        uint256 _quantity, 
        uint256 _expiryDate,
        uint256 _maxUsage
    ) external onlyDoctor {
        require(prescriptions[_id].id == bytes32(0), "ID already exists");
        require(_expiryDate > block.timestamp, "Expiry must be in future");
        require(_maxUsage > 0, "Max usage must be > 0");
        
        prescriptions[_id] = Prescription({
            id: _id,
            issuer: msg.sender,
            pharmacy: address(0),
            lastUpdater: msg.sender,
            prescriptionHash: _prescriptionHash,
            quantity: _quantity,
            usageCount: 0,
            maxUsage: _maxUsage,
            expiryDate: _expiryDate,
            status: Status.ACTIVE,
            timestamp: block.timestamp
        });

        emit PrescriptionCreated(_id, msg.sender, _prescriptionHash);
    }

    /**
     * @dev Process a dispensation for a prescription.
     * Checks expiry, usage limits, and active status.
     * Updates usage count and status.
     */
    function dispensePrescription(bytes32 _id) external onlyPharmacy {
        require(prescriptions[_id].id != bytes32(0), "Invalid ID");
        
        Prescription storage p = prescriptions[_id];

        // 1. Check Expiry first
        if (block.timestamp > p.expiryDate) {
            if (p.status != Status.EXPIRED) {
                p.status = Status.EXPIRED;
                p.lastUpdater = msg.sender;
                emit PrescriptionExpired(_id);
            }
            return; // Stop execution but allow state change to persist
        }

        // 2. Validate State
        require(p.status == Status.ACTIVE, "Prescription not active");
        require(p.usageCount < p.maxUsage, "Usage limit reached");

        // 3. Update State
        p.usageCount++;
        p.pharmacy = msg.sender; // Record who dispensed it
        p.lastUpdater = msg.sender;

        emit PrescriptionDispensed(_id, msg.sender, p.maxUsage - p.usageCount);

        // 4. Transition to USED only if max usage reached
        if (p.usageCount >= p.maxUsage) {
            p.status = Status.USED;
            emit PrescriptionUsed(_id, msg.sender);
        }
    }

    /**
     * @dev Read-only helper to get status.
     * Does NOT consume gas unless called in a transaction.
     * Calculates derived status (e.g. checks expiry) without modifying state.
     */
    function verifyPrescription(bytes32 _id) external view returns (
        bool exists, 
        Status status, 
        uint256 remainingUsage,
        address issuer,
        uint256 expiry
    ) {
        if (prescriptions[_id].id == bytes32(0)) {
            return (false, Status.CREATED, 0, address(0), 0);
        }
        
        Prescription memory p = prescriptions[_id];
        
        Status currentStatus = p.status;
        if (currentStatus == Status.ACTIVE && block.timestamp > p.expiryDate) {
            currentStatus = Status.EXPIRED;
        }

        uint256 rem = (p.maxUsage > p.usageCount) ? (p.maxUsage - p.usageCount) : 0;
        
        return (true, currentStatus, rem, p.issuer, p.expiryDate);
    }

    /**
     * @dev Explicitly verify and LOG the verification event on-chain.
     * Useful for auditing who checked a prescription and when.
     * COSTS GAS.
     */
    function verifyAndLog(bytes32 _id) external onlyPharmacy {
         require(prescriptions[_id].id != bytes32(0), "Invalid ID");
         
         Prescription memory p = prescriptions[_id];
         Status currentStatus = p.status;
         
         // Update derived status if needed for the log
         if (currentStatus == Status.ACTIVE && block.timestamp > p.expiryDate) {
             currentStatus = Status.EXPIRED; 
             // Note: We are not auto-updating storage here to save gas, just accurate logging.
             // Auto-update happens on 'dispense' attempt.
         }

         emit PrescriptionVerified(_id, msg.sender, currentStatus);
    }

    // --- Pharmacy Inventory Extension ---

    function registerMedicineBatch(string memory _batchId, bytes32 _batchHash) external onlyPharmacy {
        emit BatchRegistered(_batchId, _batchHash, msg.sender);
    }
}
