/**
 * TOTP Service Module (Google Authenticator)
 * 
 * Provides TOTP secret generation, QR code creation,
 * token verification, and backup code generation.
 * 
 * Uses otplib v13 synchronous API (generateSecret, verifySync)
 * for crash-proof verification. The TOTP class is NOT used because
 * its verify()/generate() methods return Promises in Node.js 22+,
 * which can cause unhandled rejections.
 */

const { generateSecret, verifySync } = require('otplib');
const QRCode = require('qrcode');
const { encrypt, decrypt } = require('./encryption');
const crypto = require('crypto');

// TOTP configuration — shared between QR generation and verification
const TOTP_CONFIG = {
    digits: 6,
    period: 30,    // 30-second window
    window: 2      // Allow 2 step tolerance (±60s) for clock drift
};

/**
 * Generate a new TOTP secret.
 * @returns {string} Base32-encoded secret
 */
function generateTotpSecret() {
    const secret = generateSecret();
    console.log(`🔐 [TOTP] New secret generated (length: ${secret.length})`);
    return secret;
}

/**
 * Generate a QR code data URL for Google Authenticator.
 * @param {string} secret - Base32 TOTP secret
 * @param {string} label - Display label (e.g., patient name or prescription ID)
 * @returns {Promise<string>} Data URL for QR code image
 */
async function generateQrDataUrl(secret, label) {
    // Explicitly construct otpauth URI with all parameters for maximum compatibility
    const otpauthUrl = `otpauth://totp/${encodeURIComponent('BlockRx Medical')}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent('BlockRx Medical')}&algorithm=SHA1&digits=${TOTP_CONFIG.digits}&period=${TOTP_CONFIG.period}`;
    console.log(`📱 [TOTP] QR code generated for label: ${label}`);
    return QRCode.toDataURL(otpauthUrl);
}

/**
 * Verify a TOTP token against a secret.
 * 
 * Uses otplib v13's verifySync() which is fully synchronous and crash-proof.
 * Returns { valid: boolean, delta: number } where delta indicates the time
 * step offset that matched (0 = exact, ±1/2 = within window).
 * 
 * @param {string} token - 6-digit TOTP code from authenticator app
 * @param {string} secret - Base32 TOTP secret
 * @param {string} [context] - Optional context for logging (e.g., prescriptionId)
 * @returns {boolean}
 */
function verifyTotp(token, secret, context = '') {
    try {
        if (!secret) {
            console.warn(`⚠️ [TOTP] Verification skipped — no secret provided ${context ? `(${context})` : ''}`);
            return false;
        }
        if (!token || String(token).length !== 6) {
            console.warn(`⚠️ [TOTP] Verification skipped — invalid token format ${context ? `(${context})` : ''}`);
            return false;
        }

        // verifySync is synchronous and returns { valid: boolean, delta?: number }
        const result = verifySync({
            token: String(token),
            secret,
            digits: TOTP_CONFIG.digits,
            period: TOTP_CONFIG.period,
            window: TOTP_CONFIG.window
        });

        if (result.valid) {
            console.log(`✅ [TOTP] Verification SUCCESS (delta: ${result.delta || 0}) ${context ? `(${context})` : ''}`);
            return true;
        }

        console.warn(`❌ [TOTP] Verification FAILED — invalid token ${context ? `(${context})` : ''}`);
        return false;
    } catch (err) {
        console.error(`❌ [TOTP] Verification ERROR ${context ? `(${context})` : ''}: ${err.message}`);
        return false;
    }
}

/**
 * Generate backup recovery codes.
 * @param {number} count - Number of codes to generate (default: 8)
 * @returns {Array<{code: string, used: boolean}>}
 */
function generateBackupCodes(count = 8) {
    const codes = [];
    for (let i = 0; i < count; i++) {
        const code = crypto.randomBytes(4).toString('hex').toUpperCase();
        // Format: XXXX-XXXX for readability
        const formatted = `${code.slice(0, 4)}-${code.slice(4)}`;
        codes.push({ code: formatted, used: false });
    }
    return codes;
}

/**
 * Encrypt a TOTP secret for database storage.
 * @param {string} secret - Plaintext TOTP secret
 * @returns {string} Encrypted secret
 */
function encryptTotpSecret(secret) {
    const encrypted = encrypt(secret);
    console.log(`🔒 [TOTP] Secret encrypted for storage (${encrypted ? 'OK' : 'FAILED'})`);
    return encrypted;
}

/**
 * Decrypt a stored TOTP secret.
 * @param {string} encrypted - Encrypted TOTP secret
 * @returns {string} Plaintext TOTP secret
 * @throws {Error} If decryption fails
 */
function decryptTotpSecret(encrypted) {
    return decrypt(encrypted);
}

/**
 * Safely decrypt a stored TOTP secret — returns null instead of throwing.
 * Use this in verification flows where a corrupted secret should not crash the server.
 * @param {string} encrypted - Encrypted TOTP secret (may be null/corrupted)
 * @param {string} [context] - Optional context for logging
 * @returns {string|null} Plaintext TOTP secret or null if decryption fails
 */
function safeDecryptTotpSecret(encrypted, context = '') {
    if (!encrypted) {
        console.warn(`⚠️ [TOTP] Secret is null/empty — cannot decrypt ${context ? `(${context})` : ''}`);
        return null;
    }
    try {
        const secret = decrypt(encrypted);
        if (!secret || secret === encrypted) {
            // decrypt() returns the original text if it can't parse — treat as failure
            console.warn(`⚠️ [TOTP] Secret decryption returned raw value — possibly corrupted ${context ? `(${context})` : ''}`);
            return null;
        }
        console.log(`🔓 [TOTP] Secret decrypted successfully ${context ? `(${context})` : ''}`);
        return secret;
    } catch (err) {
        console.error(`❌ [TOTP] Secret decryption FAILED ${context ? `(${context})` : ''}: ${err.message}`);
        return null;
    }
}

/**
 * Verify a backup code and mark it as used.
 * @param {string} inputCode - User-provided backup code
 * @param {Array<{code: string, used: boolean}>} backupCodes - Stored backup codes
 * @returns {{ valid: boolean, updatedCodes: Array }}
 */
function verifyBackupCode(inputCode, backupCodes) {
    const normalized = inputCode.trim().toUpperCase();
    const updatedCodes = backupCodes.map(bc => {
        if (bc.code === normalized && !bc.used) {
            return { ...bc, used: true };
        }
        return bc;
    });

    const wasUsed = updatedCodes.some(
        (bc, i) => bc.used && !backupCodes[i].used
    );

    return { valid: wasUsed, updatedCodes };
}

module.exports = {
    generateTotpSecret,
    generateQrDataUrl,
    verifyTotp,
    generateBackupCodes,
    encryptTotpSecret,
    decryptTotpSecret,
    safeDecryptTotpSecret,
    verifyBackupCode
};
