const hre = require("hardhat");
const contractInfo = require("../../client/src/contractInfo.json");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Interacting with account:", deployer.address);

    const contractAddress = contractInfo.address;
    if (!contractAddress) {
        throw new Error("Contract address not found in contractInfo.json");
    }

    const PrescriptionRegistry = await hre.ethers.getContractFactory("PrescriptionRegistry");
    const contract = PrescriptionRegistry.attach(contractAddress);

    console.log(`Registering ${deployer.address} as a Pharmacy...`);

    try {
        const tx = await contract.registerPharmacy(deployer.address);
        await tx.wait();
        console.log("✅ Success! Account registered as Pharmacy.");
    } catch (error) {
        console.error("❌ Error registering pharmacy:", error.message);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
