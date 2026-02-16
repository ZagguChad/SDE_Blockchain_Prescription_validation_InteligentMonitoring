/**
 * Auth Challenge Model (Blockchain Nonce)
 * 
 * Stores random nonces for blockchain signature challenges.
 * TTL-indexed for automatic 5-minute expiry.
 */

const mongoose = require('mongoose');

const AuthChallengeSchema = new mongoose.Schema({
    nonce: {
        type: String,
        required: true,
        unique: true
    },
    prescriptionId: {
        type: String,
        required: true,
        index: true
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
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// TTL index for automatic cleanup
AuthChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AuthChallenge', AuthChallengeSchema);
