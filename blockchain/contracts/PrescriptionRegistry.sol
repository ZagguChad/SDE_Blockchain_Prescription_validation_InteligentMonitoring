// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract PrescriptionRegistry {
    
    enum Status { ISSUED, DISPENSED }

    struct Prescription {
        bytes32 id;
        address issuer;
        bytes32 patientHash;
        bytes32 medicationHash;
        uint256 quantity; // or other metadata
        uint256 expiryDate; // New validation field
        Status status;
        uint256 timestamp;
    }

    mapping(bytes32 => Prescription) public prescriptions;
    mapping(address => bool) public doctors;
    mapping(address => bool) public pharmacies;

    address public owner;
    // uint256 public prescriptionCount; // Removed as we use custom IDs

    event PrescriptionIssued(bytes32 indexed id, address indexed issuer, bytes32 patientHash);
    event PrescriptionDispensed(bytes32 indexed id, address indexed pharmacy);
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

    function issuePrescription(bytes32 _id, bytes32 _patientHash, bytes32 _medicationHash, uint256 _quantity, uint256 _expiryDate) external onlyDoctor {
        require(prescriptions[_id].id == bytes32(0), "ID already exists");
        require(_expiryDate > block.timestamp, "Expiry must be in future");
        
        prescriptions[_id] = Prescription({
            id: _id,
            issuer: msg.sender,
            patientHash: _patientHash,
            medicationHash: _medicationHash,
            quantity: _quantity,
            expiryDate: _expiryDate,
            status: Status.ISSUED,
            timestamp: block.timestamp
        });

        emit PrescriptionIssued(_id, msg.sender, _patientHash);
    }

    function dispensePrescription(bytes32 _id) external onlyPharmacy {
        require(prescriptions[_id].id != bytes32(0), "Invalid ID");
        require(prescriptions[_id].status == Status.ISSUED, "Already dispensed");
        require(block.timestamp <= prescriptions[_id].expiryDate, "Prescription expired");

        prescriptions[_id].status = Status.DISPENSED;
        emit PrescriptionDispensed(_id, msg.sender);
    }

    function getPrescription(bytes32 _id) external view returns (Prescription memory) {
        return prescriptions[_id];
    }
    
    function verifyPrescription(bytes32 _id) external view returns (bool, Status) {
        if (prescriptions[_id].id == bytes32(0)) return (false, Status.ISSUED);
        return (true, prescriptions[_id].status);
    }
}
