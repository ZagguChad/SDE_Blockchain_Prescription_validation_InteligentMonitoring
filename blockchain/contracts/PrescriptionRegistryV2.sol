// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title PrescriptionRegistryV2
 * @dev Upgraded Smart Contract for Secure Digital Prescription System
 * V2.1: Added patientCommitment for self-sovereign patient ownership (ZKP Phase 1).
 * Includes secure lifecycle management, RBAC, double-usage prevention, and audit trails.
 */
contract PrescriptionRegistryV2 {
    
    enum Status { CREATED, ACTIVE, USED, EXPIRED }

    struct Prescription {
        bytes32 id;
        address issuer;              // Doctor who created it
        address pharmacy;            // Pharmacy who last dispensed it (or 0x0)
        address lastUpdater;         // Address that last modified the record
        bytes32 patientHash;         // keccak256(patientName || age)
        bytes32 medicationHash;      // keccak256(medicines JSON)
        bytes32 patientCommitment;   // NEW: keccak256(patientAddress || DOB) — self-sovereign identity
        uint256 quantity;            // Total quantity of meds
        uint256 usageCount;          // Number of times dispensed
        uint256 maxUsage;            // Max allowed dispensations
        uint256 expiryDate;          // Unix timestamp of expiry
        Status status;               // Current lifecycle state
        uint256 timestamp;           // Creation timestamp
    }

    // Storage
    mapping(bytes32 => Prescription) public prescriptions;
    mapping(address => bool) public doctors;
    mapping(address => bool) public pharmacies;

    address public owner;

    // Events
    event PrescriptionCreated(bytes32 indexed id, address indexed issuer, bytes32 patientHash);
    event PrescriptionDispensed(bytes32 indexed id, address indexed pharmacy, uint256 remainingUsage);
    event PrescriptionUsed(bytes32 indexed id, address indexed pharmacy);
    event PrescriptionExpired(bytes32 indexed id);
    event PrescriptionVerified(bytes32 indexed id, address indexed verifier, Status status);
    event PatientOwnershipVerified(bytes32 indexed id, bytes32 commitment);
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
     * @dev Issues a new prescription with patient commitment for self-sovereign identity.
     * @param _id Unique ID of the prescription
     * @param _patientHash Hash of patient identity data (name + age)
     * @param _medicationHash Hash of medication data
     * @param _quantity Total quantity prescribed
     * @param _expiryDate Expiry timestamp
     * @param _maxUsage How many times it can be dispensed
     */
    function issuePrescription(
        bytes32 _id, 
        bytes32 _patientHash,
        bytes32 _medicationHash,
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
            patientHash: _patientHash,
            medicationHash: _medicationHash,
            patientCommitment: bytes32(0), // Set separately via setPatientCommitment
            quantity: _quantity,
            usageCount: 0,
            maxUsage: _maxUsage,
            expiryDate: _expiryDate,
            status: Status.ACTIVE,
            timestamp: block.timestamp
        });

        emit PrescriptionCreated(_id, msg.sender, _patientHash);
    }

    /**
     * @dev Set the patient commitment for a prescription.
     * Can only be called by the issuing doctor, and only once (commitment is immutable).
     * @param _id Prescription ID
     * @param _commitment keccak256(patientAddress || DOB)
     */
    function setPatientCommitment(bytes32 _id, bytes32 _commitment) external onlyDoctor {
        require(prescriptions[_id].id != bytes32(0), "Invalid ID");
        require(prescriptions[_id].issuer == msg.sender, "Not the issuer");
        require(prescriptions[_id].patientCommitment == bytes32(0), "Commitment already set");
        require(_commitment != bytes32(0), "Empty commitment");

        prescriptions[_id].patientCommitment = _commitment;
    }

    /**
     * @dev Verify patient ownership by checking commitment match.
     * Returns true if the provided commitment matches the stored one.
     * @param _id Prescription ID
     * @param _commitment Commitment to verify against
     */
    function verifyPatientOwnership(bytes32 _id, bytes32 _commitment) external view returns (bool) {
        if (prescriptions[_id].id == bytes32(0)) return false;
        if (prescriptions[_id].patientCommitment == bytes32(0)) return false;
        return prescriptions[_id].patientCommitment == _commitment;
    }

    /**
     * @dev Process a dispensation for a prescription.
     */
    function dispensePrescription(bytes32 _id) external onlyPharmacy {
        require(prescriptions[_id].id != bytes32(0), "Invalid ID");
        
        Prescription storage p = prescriptions[_id];

        if (block.timestamp > p.expiryDate) {
            if (p.status != Status.EXPIRED) {
                p.status = Status.EXPIRED;
                p.lastUpdater = msg.sender;
                emit PrescriptionExpired(_id);
            }
            return;
        }

        require(p.status == Status.ACTIVE, "Prescription not active");
        require(p.usageCount < p.maxUsage, "Usage limit reached");

        p.usageCount++;
        p.pharmacy = msg.sender;
        p.lastUpdater = msg.sender;

        emit PrescriptionDispensed(_id, msg.sender, p.maxUsage - p.usageCount);

        if (p.usageCount >= p.maxUsage) {
            p.status = Status.USED;
            emit PrescriptionUsed(_id, msg.sender);
        }
    }

    /**
     * @dev Read-only helper to get prescription status.
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
     * @dev Get the patient commitment for a prescription.
     */
    function getPatientCommitment(bytes32 _id) external view returns (bytes32) {
        return prescriptions[_id].patientCommitment;
    }

    /**
     * @dev Explicitly verify and LOG the verification event on-chain. COSTS GAS.
     */
    function verifyAndLog(bytes32 _id) external onlyPharmacy {
         require(prescriptions[_id].id != bytes32(0), "Invalid ID");
         
         Prescription memory p = prescriptions[_id];
         Status currentStatus = p.status;
         
         if (currentStatus == Status.ACTIVE && block.timestamp > p.expiryDate) {
             currentStatus = Status.EXPIRED; 
         }

         emit PrescriptionVerified(_id, msg.sender, currentStatus);
    }

    // --- Read helpers ---

    /**
     * @dev Verify prescription data integrity by comparing provided hashes with stored ones.
     * Gas-free (view). Used by backend to detect DB tampering at dispense time.
     * @param _id Prescription ID
     * @param _patientHash Recomputed patient hash to verify
     * @param _medHash Recomputed medication hash to verify
     * @return patientMatch Whether patient hash matches
     * @return medMatch Whether medication hash matches
     */
    function verifyPrescriptionHash(
        bytes32 _id,
        bytes32 _patientHash,
        bytes32 _medHash
    ) external view returns (bool patientMatch, bool medMatch) {
        Prescription memory p = prescriptions[_id];
        if (p.id == bytes32(0)) return (false, false);
        return (p.patientHash == _patientHash, p.medicationHash == _medHash);
    }

    function getPrescription(bytes32 _id) external view returns (Prescription memory) {
        return prescriptions[_id];
    }

    // --- Pharmacy Inventory Extension ---

    bytes32 public inventoryRoot; // Merkle root of all inventory batches

    event InventoryRootUpdated(bytes32 indexed newRoot, address indexed updater);

    /**
     * @dev Update the inventory Merkle root. Called by pharmacy after inventory mutations.
     * @param _root New Merkle root computed from all batches
     */
    function updateInventoryRoot(bytes32 _root) external onlyPharmacy {
        inventoryRoot = _root;
        emit InventoryRootUpdated(_root, msg.sender);
    }

    /**
     * @dev Get the current inventory Merkle root.
     */
    function getInventoryRoot() external view returns (bytes32) {
        return inventoryRoot;
    }

    function registerMedicineBatch(string memory _batchId, bytes32 _batchHash) external onlyPharmacy {
        emit BatchRegistered(_batchId, _batchHash, msg.sender);
    }
}
