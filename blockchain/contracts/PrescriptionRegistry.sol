// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract PrescriptionRegistry {
    
    enum Status { CREATED, ACTIVE, USED, EXPIRED }

    struct Prescription {
        bytes32 id;
        address issuer;
        bytes32 patientHash;
        bytes32 medicationHash;
        uint256 quantity; 
        uint256 usageCount; // New: Track usage
        uint256 maxUsage;   // New: Max allowed usage
        uint256 expiryDate; 
        Status status;
        uint256 timestamp;
    }

    mapping(bytes32 => Prescription) public prescriptions;
    mapping(address => bool) public doctors;
    mapping(address => bool) public pharmacies;

    address public owner;

    event PrescriptionCreated(bytes32 indexed id, address indexed issuer, bytes32 patientHash); // Renamed from Issued
    event PrescriptionDispensed(bytes32 indexed id, address indexed pharmacy, uint256 remainingUsage); // Updated
    event PrescriptionExpired(bytes32 indexed id); // New
    event RoleGranted(bytes32 role, address indexed account);

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

    function registerDoctor(address _doctor) external onlyOwner {
        doctors[_doctor] = true;
        emit RoleGranted(keccak256("DOCTOR"), _doctor);
    }

    function registerPharmacy(address _pharmacy) external onlyOwner {
        pharmacies[_pharmacy] = true;
        emit RoleGranted(keccak256("PHARMACY"), _pharmacy);
    }

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
            patientHash: _patientHash,
            medicationHash: _medicationHash,
            quantity: _quantity,
            usageCount: 0,
            maxUsage: _maxUsage,
            expiryDate: _expiryDate,
            status: Status.ACTIVE, // Created directly as ACTIVE
            timestamp: block.timestamp
        });

        emit PrescriptionCreated(_id, msg.sender, _patientHash);
    }

    function dispensePrescription(bytes32 _id) external onlyPharmacy {
        require(prescriptions[_id].id != bytes32(0), "Invalid ID");
        
        Prescription storage p = prescriptions[_id];

        // Check Expiry
        if (block.timestamp > p.expiryDate) {
            p.status = Status.EXPIRED;
            emit PrescriptionExpired(_id);
            revert("Prescription expired");
        }

        require(p.status == Status.ACTIVE, "Not active");
        require(p.usageCount < p.maxUsage, "Usage limit reached");

        p.usageCount++;

        if (p.usageCount >= p.maxUsage) {
            p.status = Status.USED;
        }

        emit PrescriptionDispensed(_id, msg.sender, p.maxUsage - p.usageCount);
    }

    function getPrescription(bytes32 _id) external view returns (Prescription memory) {
        return prescriptions[_id];
    }
    
    function verifyPrescription(bytes32 _id) external view returns (bool, Status, uint256 remaining) {
        if (prescriptions[_id].id == bytes32(0)) return (false, Status.CREATED, 0);
        
        Prescription memory p = prescriptions[_id];
        
        // Dynamic status check for view
        Status currentStatus = p.status;
        if (currentStatus == Status.ACTIVE && block.timestamp > p.expiryDate) {
            currentStatus = Status.EXPIRED;
        }

        uint256 rem = (p.maxUsage > p.usageCount) ? (p.maxUsage - p.usageCount) : 0;
        return (true, currentStatus, rem);
    }
    // --- Inventory / Batch Logic ---
    event BatchRegistered(string batchId, bytes32 hash, address indexed pharmacy);

    function registerBatch(string memory _batchId, bytes32 _hash) external onlyPharmacy {
        emit BatchRegistered(_batchId, _hash, msg.sender);
    }
}
