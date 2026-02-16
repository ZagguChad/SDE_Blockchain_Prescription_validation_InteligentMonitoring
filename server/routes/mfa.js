/**
 * MFA Routes — Adaptive Multi-Factor Authentication
 * 
 * All MFA endpoints in a single, modular route file.
 * Does NOT modify existing auth or patient routes.
 * 
 * Endpoints:
 *   POST /api/mfa/request-otp     — Send OTP email
 *   POST /api/mfa/verify-otp      — Verify OTP & upgrade token
 *   POST /api/mfa/enable-totp     — Generate TOTP secret + QR
 *   POST /api/mfa/verify-totp     — Verify TOTP token
 *   POST /api/mfa/disable-totp    — Disable TOTP
 *   GET  /api/mfa/challenge       — Generate blockchain nonce
 *   POST /api/mfa/verify-challenge — Verify blockchain signature
 *   GET  /api/mfa/status          — Get patient MFA status
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { ethers } = require('ethers');

const PrescriptionLog = require('../models/PrescriptionLog');
const OtpToken = require('../models/OtpToken');
const AuthChallenge = require('../models/AuthChallenge');

const { generateOtp, hashOtp, verifyOtp } = require('../utils/emailOtp');
const { sendOtpEmail } = require('../utils/emailService');
const { decrypt } = require('../utils/encryption');
const {
    generateTotpSecret,
    generateQrDataUrl,
    verifyTotp,
    generateBackupCodes,
    encryptTotpSecret,
    decryptTotpSecret,
    safeDecryptTotpSecret,
    verifyBackupCode
} = require('../utils/totpService');
const { otpRequestLimiter, otpVerifyLimiter, totpVerifyLimiter } = require('../middleware/rateLimiter');

// ============================================================
// Helper: Verify a pendingMfa token (issued after credential check)
// ============================================================
function verifyMfaToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // Accept all valid patient token types:
        // - patient-pending-mfa: issued after credential check (pre-OTP)
        // - patient-pending-totp: issued after OTP verified, awaiting TOTP
        // - patient: fully authenticated patient token
        const validTypes = ['patient-pending-mfa', 'patient-pending-totp', 'patient'];
        if (!validTypes.includes(decoded.type)) {
            return null;
        }
        return decoded;
    } catch (err) {
        return null;
    }
}

// ============================================================
// POST /api/mfa/request-otp
// ============================================================
router.post('/request-otp', otpRequestLimiter, async (req, res) => {
    try {
        const decoded = verifyMfaToken(req);
        if (!decoded) {
            return res.status(401).json({ message: 'Valid authentication token required.' });
        }

        const prescriptionId = decoded.prescriptionId;
        const prescription = await PrescriptionLog.findOne({ blockchainId: prescriptionId });
        if (!prescription) {
            return res.status(404).json({ message: 'Prescription not found.' });
        }

        // Check lockout
        if (prescription.otpLockedUntil && new Date() < prescription.otpLockedUntil) {
            const remainingMs = prescription.otpLockedUntil - Date.now();
            return res.status(429).json({
                message: 'Account temporarily locked due to too many failed attempts.',
                retryAfterSeconds: Math.ceil(remainingMs / 1000)
            });
        }

        // Invalidate any previous unused OTPs for this prescription
        await OtpToken.updateMany(
            { prescriptionId, used: false },
            { $set: { used: true } }
        );

        // Generate and store new OTP
        const otp = generateOtp();
        const otpHash = hashOtp(otp);

        await OtpToken.create({
            prescriptionId,
            otpHash,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
        });

        // Update last request timestamp
        prescription.lastOtpRequest = new Date();
        await prescription.save();

        // Decrypt patient email and name for sending
        const patientEmail = decrypt(prescription.patientEmail);
        const patientName = decrypt(prescription.patientName);

        // Send OTP email
        const emailResult = await sendOtpEmail(patientEmail, patientName, otp, prescriptionId);

        if (!emailResult.success) {
            return res.status(500).json({
                message: 'Failed to send verification email. Please try again.',
                error: emailResult.error
            });
        }

        // Mask email for display: j***@gmail.com
        const maskedEmail = patientEmail.replace(
            /^(.{1,2})[^@]*(@.*)$/,
            (_, prefix, domain) => `${prefix}${'*'.repeat(5)}${domain}`
        );

        res.json({
            success: true,
            message: 'Verification code sent to your email.',
            maskedEmail,
            expiresInSeconds: 300
        });

    } catch (error) {
        console.error('Request OTP Error:', error);
        res.status(500).json({ message: 'Server error.' });
    }
});

// ============================================================
// POST /api/mfa/verify-otp
// ============================================================
router.post('/verify-otp', otpVerifyLimiter, async (req, res) => {
    try {
        const decoded = verifyMfaToken(req);
        if (!decoded) {
            return res.status(401).json({ message: 'Valid authentication token required.' });
        }

        const { otp } = req.body;
        if (!otp || String(otp).length !== 6) {
            return res.status(400).json({ message: 'A 6-digit verification code is required.' });
        }

        const prescriptionId = decoded.prescriptionId;
        const prescription = await PrescriptionLog.findOne({ blockchainId: prescriptionId });
        if (!prescription) {
            return res.status(404).json({ message: 'Prescription not found.' });
        }

        // Check lockout
        if (prescription.otpLockedUntil && new Date() < prescription.otpLockedUntil) {
            const remainingMs = prescription.otpLockedUntil - Date.now();
            return res.status(429).json({
                message: 'Account temporarily locked.',
                retryAfterSeconds: Math.ceil(remainingMs / 1000)
            });
        }

        // Find the latest unused OTP for this prescription
        const otpToken = await OtpToken.findOne({
            prescriptionId,
            used: false,
            expiresAt: { $gt: new Date() }
        }).sort({ createdAt: -1 });

        if (!otpToken) {
            return res.status(400).json({
                message: 'No valid verification code found. Please request a new one.'
            });
        }

        // Track attempts
        otpToken.attempts++;

        // Verify OTP
        const isValid = verifyOtp(otp, otpToken.otpHash);

        if (!isValid) {
            await otpToken.save();

            // Track failed attempts on prescription
            prescription.otpAttempts = (prescription.otpAttempts || 0) + 1;

            // Lock after 5 failed attempts
            if (prescription.otpAttempts >= 5) {
                prescription.otpLockedUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 min lockout
                prescription.otpAttempts = 0;
                await prescription.save();
                return res.status(429).json({
                    message: 'Too many failed attempts. Account locked for 30 minutes.',
                    retryAfterSeconds: 1800
                });
            }

            await prescription.save();
            return res.status(400).json({
                message: 'Invalid verification code.',
                attemptsRemaining: 5 - prescription.otpAttempts
            });
        }

        // OTP valid — mark as used (replay protection)
        otpToken.used = true;
        await otpToken.save();

        // Reset attempt counters
        prescription.otpAttempts = 0;
        prescription.otpLockedUntil = null;
        await prescription.save();

        // Check if TOTP is also required
        if (prescription.totpEnabled) {
            // Issue a partial token with OTP completed
            const partialToken = jwt.sign(
                {
                    prescriptionId,
                    type: 'patient-pending-totp',
                    completedMethods: ['emailOtp'],
                    authMethod: decoded.authMethod || 'legacy-username'
                },
                process.env.JWT_SECRET,
                { expiresIn: '10m' }
            );

            return res.json({
                success: true,
                pendingTotp: true,
                token: partialToken,
                message: 'OTP verified. Please enter your authenticator code.'
            });
        }

        // OTP only — issue full patient JWT
        const fullToken = jwt.sign(
            {
                prescriptionId,
                type: 'patient',
                authMethod: decoded.authMethod || 'legacy-username',
                mfaCompleted: ['emailOtp']
            },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            token: fullToken,
            prescriptionId,
            authMethod: decoded.authMethod || 'legacy-username',
            mfaCompleted: ['emailOtp']
        });

    } catch (error) {
        console.error('Verify OTP Error:', error);
        res.status(500).json({ message: 'Server error.' });
    }
});

// ============================================================
// POST /api/mfa/enable-totp
// ============================================================
router.post('/enable-totp', async (req, res) => {
    try {
        const decoded = verifyMfaToken(req);
        if (!decoded || decoded.type !== 'patient') {
            return res.status(401).json({ message: 'Authenticated patient token required.' });
        }

        const prescriptionId = decoded.prescriptionId;
        const prescription = await PrescriptionLog.findOne({ blockchainId: prescriptionId });
        if (!prescription) {
            return res.status(404).json({ message: 'Prescription not found.' });
        }

        if (prescription.totpEnabled) {
            return res.status(400).json({ message: 'TOTP is already enabled.' });
        }

        // Generate secret and QR code
        const secret = generateTotpSecret();
        const qrDataUrl = await generateQrDataUrl(secret, `Rx-${prescriptionId}`);
        const backupCodes = generateBackupCodes();

        // Encrypt and store secret
        prescription.totpSecretEncrypted = encryptTotpSecret(secret);
        prescription.totpBackupCodes = backupCodes;
        // Don't enable yet — wait for verification
        await prescription.save();

        res.json({
            success: true,
            qrCodeDataUrl: qrDataUrl,
            manualEntryKey: secret,
            backupCodes: backupCodes.map(bc => bc.code),
            message: 'Scan the QR code with Google Authenticator, then verify with a code to activate.'
        });

    } catch (error) {
        console.error('Enable TOTP Error:', error);
        res.status(500).json({ message: 'Server error.' });
    }
});

// ============================================================
// POST /api/mfa/verify-totp
// ============================================================
router.post('/verify-totp', totpVerifyLimiter, async (req, res) => {
    try {
        const decoded = verifyMfaToken(req);
        if (!decoded) {
            return res.status(401).json({ message: 'Valid authentication token required.' });
        }

        const { token: totpToken, backupCode } = req.body;
        if (!totpToken && !backupCode) {
            return res.status(400).json({ message: 'Authenticator code or backup code is required.' });
        }

        const prescriptionId = decoded.prescriptionId;
        const prescription = await PrescriptionLog.findOne({ blockchainId: prescriptionId });
        if (!prescription) {
            return res.status(404).json({ message: 'Prescription not found.' });
        }

        if (!prescription.totpSecretEncrypted) {
            return res.status(400).json({ message: 'TOTP not set up. Please enable it first.' });
        }

        // Safely decrypt — never crash on corrupted secrets
        const secret = safeDecryptTotpSecret(prescription.totpSecretEncrypted, `mfa:${prescriptionId}`);

        if (!secret) {
            console.error(`❌ [MFA] TOTP secret missing/corrupted for ${prescriptionId}`);
            return res.status(400).json({
                success: false,
                message: 'Authenticator setup is unavailable. Please re-enable TOTP or contact support.'
            });
        }

        let isValid = false;

        if (backupCode) {
            // Verify backup code
            const result = verifyBackupCode(backupCode, prescription.totpBackupCodes || []);
            if (result.valid) {
                prescription.totpBackupCodes = result.updatedCodes;
                isValid = true;
            }
        } else {
            // Verify TOTP token
            isValid = verifyTotp(totpToken, secret, `mfa:${prescriptionId}`);
        }

        if (!isValid) {
            return res.status(400).json({ message: 'Invalid authenticator code.' });
        }

        // If TOTP was not yet enabled (first-time setup verification), enable it now
        if (!prescription.totpEnabled) {
            prescription.totpEnabled = true;
            prescription.mfaLevel = 'medium';
            await prescription.save();

            return res.json({
                success: true,
                message: 'Google Authenticator successfully activated!',
                totpEnabled: true
            });
        }

        await prescription.save();

        // TOTP verified during login flow — issue full token
        const completedMethods = decoded.completedMethods || [];
        completedMethods.push('totp');

        const fullToken = jwt.sign(
            {
                prescriptionId,
                type: 'patient',
                authMethod: decoded.authMethod || 'legacy-username',
                mfaCompleted: completedMethods
            },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Also generate an MFA verification token for high-risk ops
        const mfaToken = jwt.sign(
            {
                prescriptionId,
                type: 'mfa-verified',
                completedMethods
            },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.json({
            success: true,
            token: fullToken,
            mfaToken,
            prescriptionId,
            authMethod: decoded.authMethod || 'legacy-username',
            mfaCompleted: completedMethods
        });

    } catch (error) {
        console.error('Verify TOTP Error:', error);
        res.status(500).json({ message: 'Server error.' });
    }
});

// ============================================================
// POST /api/mfa/disable-totp
// ============================================================
router.post('/disable-totp', async (req, res) => {
    try {
        const decoded = verifyMfaToken(req);
        if (!decoded || decoded.type !== 'patient') {
            return res.status(401).json({ message: 'Authenticated patient token required.' });
        }

        const { token: totpToken } = req.body;
        if (!totpToken) {
            return res.status(400).json({ message: 'Current authenticator code required to disable TOTP.' });
        }

        const prescriptionId = decoded.prescriptionId;
        const prescription = await PrescriptionLog.findOne({ blockchainId: prescriptionId });
        if (!prescription || !prescription.totpEnabled) {
            return res.status(400).json({ message: 'TOTP is not currently enabled.' });
        }

        // Verify current TOTP before disabling — safe decrypt
        const secret = safeDecryptTotpSecret(prescription.totpSecretEncrypted, `disable:${prescriptionId}`);
        if (!secret) {
            // Secret corrupted — allow disable without verification since user already authenticated
            console.warn(`⚠️ [MFA] Corrupt TOTP secret during disable for ${prescriptionId} — allowing disable`);
        } else if (!verifyTotp(totpToken, secret, `disable:${prescriptionId}`)) {
            return res.status(400).json({ message: 'Invalid authenticator code.' });
        }

        // Disable TOTP
        prescription.totpEnabled = false;
        prescription.totpSecretEncrypted = null;
        prescription.totpBackupCodes = [];
        prescription.mfaLevel = 'low';
        await prescription.save();

        res.json({
            success: true,
            message: 'Google Authenticator has been disabled.'
        });

    } catch (error) {
        console.error('Disable TOTP Error:', error);
        res.status(500).json({ message: 'Server error.' });
    }
});

// ============================================================
// GET /api/mfa/challenge
// ============================================================
router.get('/challenge', async (req, res) => {
    try {
        const decoded = verifyMfaToken(req);
        if (!decoded) {
            return res.status(401).json({ message: 'Valid authentication token required.' });
        }

        const prescriptionId = decoded.prescriptionId;

        // Generate random nonce
        const nonce = crypto.randomBytes(32).toString('hex');

        // Store with 5-minute expiry
        await AuthChallenge.create({
            nonce,
            prescriptionId,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000)
        });

        // Create the challenge message to sign
        const challengeMessage = `BlockRx-MFA-Challenge:${prescriptionId}:${nonce}`;

        res.json({
            success: true,
            nonce,
            challengeMessage,
            expiresInSeconds: 300
        });

    } catch (error) {
        console.error('Challenge Error:', error);
        res.status(500).json({ message: 'Server error.' });
    }
});

// ============================================================
// POST /api/mfa/verify-challenge
// ============================================================
router.post('/verify-challenge', async (req, res) => {
    try {
        const decoded = verifyMfaToken(req);
        if (!decoded) {
            return res.status(401).json({ message: 'Valid authentication token required.' });
        }

        const { nonce, signature } = req.body;
        if (!nonce || !signature) {
            return res.status(400).json({ message: 'Nonce and signature are required.' });
        }

        const prescriptionId = decoded.prescriptionId;

        // Find the challenge
        const challenge = await AuthChallenge.findOne({
            nonce,
            prescriptionId,
            used: false,
            expiresAt: { $gt: new Date() }
        });

        if (!challenge) {
            return res.status(400).json({ message: 'Invalid or expired challenge.' });
        }

        // Mark as used (replay protection)
        challenge.used = true;
        await challenge.save();

        // Verify signature
        const challengeMessage = `BlockRx-MFA-Challenge:${prescriptionId}:${nonce}`;
        let recoveredAddress;
        try {
            recoveredAddress = ethers.verifyMessage(challengeMessage, signature);
        } catch (err) {
            return res.status(400).json({ message: 'Invalid signature format.' });
        }

        // Verify against stored patient address
        const prescription = await PrescriptionLog.findOne({ blockchainId: prescriptionId });
        if (!prescription || !prescription.patientAddress) {
            return res.status(400).json({
                message: 'No blockchain identity linked to this prescription.'
            });
        }

        if (recoveredAddress.toLowerCase() !== prescription.patientAddress.toLowerCase()) {
            return res.status(401).json({ message: 'Signature does not match prescription owner.' });
        }

        // Issue MFA verification token with blockchain method
        const completedMethods = decoded.mfaCompleted || decoded.completedMethods || [];
        completedMethods.push('blockchainSignature');

        const mfaToken = jwt.sign(
            {
                prescriptionId,
                type: 'mfa-verified',
                completedMethods
            },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.json({
            success: true,
            mfaToken,
            message: 'Blockchain signature verified.',
            completedMethods
        });

    } catch (error) {
        console.error('Verify Challenge Error:', error);
        res.status(500).json({ message: 'Server error.' });
    }
});

// ============================================================
// GET /api/mfa/status
// ============================================================
router.get('/status', async (req, res) => {
    try {
        const decoded = verifyMfaToken(req);
        if (!decoded) {
            return res.status(401).json({ message: 'Valid authentication token required.' });
        }

        const prescriptionId = decoded.prescriptionId;
        const prescription = await PrescriptionLog.findOne({ blockchainId: prescriptionId });
        if (!prescription) {
            return res.status(404).json({ message: 'Prescription not found.' });
        }

        res.json({
            success: true,
            mfaStatus: {
                emailOtpEnabled: prescription.emailOtpEnabled !== false,
                totpEnabled: prescription.totpEnabled === true,
                mfaLevel: prescription.mfaLevel || 'low',
                hasBlockchainIdentity: !!prescription.patientAddress,
                backupCodesRemaining: (prescription.totpBackupCodes || []).filter(bc => !bc.used).length
            }
        });

    } catch (error) {
        console.error('MFA Status Error:', error);
        res.status(500).json({ message: 'Server error.' });
    }
});

module.exports = router;
