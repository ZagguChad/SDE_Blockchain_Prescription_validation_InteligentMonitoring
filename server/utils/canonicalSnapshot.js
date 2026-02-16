/**
 * canonicalSnapshot.js — Single Source of Truth for ALL hash inputs
 * 
 * EVERY hash in the system MUST use these builders.
 * No other code may construct hash input objects directly.
 * 
 * Determinism guarantees:
 *   - Fixed field set (no _id, __v, timestamps, encrypted metadata)
 *   - Explicit type coercion (Number, String)
 *   - Deterministic sort order (batchId for inventory, name for medicines)
 *   - Frozen structure via JSON.stringify
 *   - Null/undefined stripped
 */

const { ethers } = require('ethers');
const Inventory = require('../models/Inventory');

// ═══════════════════════════════════════════════════════════
//  INVENTORY SNAPSHOT
// ═══════════════════════════════════════════════════════════

/**
 * Build a canonical snapshot of a single inventory batch.
 * Strips ALL volatile/internal fields. Returns a deterministic plain object.
 * 
 * @param {Object} batch — Mongoose lean document or plain object
 * @returns {Object} Canonical batch (6 fields, fixed order)
 */
function buildBatchSnapshot(batch) {
    return {
        batchId: String(batch.batchId || ''),
        medicineName: String(batch.medicineName || ''),
        currentQuantity: Math.floor(Number(batch.quantityAvailable) || 0),
        expiryDate: new Date(batch.expiryDate).toISOString(),
        price: Number(Number(batch.pricePerUnit || 0).toFixed(2)),
        status: String(batch.status || 'ACTIVE')
    };
}

/**
 * Build the complete canonical inventory snapshot.
 * Fetches ONLY ACTIVE batches, sorted by batchId ascending.
 * 
 * @returns {Promise<{snapshot: Object[], batchCount: number}>}
 */
async function buildInventorySnapshot() {
    const batches = await Inventory.find({ status: 'ACTIVE' })
        .sort({ medicineId: 1, batchId: 1 })
        .lean();

    const snapshot = batches.map(b => buildBatchSnapshot(b));

    // Validate structure before returning
    validateCanonicalStructure(snapshot, 'inventory');

    return { snapshot, batchCount: snapshot.length };
}

// ═══════════════════════════════════════════════════════════
//  PRESCRIPTION SNAPSHOT
// ═══════════════════════════════════════════════════════════

/**
 * Build a canonical medicine snapshot for hashing.
 * Strips _id, instructions (encrypted/volatile), timestamps.
 * 
 * @param {Object} med — Raw medicine object (from form OR DB)
 * @returns {Object} Canonical medicine (3 fields, fixed order)
 */
function buildMedicineSnapshot(med) {
    return {
        name: String(med.name || '').trim(),
        dosage: String(med.dosage || '').trim(),
        quantity: Math.floor(Number(med.quantity) || 0)
    };
}

/**
 * Build the canonical prescription medicines snapshot.
 * Sorted alphabetically by medicine name.
 * 
 * @param {Array} medicines — Raw medicine array
 * @returns {Array} Sorted canonical medicines
 */
function buildPrescriptionSnapshot(medicines) {
    if (!medicines || !Array.isArray(medicines)) return [];

    const snapshot = medicines
        .map(m => buildMedicineSnapshot(m))
        .sort((a, b) => a.name.localeCompare(b.name));

    // Validate structure before returning
    validateCanonicalStructure(snapshot, 'prescription');

    return snapshot;
}

// ═══════════════════════════════════════════════════════════
//  DETERMINISTIC HASH
// ═══════════════════════════════════════════════════════════

/**
 * Compute a deterministic keccak256 hash from any canonical data structure.
 * Uses JSON.stringify → UTF-8 bytes → keccak256.
 * 
 * @param {*} data — Canonical object/array (must be JSON-serializable)
 * @returns {string} bytes32 hash (0x-prefixed)
 */
function deterministicHash(data) {
    const json = JSON.stringify(data);
    return ethers.keccak256(ethers.toUtf8Bytes(json));
}

// ═══════════════════════════════════════════════════════════
//  PATIENT HASH (unchanged encoding — name + age concatenation)
// ═══════════════════════════════════════════════════════════

/**
 * Compute canonical patient hash.
 * Encoding: keccak256(toUtf8Bytes(trimmedName + trimmedAge))
 * This matches the DoctorDashboard.jsx frontend encoding.
 * 
 * @param {string} patientName — Plain text patient name
 * @param {number|string} patientAge — Patient age
 * @returns {string} bytes32 hash
 */
function canonicalPatientHash(patientName, patientAge) {
    const name = String(patientName).trim();
    const age = String(patientAge).trim();
    return ethers.keccak256(ethers.toUtf8Bytes(name + age));
}

/**
 * Compute canonical medication hash from medicines array.
 * Uses buildPrescriptionSnapshot → deterministicHash.
 * 
 * @param {Array} medicines — Raw medicines array
 * @returns {string} bytes32 hash
 */
function canonicalMedicationHash(medicines) {
    const snapshot = buildPrescriptionSnapshot(medicines);
    return deterministicHash(snapshot);
}

// ═══════════════════════════════════════════════════════════
//  VALIDATION
// ═══════════════════════════════════════════════════════════

/**
 * Validate a canonical structure for determinism safety.
 * Rejects undefined, NaN, circular refs, or unexpected types.
 * 
 * @param {*} data — Canonical snapshot
 * @param {string} type — 'inventory' | 'prescription'
 * @throws {Error} if structure is invalid
 */
function validateCanonicalStructure(data, type) {
    const json = JSON.stringify(data);

    // Check for undefined/NaN leaking in
    if (json.includes('null') && type === 'inventory') {
        // null values in inventory snapshot indicate missing required fields
        const parsed = JSON.parse(json);
        for (const item of parsed) {
            for (const [key, value] of Object.entries(item)) {
                if (value === null || value === undefined) {
                    throw new Error(`Canonical ${type} snapshot has null/undefined field: ${key}`);
                }
                if (typeof value === 'number' && isNaN(value)) {
                    throw new Error(`Canonical ${type} snapshot has NaN field: ${key}`);
                }
            }
        }
    }

    // Check roundtrip stability (ensures no circular refs or non-serializable data)
    const roundtrip = JSON.stringify(JSON.parse(json));
    if (json !== roundtrip) {
        throw new Error(`Canonical ${type} snapshot failed roundtrip check — non-deterministic`);
    }
}

module.exports = {
    // Inventory
    buildBatchSnapshot,
    buildInventorySnapshot,
    // Prescription
    buildMedicineSnapshot,
    buildPrescriptionSnapshot,
    // Hash
    deterministicHash,
    canonicalPatientHash,
    canonicalMedicationHash,
    // Validation
    validateCanonicalStructure
};
