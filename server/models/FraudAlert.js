const mongoose = require('mongoose');

const FraudAlertSchema = new mongoose.Schema({
    type: { type: String, required: true }, // e.g., 'HIGH_FREQUENCY', 'UNUSED_EXPIRY'
    description: { type: String, required: true },
    severity: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'MEDIUM' },
    relatedPrescriptionId: { type: String }, // Blockchain ID or Mongo ID
    patientName: { type: String },
    doctorAddress: { type: String },
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('FraudAlert', FraudAlertSchema);
