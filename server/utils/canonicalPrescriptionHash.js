/**
 * Canonical Prescription Hash — Single-Source Hash Standardization
 * 
 * ALL prescription hash generation MUST go through these functions.
 * Delegates to canonicalSnapshot.js for snapshot construction.
 * 
 * Canonical medicine object: { name, dosage, quantity (Number) }
 * Sorted alphabetically by name for determinism.
 * Instructions are EXCLUDED (encrypted/volatile → causes drift).
 * 
 * Must match DoctorDashboard.jsx canonical encoding exactly.
 */

const { canonicalPatientHash, canonicalMedicationHash, buildPrescriptionSnapshot } = require('./canonicalSnapshot');

module.exports = {
    canonicalizeMedicines: buildPrescriptionSnapshot,
    canonicalPatientHash,
    canonicalMedicationHash
};
