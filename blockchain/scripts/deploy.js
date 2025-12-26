const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    const PrescriptionRegistry = await hre.ethers.getContractFactory("PrescriptionRegistry");
    const registry = await PrescriptionRegistry.deploy();

    await registry.waitForDeployment(); // Hardhat Runner v2.13+ syntax

    const address = await registry.getAddress();
    console.log(`PrescriptionRegistry deployed to ${address}`);

    // Save ABI and Address to a generic location or just log it
    // For this demo, we can save it to server and client if they exist
    // But let's just log it first.
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
