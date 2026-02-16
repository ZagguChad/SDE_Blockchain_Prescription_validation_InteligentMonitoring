/**
 * blockchainListener.js — Event-Sourced Blockchain Listener (Phase 2: Chain Recovery Authority)
 * 
 * Listens for on-chain events and reconciles DB state.
 * On startup: replays last 100 blocks to catch ghost prescriptions.
 * Real-time: handles PrescriptionCreated, Dispensed, Expired events.
 * 
 * All DB writes are idempotent via $setOnInsert / unique index guards.
 */

const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
const PrescriptionLog = require('../models/PrescriptionLog');
const {
    reconcileSinglePrescription,
    startupRecovery,
    getContractConnection,
    decodeId,
} = require('../utils/reconciliationEngine');
const { transitionStatus } = require('../utils/stateTransitions');

async function startBlockchainListener() {
    try {
        const artifactPath = path.join(__dirname, '../contractInfo.json');

        if (!fs.existsSync(artifactPath)) {
            console.log("⚠️ Contract info not found. Skipping listener start.");
            return;
        }

        const { address, abi } = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

        // Connect to local Hardhat network
        const provider = new ethers.JsonRpcProvider(
            process.env.BLOCKCHAIN_RPC || "http://127.0.0.1:8545"
        );

        const contract = new ethers.Contract(address, abi, provider);

        // ── STARTUP RECOVERY: Replay last 100 blocks ──
        try {
            await startupRecovery(100);
        } catch (recoveryErr) {
            console.warn(`⚠️ Startup recovery failed (non-fatal): ${recoveryErr.message}`);
        }

        console.log(`🎧 Listening for events on contract: ${address}`);

        // ──────────────────────────────────────────────────────────
        // EVENT: PrescriptionCreated
        // Phase 2: Real handler — reconciles missing DB records
        // ──────────────────────────────────────────────────────────
        contract.on("PrescriptionCreated", async (id, issuer, patientHash, event) => {
            const blockchainId = decodeId(id);
            console.log(`✨ Event: PrescriptionCreated [ID: ${blockchainId}] Issuer: ${issuer}`);

            try {
                const eventLog = event.log || event;
                const blockNumber = eventLog.blockNumber || null;
                const txHash = eventLog.transactionHash || null;

                const outcome = await reconcileSinglePrescription(
                    contract, blockchainId, issuer, blockNumber, txHash
                );

                if (outcome === 'inserted') {
                    console.log(`🔗 [LISTENER] Recovered ghost prescription ${blockchainId} from chain event`);
                } else if (outcome === 'updated') {
                    console.log(`🔄 [LISTENER] Updated sync flag for ${blockchainId}`);
                }
                // 'skipped' = already in DB and synced — normal case
            } catch (err) {
                console.error(`❌ [LISTENER] PrescriptionCreated handler error for ${blockchainId}:`, err.message);
            }
        });

        // ──────────────────────────────────────────────────────────
        // EVENT: PrescriptionDispensed
        // Phase 3: SOLE AUTHORITY for DISPENSED/USED status + usageCount
        // ──────────────────────────────────────────────────────────
        contract.on("PrescriptionDispensed", async (id, pharmacy, remainingUsage, event) => {
            const blockchainId = decodeId(id);
            const eventLog = event.log || event;
            const eventTxHash = eventLog.transactionHash || null;
            console.log(`💊 Event: PrescriptionDispensed [ID: ${blockchainId}] Remaining: ${remainingUsage} TxHash: ${eventTxHash}`);

            try {
                // Phase 2: Reconcile ghost records first
                let existing = await PrescriptionLog.findOne({ blockchainId });
                if (!existing) {
                    console.warn(`⚠️ [LISTENER] Dispensed event for unknown Rx ${blockchainId} — attempting reconciliation`);
                    await reconcileSinglePrescription(
                        contract, blockchainId, null,
                        eventLog.blockNumber || null,
                        eventTxHash
                    );
                    existing = await PrescriptionLog.findOne({ blockchainId });
                    if (!existing) {
                        console.error(`❌ [LISTENER] Could not reconcile ${blockchainId} for dispense event`);
                        return;
                    }
                }

                // Phase 3: Determine final status from on-chain remainingUsage
                const finalStatus = Number(remainingUsage) === 0 ? 'USED' : 'DISPENSED';

                // Atomic transition with guard — ONLY succeeds if current status allows it
                const result = await transitionStatus(blockchainId, finalStatus, {
                    usageCountIncrement: 1,
                    dispensedAt: existing.dispensedAt || new Date(),
                    confirmedTxHash: eventTxHash,
                });

                if (result) {
                    console.log(`✅ [LISTENER] ${blockchainId}: Event confirmed → ${finalStatus} (usage: ${result.usageCount}/${result.maxUsage})`);
                } else {
                    console.warn(`⚠️ [LISTENER] Status transition to ${finalStatus} blocked for ${blockchainId} — current state may already be terminal`);
                }
            } catch (err) {
                console.error(`❌ [LISTENER] Error processing Dispense event for ${blockchainId}:`, err.message);
            }
        });

        // ──────────────────────────────────────────────────────────
        // EVENT: PrescriptionExpired
        // Phase 3: Uses state transition guard
        // ──────────────────────────────────────────────────────────
        contract.on("PrescriptionExpired", async (id, event) => {
            const blockchainId = decodeId(id);
            console.log(`⏰ Event: PrescriptionExpired [ID: ${blockchainId}]`);

            try {
                // Phase 2: Reconcile ghost records first
                const existing = await PrescriptionLog.findOne({ blockchainId });
                if (!existing) {
                    console.warn(`⚠️ [LISTENER] Expired event for unknown Rx ${blockchainId} — attempting reconciliation`);
                    const eventLog = event.log || event;
                    await reconcileSinglePrescription(
                        contract, blockchainId, null,
                        eventLog.blockNumber || null,
                        eventLog.transactionHash || null
                    );
                }

                // Phase 3: Atomic transition with guard
                const result = await transitionStatus(blockchainId, 'EXPIRED');

                if (result) {
                    console.log(`✅ [LISTENER] ${blockchainId}: Expired via on-chain event`);
                } else {
                    console.warn(`⚠️ [LISTENER] Expiry transition blocked for ${blockchainId} — may already be terminal`);
                }
            } catch (err) {
                console.error(`❌ [LISTENER] Error processing Expiry event for ${blockchainId}:`, err.message);
            }
        });

    } catch (error) {
        console.error("❌ Failed to start blockchain listener:", error.message);
    }
}

module.exports = startBlockchainListener;

