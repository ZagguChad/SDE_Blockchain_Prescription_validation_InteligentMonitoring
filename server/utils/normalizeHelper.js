/**
 * normalizeHelper.js — Single Source of Truth for medicine data normalization.
 *
 * This file is the ONLY place where medicine field-name resolution happens.
 * Every API that returns or validates medicines MUST use these helpers.
 *
 * Field resolution order:  name → medicineName → drugName → drug
 * Quantity resolution:     quantity → qty  (default 1)
 */

const { generateMedicineId } = require('../models/Inventory');

/**
 * Normalize a single medicine object.
 * Resolves field-name variations and trims/lowercases for matching.
 *
 * @param {Object} medicine  – raw medicine object (may come from DB, blockchain, or request body)
 * @param {number} index     – position in the medicines array (for error messages)
 * @returns {{ name: string, medicineId: string, quantity: number, dosage: string, instructions: string }}
 */
function normalizeMedicine(medicine, index = 0) {
    // ── Resolve name from multiple possible field names ──
    const rawName =
        medicine.name ||
        medicine.medicineName ||
        medicine.drugName ||
        medicine.drug ||
        null;

    const name = rawName ? rawName.toString().trim() : null;

    // ── Resolve quantity ──
    const quantity = parseInt(medicine.quantity || medicine.qty) || 1;

    return {
        name,
        medicineId: name ? generateMedicineId(name) : null,
        quantity,
        dosage: medicine.dosage || '',
        instructions: medicine.instructions || ''
    };
}

/**
 * Normalize the entire medicines array of a prescription.
 * Guarantees every medicine has a valid `name` field or throws a controlled error.
 *
 * @param {Array} medicines – raw medicines array
 * @param {string} prescriptionId – for error context
 * @returns {Array} – normalized medicines with guaranteed { name, medicineId, quantity, dosage, instructions }
 * @throws {Error} – if any medicine has no resolvable name
 */
function normalizePrescriptionMedicines(medicines, prescriptionId = 'unknown') {
    if (!medicines || !Array.isArray(medicines) || medicines.length === 0) {
        const err = new Error('Prescription contains no medicines');
        err.statusCode = 400;
        throw err;
    }

    return medicines.map((med, i) => {
        const normalized = normalizeMedicine(med, i);

        if (!normalized.name) {
            const err = new Error(
                `Medicine #${i + 1} has no identifiable name ` +
                `(checked: name, medicineName, drugName, drug). ` +
                `Prescription: ${prescriptionId}`
            );
            err.statusCode = 400;
            throw err;
        }

        return normalized;
    });
}

module.exports = {
    normalizeMedicine,
    normalizePrescriptionMedicines
};
