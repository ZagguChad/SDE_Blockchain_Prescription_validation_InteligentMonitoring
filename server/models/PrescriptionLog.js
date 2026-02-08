const mongoose = require('mongoose');

const PrescriptionSchema = new mongoose.Schema({
    blockchainId: { type: String, required: true, unique: true },
    doctorAddress: { type: String, required: true },
    patientName: { type: String }, // Encrypted
    patientAge: { type: Number },
    diagnosis: { type: String }, // Encrypted
    allergies: { type: String }, // Encrypted
    medicines: [{
        name: { type: String, required: true },
        dosage: { type: String },
        quantity: { type: Number, required: true },
        instructions: { type: String } // Encrypted
    }],
    notes: { type: String }, // Encrypted
    expiryDate: { type: Date },
    maxUsage: { type: Number, default: 1 }, // New
    usageCount: { type: Number, default: 0 }, // New
    patientHash: { type: String }, // New: Store on-chain hash for verification
    status: { type: String, enum: ['CREATED', 'ACTIVE', 'USED', 'EXPIRED', 'DISPENSED'], default: 'ACTIVE' },
    dispensedAt: { type: Date },
    issuedAt: { type: Date, default: Date.now },
    // Part 3: Billing & Invoice
    totalCost: { type: Number },
    invoiceDetails: [{
        name: String,
        quantity: Number,
        pricePerUnit: Number,
        total: Number
    }]
});

module.exports = mongoose.model('PrescriptionLog', PrescriptionSchema);
