const mongoose = require('mongoose');

const PrescriptionSchema = new mongoose.Schema({
    blockchainId: { type: Number, required: true, unique: true },
    doctorAddress: { type: String, required: true },
    patientName: { type: String, required: true }, // Off-chain PII
    patientAge: { type: Number },
    medicineDetails: {
        name: { type: String, required: true },
        dosage: { type: String },
        quantity: { type: Number, required: true }
    },
    notes: { type: String },
    issuedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PrescriptionLog', PrescriptionSchema);
