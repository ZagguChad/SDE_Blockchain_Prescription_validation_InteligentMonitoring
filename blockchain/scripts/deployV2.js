const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying PrescriptionRegistryV2 with account:", deployer.address);

    const PrescriptionRegistryV2 = await hre.ethers.getContractFactory("PrescriptionRegistryV2");
    const registry = await PrescriptionRegistryV2.deploy();

    await registry.waitForDeployment();

    const address = await registry.getAddress();
    console.log(`PrescriptionRegistryV2 deployed to ${address}`);

    // AUTOMATION: Register the deployer as a doctor and pharmacy for immediate testing
    console.log("Registering deployer as a Doctor...");
    const tx = await registry.registerDoctor(deployer.address);
    await tx.wait();
    console.log("Deployer registered as Doctor.");

    console.log("Registering deployer as a Pharmacy...");
    const tx2 = await registry.registerPharmacy(deployer.address);
    await tx2.wait();
    console.log("Deployer registered as Pharmacy.");

    // SAVE ARTIFACTS
    // Note: We are overwriting the specific contractInfo.json used by the app.
    // If the app needs to support BOTH V1 and V2 simultaneousy, we should rename this.
    // For this upgrade, we assume V2 replaces V1.
    const clientArtifactPath = path.join(__dirname, "../../client/src/contractInfo.json");
    const serverArtifactPath = path.join(__dirname, "../../server/contractInfo.json");

    const artifactData = {
        address: address,
        abi: JSON.parse(registry.interface.formatJson())
    };

    // Ensure client directory exists
    const clientDir = path.dirname(clientArtifactPath);
    if (!fs.existsSync(clientDir)) {
        fs.mkdirSync(clientDir, { recursive: true });
    }
    fs.writeFileSync(clientArtifactPath, JSON.stringify(artifactData, null, 2));
    console.log(`Contract metadata saved to ${clientArtifactPath}`);

    // Ensure server directory exists
    const serverDir = path.dirname(serverArtifactPath);
    if (!fs.existsSync(serverDir)) {
        fs.mkdirSync(serverDir, { recursive: true });
    }
    fs.writeFileSync(serverArtifactPath, JSON.stringify(artifactData, null, 2));
    console.log(`Contract metadata saved to ${serverArtifactPath}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
