/**
 * Dispense OTP Token Model
 * 
 * Stores hashed OTPs for pharmacy-side patient verification during dispensing.
 * Separate from login OtpToken to avoid cross-contamination.
 * Each OTP is single-use (marked via `used` flag) with attempt tracking.
 */

const mongoose = require('mongoose');

const DispenseOtpTokenSchema = new mongoose.Schema({
    prescriptionId: {
        type: String,
        required: true,
        index: true
    },
    otpHash: {
        type: String,
        required: true
    },
    expiresAt: {
        type: Date,
        required: true,
        default: () => new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
    },
    used: {
        type: Boolean,
        default: false
    },
    attempts: {
        type: Number,
        default: 0
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// TTL index: MongoDB automatically deletes expired documents
DispenseOtpTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound index for efficient lookups
DispenseOtpTokenSchema.index({ prescriptionId: 1, used: 0 });

module.exports = mongoose.model('DispenseOtpToken', DispenseOtpTokenSchema);
