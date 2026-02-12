const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
const PrescriptionLog = require('../models/PrescriptionLog');

async function startBlockchainListener() {
    try {
        const artifactPath = path.join(__dirname, '../contractInfo.json');

        if (!fs.existsSync(artifactPath)) {
            console.log("⚠️ Contract info not found. Skipping listener start.");
            return;
        }

        const { address, abi } = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

        // Connect to local Hardhat network
        // Note: Make sure Hardhat node is running on 8545
        const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");

        const contract = new ethers.Contract(address, abi, provider);

        console.log(`🎧 Listening for events on contract: ${address}`);

        // Listen for PrescriptionCreated
        contract.on("PrescriptionCreated", (id, issuer, patientHash, event) => {
            console.log(`✨ Event: PrescriptionCreated [ID: ${id}]`);
            // Creation is usually handled by the layout POST request, but we could log extra info here
        });

        // Listen for PrescriptionDispensed
        contract.on("PrescriptionDispensed", async (id, pharmacy, remainingUsage, event) => {
            // Decode bytes32 to string for DB lookup
            let decodedId;
            try { decodedId = ethers.decodeBytes32String(id); } catch { decodedId = id; }
            console.log(`💊 Event: PrescriptionDispensed [ID: ${decodedId}] Remaining: ${remainingUsage}`);

            try {
                // Update DB status using findOneAndUpdate
                const update = {
                    $inc: { usageCount: 1 }
                };

                // If remaining usage is 0, mark as USED
                if (Number(remainingUsage) === 0) {
                    update.status = 'USED';
                }

                await PrescriptionLog.findOneAndUpdate(
                    { blockchainId: decodedId },
                    update
                );
                console.log(`✅ DB Updated for dispensed prescription ${decodedId}`);
            } catch (err) {
                console.error("Error updating DB on Dispense:", err);
            }
        });

        // Listen for PrescriptionExpired
        contract.on("PrescriptionExpired", async (id, event) => {
            let decodedId;
            try { decodedId = ethers.decodeBytes32String(id); } catch { decodedId = id; }
            console.log(`⏰ Event: PrescriptionExpired [ID: ${decodedId}]`);
            try {
                await PrescriptionLog.findOneAndUpdate(
                    { blockchainId: decodedId },
                    { status: 'EXPIRED' }
                );
                console.log(`✅ DB Updated for expired prescription ${decodedId}`);
            } catch (err) {
                console.error("Error updating DB on Expiry:", err);
            }
        });

    } catch (error) {
        console.error("Failed to start blockchain listener:", error);
    }
}

module.exports = startBlockchainListener;
