const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PrescriptionRegistryV2", function () {
    let registry;
    let owner;
    let doctor;
    let pharmacy;
    let otherAccount;

    // Helper: create standard test params for issuePrescription (6 params)
    function makeRxParams(idStr = "rx-001") {
        const id = ethers.encodeBytes32String(idStr);
        const patientHash = ethers.keccak256(ethers.toUtf8Bytes("patient-data"));
        const medHash = ethers.keccak256(ethers.toUtf8Bytes("med-data"));
        const quantity = 10;
        const expiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour
        const maxUsage = 1;
        return { id, patientHash, medHash, quantity, expiry, maxUsage };
    }

    beforeEach(async function () {
        [owner, doctor, pharmacy, otherAccount] = await ethers.getSigners();

        const Factory = await ethers.getContractFactory("PrescriptionRegistryV2");
        registry = await Factory.deploy();
        await registry.waitForDeployment();

        // Setup Roles
        await registry.registerDoctor(doctor.address);
        await registry.registerPharmacy(pharmacy.address);
    });

    describe("Deployment", function () {
        it("Should set the right owner", async function () {
            expect(await registry.owner()).to.equal(owner.address);
        });

        it("Should register doctor correctly", async function () {
            expect(await registry.doctors(doctor.address)).to.equal(true);
        });

        it("Should register pharmacy correctly", async function () {
            expect(await registry.pharmacies(pharmacy.address)).to.equal(true);
        });
    });

    describe("Issuance", function () {
        it("Should allow a doctor to issue a prescription (6 params)", async function () {
            const { id, patientHash, medHash, quantity, expiry, maxUsage } = makeRxParams("rx-001");

            await expect(registry.connect(doctor).issuePrescription(id, patientHash, medHash, quantity, expiry, maxUsage))
                .to.emit(registry, "PrescriptionCreated")
                .withArgs(id, doctor.address, patientHash);

            const p = await registry.getPrescription(id);
            expect(p.status).to.equal(1); // ACTIVE
            expect(p.issuer).to.equal(doctor.address);
            expect(p.patientCommitment).to.equal(ethers.ZeroHash); // Not set yet
        });

        it("Should fail if non-doctor tries to issue", async function () {
            const { id, patientHash, medHash, quantity, expiry, maxUsage } = makeRxParams("rx-002");
            await expect(
                registry.connect(otherAccount).issuePrescription(id, patientHash, medHash, quantity, expiry, maxUsage)
            ).to.be.revertedWith("Not a doctor");
        });
    });

    describe("Dispensing", function () {
        it("Should allow pharmacy to dispense active prescription", async function () {
            const { id, patientHash, medHash, quantity, expiry, maxUsage } = makeRxParams("rx-003");

            await registry.connect(doctor).issuePrescription(id, patientHash, medHash, quantity, expiry, maxUsage);

            await expect(registry.connect(pharmacy).dispensePrescription(id))
                .to.emit(registry, "PrescriptionDispensed");

            const p = await registry.getPrescription(id);
            expect(p.usageCount).to.equal(1);
            expect(p.status).to.equal(2); // USED (maxUsage was 1)
        });

        it("Should prevent double usage if limit reached", async function () {
            const { id, patientHash, medHash, quantity, expiry, maxUsage } = makeRxParams("rx-004");

            await registry.connect(doctor).issuePrescription(id, patientHash, medHash, quantity, expiry, maxUsage);
            await registry.connect(pharmacy).dispensePrescription(id);

            await expect(
                registry.connect(pharmacy).dispensePrescription(id)
            ).to.be.revertedWith("Prescription not active");
        });
    });

    describe("Expiry", function () {
        it("Should mark as EXPIRED if accessed after expiry date", async function () {
            const id = ethers.encodeBytes32String("rx-005");
            const hash = ethers.keccak256(ethers.toUtf8Bytes("data"));
            const medHash = ethers.keccak256(ethers.toUtf8Bytes("med"));

            const blockNumBefore = await ethers.provider.getBlockNumber();
            const blockBefore = await ethers.provider.getBlock(blockNumBefore);
            const timestamp = blockBefore.timestamp;
            const expiry = timestamp + 1000;

            await registry.connect(doctor).issuePrescription(id, hash, medHash, 10, expiry, 1);

            // Fast-forward past expiry
            await ethers.provider.send("evm_increaseTime", [2000]);
            await ethers.provider.send("evm_mine");

            await expect(
                registry.connect(pharmacy).dispensePrescription(id)
            ).to.emit(registry, "PrescriptionExpired")
                .withArgs(id);

            const p = await registry.getPrescription(id);
            expect(p.status).to.equal(3); // EXPIRED
        });
    });

    // =========================================================================
    // NEW: Patient Commitment Tests (ZKP Phase 1)
    // =========================================================================
    describe("Patient Commitment", function () {
        let rxId;
        let patientWallet;
        let commitment;

        beforeEach(async function () {
            rxId = ethers.encodeBytes32String("rx-zkp");
            const patientHash = ethers.keccak256(ethers.toUtf8Bytes("patient"));
            const medHash = ethers.keccak256(ethers.toUtf8Bytes("meds"));
            const expiry = Math.floor(Date.now() / 1000) + 3600;

            await registry.connect(doctor).issuePrescription(rxId, patientHash, medHash, 5, expiry, 1);

            // Generate patient identity
            patientWallet = ethers.Wallet.createRandom();
            const dobString = "01011990";
            commitment = ethers.keccak256(
                ethers.solidityPacked(
                    ['address', 'string'],
                    [patientWallet.address, dobString]
                )
            );
        });

        it("Should allow issuing doctor to set patient commitment", async function () {
            await registry.connect(doctor).setPatientCommitment(rxId, commitment);

            const stored = await registry.getPatientCommitment(rxId);
            expect(stored).to.equal(commitment);
        });

        it("Should reject setPatientCommitment from non-issuer doctor", async function () {
            // Register another doctor
            await registry.registerDoctor(otherAccount.address);

            await expect(
                registry.connect(otherAccount).setPatientCommitment(rxId, commitment)
            ).to.be.revertedWith("Not the issuer");
        });

        it("Should reject setting commitment twice (immutable)", async function () {
            await registry.connect(doctor).setPatientCommitment(rxId, commitment);

            const otherCommitment = ethers.keccak256(ethers.toUtf8Bytes("different"));
            await expect(
                registry.connect(doctor).setPatientCommitment(rxId, otherCommitment)
            ).to.be.revertedWith("Commitment already set");
        });

        it("Should reject empty commitment", async function () {
            await expect(
                registry.connect(doctor).setPatientCommitment(rxId, ethers.ZeroHash)
            ).to.be.revertedWith("Empty commitment");
        });

        it("Should verify correct patient ownership", async function () {
            await registry.connect(doctor).setPatientCommitment(rxId, commitment);

            const result = await registry.verifyPatientOwnership(rxId, commitment);
            expect(result).to.equal(true);
        });

        it("Should reject wrong commitment in verifyPatientOwnership", async function () {
            await registry.connect(doctor).setPatientCommitment(rxId, commitment);

            const wrongCommitment = ethers.keccak256(ethers.toUtf8Bytes("wrong"));
            const result = await registry.verifyPatientOwnership(rxId, wrongCommitment);
            expect(result).to.equal(false);
        });

        it("Should return false for prescription without commitment set", async function () {
            // Commitment not set yet
            const result = await registry.verifyPatientOwnership(rxId, commitment);
            expect(result).to.equal(false);
        });

        it("Should return false for non-existent prescription", async function () {
            const fakeId = ethers.encodeBytes32String("fake");
            const result = await registry.verifyPatientOwnership(fakeId, commitment);
            expect(result).to.equal(false);
        });

        it("Should still allow dispensing regardless of commitment", async function () {
            // Commitment is for patient auth, not dispense gating
            await registry.connect(doctor).setPatientCommitment(rxId, commitment);

            await expect(registry.connect(pharmacy).dispensePrescription(rxId))
                .to.emit(registry, "PrescriptionDispensed");
        });
    });

    // =========================================================================
    // NEW: Prescription Hash Integrity Verification Tests (ZKP Phase 2)
    // =========================================================================
    describe("Hash Integrity Verification", function () {
        it("Should verify correct hashes", async function () {
            const { id, patientHash, medHash, quantity, expiry, maxUsage } = makeRxParams("rx-hash1");
            await registry.connect(doctor).issuePrescription(id, patientHash, medHash, quantity, expiry, maxUsage);

            const [patientMatch, medMatch] = await registry.verifyPrescriptionHash(id, patientHash, medHash);
            expect(patientMatch).to.equal(true);
            expect(medMatch).to.equal(true);
        });

        it("Should reject wrong patient hash", async function () {
            const { id, patientHash, medHash, quantity, expiry, maxUsage } = makeRxParams("rx-hash2");
            await registry.connect(doctor).issuePrescription(id, patientHash, medHash, quantity, expiry, maxUsage);

            const wrongHash = ethers.keccak256(ethers.toUtf8Bytes("tampered"));
            const [patientMatch, medMatch] = await registry.verifyPrescriptionHash(id, wrongHash, medHash);
            expect(patientMatch).to.equal(false);
            expect(medMatch).to.equal(true);
        });

        it("Should reject wrong medication hash", async function () {
            const { id, patientHash, medHash, quantity, expiry, maxUsage } = makeRxParams("rx-hash3");
            await registry.connect(doctor).issuePrescription(id, patientHash, medHash, quantity, expiry, maxUsage);

            const wrongHash = ethers.keccak256(ethers.toUtf8Bytes("wrong-meds"));
            const [patientMatch, medMatch] = await registry.verifyPrescriptionHash(id, patientHash, wrongHash);
            expect(patientMatch).to.equal(true);
            expect(medMatch).to.equal(false);
        });

        it("Should return false/false for non-existent prescription", async function () {
            const fakeId = ethers.encodeBytes32String("fake-rx");
            const hash = ethers.keccak256(ethers.toUtf8Bytes("data"));
            const [patientMatch, medMatch] = await registry.verifyPrescriptionHash(fakeId, hash, hash);
            expect(patientMatch).to.equal(false);
            expect(medMatch).to.equal(false);
        });
    });

    // =========================================================================
    // NEW: Inventory Merkle Root Tests (ZKP Phase 3)
    // =========================================================================
    describe("Inventory Merkle Root", function () {
        it("Should have zero initial inventory root", async function () {
            const root = await registry.getInventoryRoot();
            expect(root).to.equal(ethers.ZeroHash);
        });

        it("Should allow pharmacy to update inventory root", async function () {
            const newRoot = ethers.keccak256(ethers.toUtf8Bytes("inventory-state-1"));
            await expect(registry.connect(pharmacy).updateInventoryRoot(newRoot))
                .to.emit(registry, "InventoryRootUpdated")
                .withArgs(newRoot, pharmacy.address);

            expect(await registry.getInventoryRoot()).to.equal(newRoot);
        });

        it("Should reject non-pharmacy updating inventory root", async function () {
            const root = ethers.keccak256(ethers.toUtf8Bytes("fake"));
            await expect(registry.connect(doctor).updateInventoryRoot(root))
                .to.be.revertedWith("Not a pharmacy");
        });

        it("Should update root multiple times", async function () {
            const root1 = ethers.keccak256(ethers.toUtf8Bytes("state-1"));
            const root2 = ethers.keccak256(ethers.toUtf8Bytes("state-2"));

            await registry.connect(pharmacy).updateInventoryRoot(root1);
            expect(await registry.getInventoryRoot()).to.equal(root1);

            await registry.connect(pharmacy).updateInventoryRoot(root2);
            expect(await registry.getInventoryRoot()).to.equal(root2);
        });
    });
});
