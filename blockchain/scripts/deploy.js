const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    const PrescriptionRegistry = await hre.ethers.getContractFactory("PrescriptionRegistry");
    const registry = await PrescriptionRegistry.deploy();

    await registry.waitForDeployment(); // Hardhat Runner v2.13+ syntax

    const address = await registry.getAddress();
    console.log(`PrescriptionRegistry deployed to ${address}`);

    // AUTOMATION: Register the deployer as a doctor so validation works immediately
    console.log("Registering deployer as a doctor...");
    const tx = await registry.registerDoctor(deployer.address);
    await tx.wait();
    console.log("Deployer registered as Doctor.");

    // AUTOMATION: Register deployer as PHARMACY for testing/dispensing
    console.log("Registering deployer as a Pharmacy...");
    const tx2 = await registry.registerPharmacy(deployer.address);
    await tx2.wait();
    console.log("Deployer registered as Pharmacy.");

    // SAVE ARTIFACTS
    const artifactPath = path.join(__dirname, "../../client/src/contractInfo.json");
    const artifactData = {
        address: address,
        abi: JSON.parse(registry.interface.formatJson())
    };

    // Ensure directory exists
    const dir = path.dirname(artifactPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(artifactPath, JSON.stringify(artifactData, null, 2));
    console.log(`Contract metadata saved to ${artifactPath}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
