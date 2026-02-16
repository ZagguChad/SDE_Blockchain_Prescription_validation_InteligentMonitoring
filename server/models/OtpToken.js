/**
 * OTP Token Model
 * 
 * Stores hashed OTPs with automatic TTL expiry via MongoDB index.
 * Each OTP is single-use (marked via `used` flag) with attempt tracking.
 */

const mongoose = require('mongoose');

const OtpTokenSchema = new mongoose.Schema({
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
OtpTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound index for efficient lookups
OtpTokenSchema.index({ prescriptionId: 1, used: 0 });

module.exports = mongoose.model('OtpToken', OtpTokenSchema);
