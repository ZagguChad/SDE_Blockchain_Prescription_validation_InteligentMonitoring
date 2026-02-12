const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PrescriptionRegistryV2", function () {
    let PrescriptionRegistryV2;
    let registry;
    let owner;
    let doctor;
    let pharmacy;
    let otherAccount;

    beforeEach(async function () {
        [owner, doctor, pharmacy, otherAccount] = await ethers.getSigners();

        const PrescriptionRegistryV2Factory = await ethers.getContractFactory("PrescriptionRegistryV2");
        registry = await PrescriptionRegistryV2Factory.deploy();
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
        it("Should allow a doctor to issue a prescription", async function () {
            const id = ethers.encodeBytes32String("rx-001");
            const hash = ethers.keccak256(ethers.toUtf8Bytes("patient-data"));
            const quantity = 10;
            const expiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
            const maxUsage = 1;

            await expect(registry.connect(doctor).issuePrescription(id, hash, quantity, expiry, maxUsage))
                .to.emit(registry, "PrescriptionCreated")
                .withArgs(id, doctor.address, hash);

            const p = await registry.prescriptions(id);
            expect(p.status).to.equal(1); // ACTIVE
            expect(p.issuer).to.equal(doctor.address);
        });

        it("Should fail if non-doctor tries to issue", async function () {
            const id = ethers.encodeBytes32String("rx-002");
            const hash = ethers.keccak256(ethers.toUtf8Bytes("data"));
            await expect(
                registry.connect(otherAccount).issuePrescription(id, hash, 10, Date.now() + 3600, 1)
            ).to.be.revertedWith("Not a doctor");
        });
    });

    describe("Dispensing", function () {
        it("Should allow pharmacy to dispense active prescription", async function () {
            const id = ethers.encodeBytes32String("rx-003");
            const hash = ethers.keccak256(ethers.toUtf8Bytes("data"));
            const expiry = Math.floor(Date.now() / 1000) + 3600;

            await registry.connect(doctor).issuePrescription(id, hash, 10, expiry, 1);

            await expect(registry.connect(pharmacy).dispensePrescription(id))
                .to.emit(registry, "PrescriptionDispensed");

            const p = await registry.prescriptions(id);
            expect(p.usageCount).to.equal(1);
            expect(p.status).to.equal(2); // USED (since maxUsage was 1)
        });

        it("Should prevent double usage if limit reached", async function () {
            const id = ethers.encodeBytes32String("rx-004");
            const hash = ethers.keccak256(ethers.toUtf8Bytes("data"));
            const expiry = Math.floor(Date.now() / 1000) + 3600;

            await registry.connect(doctor).issuePrescription(id, hash, 10, expiry, 1);
            await registry.connect(pharmacy).dispensePrescription(id);

            // Status is now USED, so check for "Prescription not active"
            await expect(
                registry.connect(pharmacy).dispensePrescription(id)
            ).to.be.revertedWith("Prescription not active");
        });
    });

    describe("Expiry", function () {
        it("Should revert and mark as EXPIRED if accessed after date", async function () {
            const id = ethers.encodeBytes32String("rx-005");
            const hash = ethers.keccak256(ethers.toUtf8Bytes("data"));

            // Get current block timestamp to be safe
            const blockNumBefore = await ethers.provider.getBlockNumber();
            const blockBefore = await ethers.provider.getBlock(blockNumBefore);
            const timestamp = blockBefore.timestamp;

            const expiry = timestamp + 1000; // Expire in 1000 seconds

            await registry.connect(doctor).issuePrescription(id, hash, 10, expiry, 1);

            // Increase time by 2000 seconds
            await ethers.provider.send("evm_increaseTime", [2000]);
            await ethers.provider.send("evm_mine");

            await expect(
                registry.connect(pharmacy).dispensePrescription(id)
            ).to.emit(registry, "PrescriptionExpired")
                .withArgs(id);

            const p = await registry.prescriptions(id);
            expect(p.status).to.equal(3); // EXPIRED
        });
    });
});
