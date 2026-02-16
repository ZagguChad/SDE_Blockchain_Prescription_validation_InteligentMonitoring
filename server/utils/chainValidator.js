/**
 * chainValidator.js — On-Chain Pre-Mutation Validation (Phase 1: Chain Authority)
 * 
 * Performs STRICT on-chain validation before any DB mutation.
 * NO FALLBACK to DB-only trust. If blockchain is unreachable → hard error.
 * 
 * Validates:
 *   1. Blockchain RPC reachability
 *   2. Prescription exists on-chain
 *   3. status == ACTIVE (1)
 *   4. usageCount < maxUsage
 *   5. expiryDate > now (unix seconds)
 *   6. patientHash + medicationHash match recomputed canonical hashes
 */

const { ethers } = require('ethers');
const { canonicalPatientHash, canonicalMedicationHash } = require('./canonicalSnapshot');

// ═══════════════════════════════════════════════════════════
//  Error Codes
// ═══════════════════════════════════════════════════════════

const ChainErrorCodes = Object.freeze({
    CHAIN_UNREACHABLE: 'CHAIN_UNREACHABLE',
    NOT_FOUND_ON_CHAIN: 'NOT_FOUND_ON_CHAIN',
    STATUS_MISMATCH: 'STATUS_MISMATCH',
    USAGE_EXHAUSTED: 'USAGE_EXHAUSTED',
    EXPIRED_ON_CHAIN: 'EXPIRED_ON_CHAIN',
    HASH_MISMATCH: 'HASH_MISMATCH',
});

// On-chain status enum from PrescriptionRegistryV2.sol
const OnChainStatus = Object.freeze({
    CREATED: 0,
    ACTIVE: 1,
    USED: 2,
    EXPIRED: 3,
});

const STATUS_LABELS = Object.freeze({
    0: 'CREATED',
    1: 'ACTIVE',
    2: 'USED',
    3: 'EXPIRED',
});

// ═══════════════════════════════════════════════════════════
//  Chain Validation Error
// ═══════════════════════════════════════════════════════════

class ChainValidationError extends Error {
    /**
     * @param {string} code    — One of ChainErrorCodes
     * @param {string} message — Human-readable message
     * @param {object} context — Structured context for logging
     */
    constructor(code, message, context = {}) {
        super(message);
        this.name = 'ChainValidationError';
        this.code = code;
        this.context = context;
        this.httpStatus = code === ChainErrorCodes.CHAIN_UNREACHABLE ? 503 : 403;
    }
}

// ═══════════════════════════════════════════════════════════
//  Core Validator
// ═══════════════════════════════════════════════════════════

/**
 * Perform complete on-chain pre-mutation validation.
 * 
 * @param {string} blockchainId    — Short prescription ID (e.g. "A1B2C3")
 * @param {string} dbPatientName   — Decrypted patient name from DB
 * @param {number|string} dbPatientAge — Patient age from DB
 * @param {Array}  dbMedicines     — Medicines array from DB ({name, dosage, quantity})
 * @returns {Promise<object>}      — { valid: true, onChainState: {...} } on success
 * @throws {ChainValidationError}  — On any validation failure
 */
async function validateOnChainState(blockchainId, dbPatientName, dbPatientAge, dbMedicines) {
    const prescriptionId = blockchainId;

    // ── Step 1: Connect to blockchain ──
    let provider, contract;
    try {
        const contractInfo = require('../contractInfo.json');
        provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC || 'http://127.0.0.1:8545');

        // Test connectivity with a timeout
        await Promise.race([
            provider.getBlockNumber(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('RPC timeout')), 5000))
        ]);

        contract = new ethers.Contract(contractInfo.address, contractInfo.abi, provider);
    } catch (err) {
        const error = new ChainValidationError(
            ChainErrorCodes.CHAIN_UNREACHABLE,
            `Blockchain RPC unreachable: ${err.message}`,
            { prescriptionId, rpcUrl: process.env.BLOCKCHAIN_RPC || 'http://127.0.0.1:8545', rawError: err.message }
        );
        console.error(`🔴 [CHAIN_UNREACHABLE] prescriptionId=${prescriptionId} — ${err.message}`);
        throw error;
    }

    // ── Step 2: Fetch on-chain prescription ──
    let onChain;
    try {
        const idBytes = ethers.encodeBytes32String(blockchainId);
        onChain = await contract.getPrescription(idBytes);
    } catch (err) {
        const error = new ChainValidationError(
            ChainErrorCodes.CHAIN_UNREACHABLE,
            `Failed to read on-chain state: ${err.message}`,
            { prescriptionId, rawError: err.message }
        );
        console.error(`🔴 [CHAIN_UNREACHABLE] prescriptionId=${prescriptionId} — getPrescription failed: ${err.message}`);
        throw error;
    }

    // Check if prescription exists on-chain
    if (onChain.id === ethers.ZeroHash) {
        const error = new ChainValidationError(
            ChainErrorCodes.NOT_FOUND_ON_CHAIN,
            `Prescription ${prescriptionId} not found on blockchain`,
            { prescriptionId }
        );
        console.error(`🔴 [NOT_FOUND_ON_CHAIN] prescriptionId=${prescriptionId}`);
        throw error;
    }

    // Extract on-chain state
    const onChainState = {
        status: Number(onChain.status),
        statusLabel: STATUS_LABELS[Number(onChain.status)] || 'UNKNOWN',
        usageCount: Number(onChain.usageCount),
        maxUsage: Number(onChain.maxUsage),
        expiryDate: Number(onChain.expiryDate),
        patientHash: onChain.patientHash,
        medicationHash: onChain.medicationHash,
    };

    const nowUnix = Math.floor(Date.now() / 1000);

    // ── Step 3: Validate status == ACTIVE ──
    if (onChainState.status !== OnChainStatus.ACTIVE) {
        const error = new ChainValidationError(
            ChainErrorCodes.STATUS_MISMATCH,
            `Prescription ${prescriptionId} is not ACTIVE on-chain (current: ${onChainState.statusLabel})`,
            { prescriptionId, expected: 'ACTIVE', actual: onChainState.statusLabel, onChainState }
        );
        console.error(`🔴 [STATUS_MISMATCH] prescriptionId=${prescriptionId} expected=ACTIVE actual=${onChainState.statusLabel}`);
        throw error;
    }

    // ── Step 4: Validate usageCount < maxUsage ──
    if (onChainState.usageCount >= onChainState.maxUsage) {
        const error = new ChainValidationError(
            ChainErrorCodes.USAGE_EXHAUSTED,
            `Prescription ${prescriptionId} usage limit exhausted (${onChainState.usageCount}/${onChainState.maxUsage})`,
            { prescriptionId, usageCount: onChainState.usageCount, maxUsage: onChainState.maxUsage, onChainState }
        );
        console.error(`🔴 [USAGE_EXHAUSTED] prescriptionId=${prescriptionId} usage=${onChainState.usageCount}/${onChainState.maxUsage}`);
        throw error;
    }

    // ── Step 5: Validate expiryDate > now ──
    if (onChainState.expiryDate <= nowUnix) {
        const error = new ChainValidationError(
            ChainErrorCodes.EXPIRED_ON_CHAIN,
            `Prescription ${prescriptionId} has expired on-chain (expiry: ${new Date(onChainState.expiryDate * 1000).toISOString()})`,
            { prescriptionId, expiryDate: onChainState.expiryDate, nowUnix, expiryISO: new Date(onChainState.expiryDate * 1000).toISOString(), onChainState }
        );
        console.error(`🔴 [EXPIRED_ON_CHAIN] prescriptionId=${prescriptionId} expiryDate=${new Date(onChainState.expiryDate * 1000).toISOString()} now=${new Date(nowUnix * 1000).toISOString()}`);
        throw error;
    }

    // ── Step 6: Validate hash integrity ──
    const recomputedPatientHash = canonicalPatientHash(dbPatientName, dbPatientAge);
    const recomputedMedHash = canonicalMedicationHash(dbMedicines);

    const patientMatch = recomputedPatientHash === onChainState.patientHash;
    const medMatch = recomputedMedHash === onChainState.medicationHash;

    if (!patientMatch || !medMatch) {
        const error = new ChainValidationError(
            ChainErrorCodes.HASH_MISMATCH,
            `Prescription ${prescriptionId} data integrity check failed — off-chain data does not match on-chain hashes`,
            {
                prescriptionId,
                patientMatch,
                medMatch,
                onChainPatientHash: onChainState.patientHash,
                recomputedPatientHash,
                onChainMedHash: onChainState.medicationHash,
                recomputedMedHash,
                onChainState
            }
        );
        console.error(`🔴 [HASH_MISMATCH] prescriptionId=${prescriptionId} patientMatch=${patientMatch} medMatch=${medMatch}`);
        throw error;
    }

    // ── All checks passed ──
    console.log(`✅ [CHAIN_VALID] prescriptionId=${prescriptionId} status=${onChainState.statusLabel} usage=${onChainState.usageCount}/${onChainState.maxUsage} hashOK=true`);

    return {
        valid: true,
        onChainState,
        hashIntegrity: {
            patientMatch: true,
            medMatch: true,
            recomputedPatientHash,
            recomputedMedHash,
        }
    };
}

module.exports = {
    validateOnChainState,
    ChainValidationError,
    ChainErrorCodes,
    OnChainStatus,
    STATUS_LABELS,
};
