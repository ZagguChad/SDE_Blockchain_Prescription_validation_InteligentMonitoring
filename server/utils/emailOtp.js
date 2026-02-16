/**
 * Email OTP Utility Module
 * 
 * Generates, hashes, and verifies 6-digit OTPs for patient authentication.
 * OTPs are hashed with SHA-256 before storage — plaintext never persisted.
 */

const crypto = require('crypto');

/**
 * Generate a cryptographically random 6-digit OTP.
 * @returns {string} 6-digit OTP string (zero-padded)
 */
function generateOtp() {
    // Use crypto.randomInt for uniform distribution (Node 14.10+)
    const otp = crypto.randomInt(0, 1000000);
    return String(otp).padStart(6, '0');
}

/**
 * Hash an OTP using SHA-256 for secure storage.
 * @param {string} otp - Plaintext OTP
 * @returns {string} Hex-encoded SHA-256 hash
 */
function hashOtp(otp) {
    return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

/**
 * Verify an OTP input against a stored hash.
 * @param {string} inputOtp - User-provided OTP
 * @param {string} storedHash - SHA-256 hash from database
 * @returns {boolean}
 */
function verifyOtp(inputOtp, storedHash) {
    const inputHash = hashOtp(inputOtp);
    // Constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(
        Buffer.from(inputHash, 'hex'),
        Buffer.from(storedHash, 'hex')
    );
}

module.exports = { generateOtp, hashOtp, verifyOtp };
