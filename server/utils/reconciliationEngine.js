/**
 * reconciliationEngine.js — Event-Sourced Reconciliation (Phase 2: Chain Recovery Authority)
 * 
 * Queries PrescriptionCreated events from a block range and reconciles
 * on-chain state with DB records. Inserts missing records, flags mismatches.
 * 
 * IDEMPOTENT: Uses $setOnInsert to prevent overwriting existing records.
 * RACE-SAFE: findOneAndUpdate with upsert won't conflict with dispense route.
 * 
 * Reusable by:
 *   - blockchainListener.js (real-time event handler)
 *   - Startup recovery (replay last N blocks)
 *   - Periodic reconciliation cron
 */

const { ethers } = require('ethers');
const PrescriptionLog = require('../models/PrescriptionLog');
const ReconciliationMeta = require('../models/ReconciliationMeta');

// On-chain status enum → DB status string
const STATUS_MAP = {
    0: 'CREATED',
    1: 'ACTIVE',
    2: 'USED',
    3: 'EXPIRED',
};

/**
 * Get a connected provider and contract instance.
 * @returns {{ provider, contract, contractInfo }}
 * @throws {Error} If RPC is unreachable
 */
function getContractConnection() {
    const contractInfo = require('../contractInfo.json');
    const provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC || 'http://127.0.0.1:8545');
    const contract = new ethers.Contract(contractInfo.address, contractInfo.abi, provider);
    return { provider, contract, contractInfo };
}

/**
 * Decode a bytes32 value to a short string ID.
 * Falls back to raw hex if decoding fails.
 * @param {string} bytes32Value 
 * @returns {string}
 */
function decodeId(bytes32Value) {
    try {
        return ethers.decodeBytes32String(bytes32Value);
    } catch {
        return bytes32Value;
    }
}

/**
 * Reconcile a single prescription by blockchainId.
 * Checks DB, inserts if missing, updates sync flag if needed.
 * 
 * @param {object} contract — Ethers contract instance
 * @param {string} blockchainId — Decoded short string ID
 * @param {string} issuerAddress — Doctor address from event
 * @param {number} blockNumber — Block number where event was emitted
 * @param {string} txHash — Transaction hash of the event
 * @returns {Promise<'inserted'|'updated'|'skipped'|'error'>}
 */
async function reconcileSinglePrescription(contract, blockchainId, issuerAddress, blockNumber, txHash) {
    try {
        // Check if DB record exists
        const existing = await PrescriptionLog.findOne({ blockchainId });

        if (existing) {
            // Record exists — check if sync flag needs updating
            if (!existing.blockchainSynced) {
                await PrescriptionLog.updateOne(
                    { blockchainId },
                    { $set: { blockchainSynced: true, txHash: txHash || existing.txHash, blockNumber: blockNumber || existing.blockNumber } }
                );
                console.log(`🔄 [RECONCILE] ${blockchainId}: Updated blockchainSynced=true`);
                return 'updated';
            }
            // Already synced — skip
            return 'skipped';
        }

        // Record missing — fetch full on-chain state
        const idBytes = ethers.encodeBytes32String(blockchainId);
        const onChain = await contract.getPrescription(idBytes);

        if (onChain.id === ethers.ZeroHash) {
            console.warn(`⚠️ [RECONCILE] ${blockchainId}: Event found but no on-chain data (possible revert)`);
            return 'error';
        }

        // Build minimal recovered record
        const onChainStatus = Number(onChain.status);
        const dbStatus = STATUS_MAP[onChainStatus] || 'ACTIVE';
        const expiryDate = new Date(Number(onChain.expiryDate) * 1000);

        // Use $setOnInsert for race-safety: if dispense route inserts between
        // our findOne and this upsert, the $setOnInsert is a no-op on existing fields
        const result = await PrescriptionLog.findOneAndUpdate(
            { blockchainId },
            {
                $setOnInsert: {
                    blockchainId,
                    doctorAddress: issuerAddress || onChain.issuer,
                    patientName: '[RECOVERED]',
                    patientUsername: `recovered-${blockchainId}`,
                    patientDOB: new Date(0),
                    patientEmail: '[RECOVERED]',
                    patientAge: 0,
                    diagnosis: '[RECOVERED]',
                    allergies: '',
                    medicines: [],
                    notes: '',
                    expiryDate,
                    maxUsage: Number(onChain.maxUsage),
                    usageCount: Number(onChain.usageCount),
                    patientHash: onChain.patientHash,
                    status: dbStatus,
                    blockchainSynced: true,
                    txHash: txHash || null,
                    blockNumber: blockNumber || null,
                    issuedAt: new Date(Number(onChain.timestamp) * 1000),
                    hashVerified: false,
                    // Sentinel fields to identify recovered records
                    _recoveredFromChain: true,
                    _recoveredAt: new Date(),
                }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        // Check if we actually inserted (vs found an existing record due to race)
        if (result.patientName === '[RECOVERED]') {
            console.log(`🔗 [RECONCILE] ${blockchainId}: INSERTED recovered record from chain (status=${dbStatus}, block=${blockNumber})`);
            return 'inserted';
        } else {
            console.log(`🔄 [RECONCILE] ${blockchainId}: Record appeared during reconciliation (race resolved)`);
            return 'skipped';
        }

    } catch (err) {
        console.error(`❌ [RECONCILE] ${blockchainId}: Error — ${err.message}`);
        return 'error';
    }
}

/**
 * Reconcile all PrescriptionCreated events from a block range.
 * 
 * @param {number} fromBlock — Start block (inclusive)
 * @param {number|string} toBlock — End block (inclusive), or 'latest'
 * @returns {Promise<{inserted: number, updated: number, skipped: number, errors: number, eventsFound: number}>}
 */
async function reconcileFromEvents(fromBlock, toBlock = 'latest') {
    const result = { inserted: 0, updated: 0, skipped: 0, errors: 0, eventsFound: 0 };

    let provider, contract;
    try {
        ({ provider, contract } = getContractConnection());
        // Test connectivity
        await provider.getBlockNumber();
    } catch (err) {
        console.error(`🔴 [RECONCILE] Blockchain unreachable: ${err.message}`);
        result.errors = 1;
        return result;
    }

    try {
        // Query PrescriptionCreated events
        const filter = contract.filters.PrescriptionCreated();
        const events = await contract.queryFilter(filter, fromBlock, toBlock);
        result.eventsFound = events.length;

        if (events.length === 0) {
            console.log(`📋 [RECONCILE] No PrescriptionCreated events in blocks ${fromBlock}–${toBlock}`);
            return result;
        }

        console.log(`📋 [RECONCILE] Found ${events.length} PrescriptionCreated events in blocks ${fromBlock}–${toBlock}`);

        for (const event of events) {
            const blockchainId = decodeId(event.args[0]); // id (bytes32)
            const issuerAddress = event.args[1];           // issuer (address)
            const eventBlockNumber = event.blockNumber;
            const eventTxHash = event.transactionHash;

            const outcome = await reconcileSinglePrescription(
                contract, blockchainId, issuerAddress, eventBlockNumber, eventTxHash
            );

            result[outcome]++;
        }

        // Update last reconciled block
        const resolvedToBlock = toBlock === 'latest' ? await provider.getBlockNumber() : toBlock;
        await ReconciliationMeta.findOneAndUpdate(
            { key: 'lastReconciledBlock' },
            { $set: { value: resolvedToBlock, updatedAt: new Date() } },
            { upsert: true }
        );

    } catch (err) {
        console.error(`❌ [RECONCILE] Event query failed: ${err.message}`);
        result.errors++;
    }

    return result;
}

/**
 * Get the last reconciled block number from the meta store.
 * @returns {Promise<number|null>}
 */
async function getLastReconciledBlock() {
    try {
        const meta = await ReconciliationMeta.findOne({ key: 'lastReconciledBlock' });
        return meta ? Number(meta.value) : null;
    } catch {
        return null;
    }
}

/**
 * Run startup recovery: replay last N blocks to catch ghost prescriptions.
 * @param {number} lookbackBlocks — Number of blocks to look back (default: 100)
 * @returns {Promise<object>} Reconciliation result
 */
async function startupRecovery(lookbackBlocks = 100) {
    console.log(`\n🔄 [STARTUP RECOVERY] Replaying last ${lookbackBlocks} blocks...`);

    let provider;
    try {
        ({ provider } = getContractConnection());
        const currentBlock = await provider.getBlockNumber();
        const fromBlock = Math.max(0, currentBlock - lookbackBlocks);

        console.log(`   Current block: ${currentBlock}, scanning from block ${fromBlock}`);

        const result = await reconcileFromEvents(fromBlock, currentBlock);

        console.log(`✅ [STARTUP RECOVERY] Complete: ${result.inserted} inserted, ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors (${result.eventsFound} events scanned)`);
        return result;
    } catch (err) {
        console.warn(`⚠️ [STARTUP RECOVERY] Failed (non-fatal): ${err.message}`);
        return { inserted: 0, updated: 0, skipped: 0, errors: 1, eventsFound: 0 };
    }
}

module.exports = {
    reconcileSinglePrescription,
    reconcileFromEvents,
    getLastReconciledBlock,
    startupRecovery,
    getContractConnection,
    decodeId,
    STATUS_MAP,
};
