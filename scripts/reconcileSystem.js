/**
 * BlockRx System Reconciliation Script
 * 
 * Compares prescription hashes across DB and blockchain,
 * verifies inventory Merkle root, and reports mismatches.
 * 
 * Usage: node scripts/reconcileSystem.js [--fix]
 * 
 * Requires: MongoDB running, Hardhat node running
 */

require('dotenv').config({ path: require('path').join(__dirname, '../server/.env') });
const mongoose = require('mongoose');
const { ethers } = require('ethers');

// Import models and utilities
const PrescriptionLog = require('../server/models/PrescriptionLog');
const Inventory = require('../server/models/Inventory');
const { decrypt } = require('../server/utils/encryption');
const { canonicalPatientHash, canonicalMedicationHash } = require('../server/utils/canonicalSnapshot');
const { verifyInventoryRoot } = require('../server/utils/inventoryMerkle');

const FIX_MODE = process.argv.includes('--fix');

async function main() {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║        BlockRx System Reconciliation Tool        ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log(`Mode: ${FIX_MODE ? '🔧 FIX (will update DB)' : '🔍 AUDIT (read-only)'}\n`);

    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/prescription_system';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // Connect to Blockchain
    const contractInfo = require('../server/contractInfo.json');
    const provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC || 'http://127.0.0.1:8545');
    const contract = new ethers.Contract(contractInfo.address, contractInfo.abi, provider);
    console.log(`✅ Connected to contract: ${contractInfo.address}\n`);

    // ── SECTION 1: Prescription Hash Reconciliation ──
    console.log('━━━ PRESCRIPTION HASH RECONCILIATION ━━━\n');
    const prescriptions = await PrescriptionLog.find({}).lean();
    console.log(`Found ${prescriptions.length} prescriptions in DB\n`);

    let matchCount = 0;
    let mismatchCount = 0;
    let notOnChainCount = 0;
    const mismatches = [];

    for (const rx of prescriptions) {
        try {
            const idBytes = ethers.encodeBytes32String(rx.blockchainId);
            const onChain = await contract.getPrescription(idBytes);

            if (onChain.id === ethers.ZeroHash) {
                notOnChainCount++;
                console.log(`  ⚪ ${rx.blockchainId}: Not on blockchain${rx.blockchainSynced ? ' (marked synced!)' : ''}`);
                if (FIX_MODE && rx.blockchainSynced) {
                    await PrescriptionLog.updateOne(
                        { _id: rx._id },
                        { $set: { blockchainSynced: false } }
                    );
                    console.log(`    🔧 Fixed: set blockchainSynced=false`);
                }
                continue;
            }

            // Recompute canonical hashes (NO instructions — matches canonicalSnapshot.js)
            const plainPatientName = decrypt(rx.patientName);
            const plainMedicines = (rx.medicines || []).map(m => ({
                name: m.name || '',
                dosage: m.dosage || '',
                quantity: m.quantity
            }));

            const recomputedPatientHash = canonicalPatientHash(plainPatientName, rx.patientAge);
            const recomputedMedHash = canonicalMedicationHash(plainMedicines);

            const patientMatch = recomputedPatientHash === onChain.patientHash;
            const medMatch = recomputedMedHash === onChain.medicationHash;

            if (patientMatch && medMatch) {
                matchCount++;
                console.log(`  ✅ ${rx.blockchainId}: Hashes match`);
            } else {
                mismatchCount++;
                const detail = {
                    id: rx.blockchainId,
                    patientMatch,
                    medMatch,
                    onChainPatientHash: onChain.patientHash,
                    recomputedPatientHash,
                    onChainMedHash: onChain.medicationHash,
                    recomputedMedHash
                };
                mismatches.push(detail);
                console.log(`  ❌ ${rx.blockchainId}: MISMATCH — patient:${patientMatch} med:${medMatch}`);
                console.log(`     On-chain P: ${onChain.patientHash}`);
                console.log(`     Recomp  P: ${recomputedPatientHash}`);
                console.log(`     On-chain M: ${onChain.medicationHash}`);
                console.log(`     Recomp  M: ${recomputedMedHash}`);

                if (FIX_MODE) {
                    // Flag as tampered (don't auto-fix hash — that would hide tampering)
                    await PrescriptionLog.updateOne(
                        { _id: rx._id },
                        { $set: { hashVerified: false, hashVerifiedAt: new Date() } }
                    );
                    console.log(`    🔧 Flagged: hashVerified=false`);
                }
            }
        } catch (err) {
            console.log(`  ⚠️ ${rx.blockchainId}: Error — ${err.message}`);
        }
    }

    console.log(`\nSummary: ${matchCount} match, ${mismatchCount} mismatch, ${notOnChainCount} not on-chain\n`);

    // ── SECTION 2: Inventory Merkle Root Verification ──
    console.log('━━━ INVENTORY MERKLE ROOT VERIFICATION ━━━\n');
    try {
        const result = await verifyInventoryRoot();
        if (result.valid) {
            console.log(`  ✅ Inventory Merkle root matches (${result.batchCount} batches)`);
            console.log(`     Root: ${result.currentRoot}`);
        } else {
            console.log(`  ❌ Inventory Merkle root MISMATCH`);
            console.log(`     DB root:      ${result.currentRoot}`);
            console.log(`     On-chain root: ${result.onChainRoot}`);
            console.log(`     Batches: ${result.batchCount}`);
        }
    } catch (err) {
        console.log(`  ⚠️ Inventory verification failed: ${err.message}`);
    }

    // ── SECTION 3: Status Summary ──
    console.log('\n━━━ STATUS SUMMARY ━━━\n');
    const statusCounts = {};
    for (const rx of prescriptions) {
        statusCounts[rx.status] = (statusCounts[rx.status] || 0) + 1;
    }
    for (const [status, count] of Object.entries(statusCounts)) {
        console.log(`  ${status}: ${count}`);
    }

    const inventoryCount = await Inventory.countDocuments({ status: 'ACTIVE' });
    console.log(`\n  Active inventory batches: ${inventoryCount}`);

    console.log('\n✅ Reconciliation complete.');

    await mongoose.disconnect();
    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
