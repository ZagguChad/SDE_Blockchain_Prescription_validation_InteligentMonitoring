// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract PrescriptionRegistry {
    
    enum Status { ISSUED, DISPENSED }

    struct Prescription {
        uint256 id;
        address issuer;
        bytes32 patientHash;
        bytes32 medicationHash;
        uint256 quantity; // or other metadata
        Status status;
        uint256 timestamp;
    }

    mapping(uint256 => Prescription) public prescriptions;
    mapping(address => bool) public doctors;
    mapping(address => bool) public pharmacies;

    address public owner;
    uint256 public prescriptionCount;

    event PrescriptionIssued(uint256 indexed id, address indexed issuer, bytes32 patientHash);
    event PrescriptionDispensed(uint256 indexed id, address indexed pharmacy);
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

    function issuePrescription(bytes32 _patientHash, bytes32 _medicationHash, uint256 _quantity) external {
        prescriptionCount++;
        prescriptions[prescriptionCount] = Prescription({
            id: prescriptionCount,
            issuer: msg.sender,
            patientHash: _patientHash,
            medicationHash: _medicationHash,
            quantity: _quantity,
            status: Status.ISSUED,
            timestamp: block.timestamp
        });

        emit PrescriptionIssued(prescriptionCount, msg.sender, _patientHash);
    }

    function dispensePrescription(uint256 _id) external onlyPharmacy {
        require(_id > 0 && _id <= prescriptionCount, "Invalid ID");
        require(prescriptions[_id].status == Status.ISSUED, "Already dispensed or invalid");

        prescriptions[_id].status = Status.DISPENSED;
        emit PrescriptionDispensed(_id, msg.sender);
    }

    function getPrescription(uint256 _id) external view returns (Prescription memory) {
        return prescriptions[_id];
    }
    
    function verifyPrescription(uint256 _id) external view returns (bool, Status) {
        if (_id == 0 || _id > prescriptionCount) return (false, Status.ISSUED);
        return (true, prescriptions[_id].status);
    }
}
