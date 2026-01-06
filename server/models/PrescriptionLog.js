const mongoose = require('mongoose');

const PrescriptionSchema = new mongoose.Schema({
    blockchainId: { type: String, required: true, unique: true },
    doctorAddress: { type: String, required: true },
    diagnosis: { type: String },
    allergies: { type: String },
    medicines: [{
        name: { type: String, required: true },
        dosage: { type: String },
        quantity: { type: Number, required: true },
        instructions: { type: String }
    }],
    notes: { type: String },
    expiryDate: { type: Date },
    status: { type: String, enum: ['ACTIVE', 'DISPENSED', 'EXPIRED'], default: 'ACTIVE' },
    dispensedAt: { type: Date },
    issuedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PrescriptionLog', PrescriptionSchema);
