/**
 * Hash Verifier — ZKP Phase 2 (Stabilized)
 * 
 * Recomputes prescription hashes from off-chain data using canonicalSnapshot.js
 * and compares them against on-chain anchors to detect DB tampering.
 * 
 * ALL hash computation delegated to canonicalSnapshot.js
 */

const { ethers } = require('ethers');
const { canonicalPatientHash, canonicalMedicationHash } = require('./canonicalSnapshot');

/**
 * Verify on-chain hashes against recomputed hashes from DB data.
 * 
 * @param {string} blockchainId — Prescription ID (short string, e.g. "A1B2C3")
 * @param {string} dbPatientName — Decrypted patient name from DB
 * @param {number|string} dbPatientAge — Patient age from DB
 * @param {Array} dbMedicines — Medicines array from DB (name, dosage, quantity — instructions ignored)
 * @returns {Promise<{valid: boolean, patientMatch: boolean, medMatch: boolean, details: object}>}
 */
async function verifyOnChainHashes(blockchainId, dbPatientName, dbPatientAge, dbMedicines) {
    try {
        const contractInfo = require('../contractInfo.json');
        const provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC || 'http://127.0.0.1:8545');
        const contract = new ethers.Contract(contractInfo.address, contractInfo.abi, provider);

        const idBytes = ethers.encodeBytes32String(blockchainId);
        const onChain = await contract.getPrescription(idBytes);

        if (onChain.id === ethers.ZeroHash) {
            return {
                valid: false,
                patientMatch: false,
                medMatch: false,
                details: { error: 'Prescription not found on blockchain' }
            };
        }

        // Recompute using CANONICAL utility (same structure as frontend)
        const recomputedPatientHash = canonicalPatientHash(dbPatientName, dbPatientAge);
        const recomputedMedHash = canonicalMedicationHash(dbMedicines);

        const patientMatch = recomputedPatientHash === onChain.patientHash;
        const medMatch = recomputedMedHash === onChain.medicationHash;

        return {
            valid: patientMatch && medMatch,
            patientMatch,
            medMatch,
            details: {
                onChainPatientHash: onChain.patientHash,
                recomputedPatientHash,
                onChainMedHash: onChain.medicationHash,
                recomputedMedHash
            }
        };
    } catch (err) {
        console.error('❌ Hash verification error:', err.message);
        return {
            valid: false,
            patientMatch: false,
            medMatch: false,
            details: { error: err.message }
        };
    }
}

module.exports = {
    verifyOnChainHashes,
    canonicalPatientHash,
    canonicalMedicationHash
};
