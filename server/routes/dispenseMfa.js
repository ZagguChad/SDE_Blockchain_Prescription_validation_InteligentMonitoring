/**
 * Dispense MFA Routes — Pharmacy-Side Patient Re-Verification
 * 
 * Provides TOTP and email OTP verification at the pharmacy counter
 * before final medicine dispensing. This is a SECONDARY verification layer.
 * Blockchain identity remains the PRIMARY identity system.
 * 
 * Endpoints:
 *   GET  /api/dispense-mfa/status/:prescriptionId  — Get patient MFA config
 *   POST /api/dispense-mfa/verify-totp              — Verify authenticator code
 *   POST /api/dispense-mfa/send-otp                 — Send email OTP to patient
 *   POST /api/dispense-mfa/verify-otp               — Verify email OTP
 * 
 * All endpoints require pharmacy authentication.
 * Does NOT modify existing auth, MFA, or dispensing routes.
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const PrescriptionLog = require('../models/PrescriptionLog');
const DispenseOtpToken = require('../models/DispenseOtpToken');

const { generateOtp, hashOtp, verifyOtp } = require('../utils/emailOtp');
const { sendDispenseVerificationEmail } = require('../utils/emailService');
const { decrypt } = require('../utils/encryption');
const { verifyTotp, safeDecryptTotpSecret } = require('../utils/totpService');
const { protect, authorize } = require('../middleware/authMiddleware');
const {
    dispenseOtpRequestLimiter,
    dispenseOtpVerifyLimiter,
    dispenseTotpVerifyLimiter
} = require('../middleware/rateLimiter');

// ============================================================
// GET /api/dispense-mfa/status/:prescriptionId
// Returns patient's MFA configuration for pharmacy UI
// ============================================================
router.get('/status/:prescriptionId', protect, authorize('pharmacy'), async (req, res) => {
    try {
        const { prescriptionId } = req.params;

        const prescription = await PrescriptionLog.findOne({ blockchainId: prescriptionId });
        if (!prescription) {
            return res.status(404).json({ success: false, message: 'Prescription not found.' });
        }

        // Check if prescription is in a valid state for dispensing
        if (prescription.status !== 'ACTIVE') {
            return res.status(400).json({
                success: false,
                message: `Prescription is in ${prescription.status} state — cannot dispense.`
            });
        }

        // Determine MFA availability
        const totpEnabled = prescription.totpEnabled === true && !!prescription.totpSecretEncrypted;
        const emailAvailable = !!prescription.patientEmail;

        // Check dispense lockout
        const isLocked = prescription.dispenseOtpLockedUntil && new Date() < prescription.dispenseOtpLockedUntil;
        let lockRemainingSeconds = 0;
        if (isLocked) {
            lockRemainingSeconds = Math.ceil((prescription.dispenseOtpLockedUntil - Date.now()) / 1000);
        }

        // Mask email for display
        let maskedEmail = null;
        if (emailAvailable) {
            try {
                const plainEmail = decrypt(prescription.patientEmail);
                maskedEmail = plainEmail.replace(
                    /^(.{1,2})[^@]*(@.*)$/,
                    (_, prefix, domain) => `${prefix}${'*'.repeat(5)}${domain}`
                );
            } catch {
                maskedEmail = '***@***.***';
            }
        }

        // Determine if MFA verification is required
        const mfaRequired = totpEnabled || emailAvailable;

        // Safely decrypt patient name for display
        let patientNamePlain = 'Patient';
        try {
            patientNamePlain = decrypt(prescription.patientName) || 'Patient';
        } catch {
            console.warn(`⚠️ [DISPENSE-MFA] Could not decrypt patientName for ${prescriptionId}`);
        }

        res.json({
            success: true,
            mfaRequired,
            totpEnabled,
            emailAvailable,
            maskedEmail,
            isLocked,
            lockRemainingSeconds,
            patientName: patientNamePlain
        });

    } catch (error) {
        console.error('❌ Dispense MFA Status Error:', error.message);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ============================================================
// POST /api/dispense-mfa/verify-totp
// Pharmacist enters patient's Google Authenticator code
// ============================================================
router.post('/verify-totp', protect, authorize('pharmacy'), dispenseTotpVerifyLimiter, async (req, res) => {
    try {
        const { prescriptionId, token: totpToken } = req.body;

        if (!prescriptionId) {
            return res.status(400).json({ success: false, message: 'prescriptionId is required.' });
        }
        if (!totpToken || String(totpToken).length !== 6) {
            return res.status(400).json({ success: false, message: 'A 6-digit authenticator code is required.' });
        }

        const prescription = await PrescriptionLog.findOne({ blockchainId: prescriptionId });
        if (!prescription) {
            return res.status(404).json({ success: false, message: 'Prescription not found.' });
        }

        if (!prescription.totpEnabled || !prescription.totpSecretEncrypted) {
            return res.status(400).json({ success: false, message: 'TOTP is not enabled for this patient.' });
        }

        // Safely decrypt the TOTP secret — never crash on corrupted data
        const secret = safeDecryptTotpSecret(prescription.totpSecretEncrypted, `dispense:${prescriptionId}`);

        if (!secret) {
            // Secret is missing or corrupted — cannot verify TOTP, suggest email OTP
            console.error(`❌ [DISPENSE-MFA] TOTP secret missing/corrupted for ${prescriptionId} — fallback to OTP`);
            return res.status(400).json({
                success: false,
                message: 'Authenticator setup is unavailable. Please use email verification instead.',
                canFallbackToOtp: !!prescription.patientEmail,
                secretMissing: true
            });
        }

        const isValid = verifyTotp(totpToken, secret, `dispense:${prescriptionId}`);

        if (!isValid) {
            console.warn(`⚠️ [DISPENSE-MFA] TOTP verification failed for ${prescriptionId}`);
            return res.status(400).json({
                success: false,
                message: 'Invalid authenticator code. Please try again or use email OTP.',
                canFallbackToOtp: !!prescription.patientEmail
            });
        }

        // Success — issue short-lived dispense MFA token
        const mfaToken = jwt.sign(
            {
                prescriptionId,
                type: 'dispense-mfa',
                method: 'totp',
                pharmacyUserId: req.user.id,
                verifiedAt: Date.now()
            },
            process.env.JWT_SECRET,
            { expiresIn: '10m' }
        );

        console.log(`✅ [DISPENSE-MFA] TOTP verified for ${prescriptionId}`);

        res.json({
            success: true,
            mfaToken,
            method: 'totp',
            message: 'Patient identity verified via authenticator.',
            expiresInSeconds: 600
        });

    } catch (error) {
        console.error('❌ Dispense TOTP Verify Error:', error.message);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ============================================================
// POST /api/dispense-mfa/send-otp
// Send email OTP to patient as fallback verification
// ============================================================
router.post('/send-otp', protect, authorize('pharmacy'), dispenseOtpRequestLimiter, async (req, res) => {
    try {
        const { prescriptionId } = req.body;

        if (!prescriptionId) {
            return res.status(400).json({ success: false, message: 'prescriptionId is required.' });
        }

        const prescription = await PrescriptionLog.findOne({ blockchainId: prescriptionId });
        if (!prescription) {
            return res.status(404).json({ success: false, message: 'Prescription not found.' });
        }

        if (!prescription.patientEmail) {
            return res.status(400).json({ success: false, message: 'No email on file for this patient.' });
        }

        // Check lockout
        if (prescription.dispenseOtpLockedUntil && new Date() < prescription.dispenseOtpLockedUntil) {
            const remainingMs = prescription.dispenseOtpLockedUntil - Date.now();
            return res.status(429).json({
                success: false,
                message: 'Verification temporarily locked due to too many failed attempts.',
                retryAfterSeconds: Math.ceil(remainingMs / 1000)
            });
        }

        // Invalidate any previous unused dispense OTPs for this prescription
        await DispenseOtpToken.updateMany(
            { prescriptionId, used: false },
            { $set: { used: true } }
        );

        // Generate and store new OTP
        const otp = generateOtp();
        const otpHash = hashOtp(otp);

        await DispenseOtpToken.create({
            prescriptionId,
            otpHash,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000)
        });

        // Decrypt patient info for sending
        const patientEmail = decrypt(prescription.patientEmail);
        const patientName = decrypt(prescription.patientName);

        // Send verification email with single retry on failure
        let emailResult = await sendDispenseVerificationEmail(patientEmail, patientName, otp, prescriptionId);

        if (!emailResult.success) {
            console.warn(`⚠️ [DISPENSE-MFA] Email send failed for ${prescriptionId}, retrying in 2s...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            emailResult = await sendDispenseVerificationEmail(patientEmail, patientName, otp, prescriptionId);
        }

        if (!emailResult.success) {
            console.error(`❌ [DISPENSE-MFA] Email send failed after retry for ${prescriptionId}: ${emailResult.error}`);
            return res.status(500).json({
                success: false,
                message: 'Failed to send verification email after retry. Please try again later.'
            });
        }

        // Mask email for display
        const maskedEmail = patientEmail.replace(
            /^(.{1,2})[^@]*(@.*)$/,
            (_, prefix, domain) => `${prefix}${'*'.repeat(5)}${domain}`
        );

        console.log(`📧 [DISPENSE-MFA] OTP sent to ${maskedEmail} for ${prescriptionId}`);

        res.json({
            success: true,
            message: 'Verification code sent to patient email.',
            maskedEmail,
            expiresInSeconds: 300
        });

    } catch (error) {
        console.error('❌ Dispense Send-OTP Error:', error.message);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ============================================================
// POST /api/dispense-mfa/verify-otp
// Verify email OTP entered at pharmacy counter
// ============================================================
router.post('/verify-otp', protect, authorize('pharmacy'), dispenseOtpVerifyLimiter, async (req, res) => {
    try {
        const { prescriptionId, otp } = req.body;

        if (!prescriptionId) {
            return res.status(400).json({ success: false, message: 'prescriptionId is required.' });
        }
        if (!otp || String(otp).length !== 6) {
            return res.status(400).json({ success: false, message: 'A 6-digit verification code is required.' });
        }

        const prescription = await PrescriptionLog.findOne({ blockchainId: prescriptionId });
        if (!prescription) {
            return res.status(404).json({ success: false, message: 'Prescription not found.' });
        }

        // Check lockout
        if (prescription.dispenseOtpLockedUntil && new Date() < prescription.dispenseOtpLockedUntil) {
            const remainingMs = prescription.dispenseOtpLockedUntil - Date.now();
            return res.status(429).json({
                success: false,
                message: 'Verification temporarily locked.',
                retryAfterSeconds: Math.ceil(remainingMs / 1000)
            });
        }

        // Find the latest unused dispense OTP
        const otpToken = await DispenseOtpToken.findOne({
            prescriptionId,
            used: false,
            expiresAt: { $gt: new Date() }
        }).sort({ createdAt: -1 });

        if (!otpToken) {
            return res.status(400).json({
                success: false,
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
            prescription.dispenseOtpAttempts = (prescription.dispenseOtpAttempts || 0) + 1;

            // Lock after 5 failed attempts
            if (prescription.dispenseOtpAttempts >= 5) {
                prescription.dispenseOtpLockedUntil = new Date(Date.now() + 30 * 60 * 1000);
                prescription.dispenseOtpAttempts = 0;
                await prescription.save();

                console.warn(`🔒 [DISPENSE-MFA] OTP lockout triggered for ${prescriptionId}`);
                return res.status(429).json({
                    success: false,
                    message: 'Too many failed attempts. Verification locked for 30 minutes.',
                    retryAfterSeconds: 1800
                });
            }

            await prescription.save();
            return res.status(400).json({
                success: false,
                message: 'Invalid verification code.',
                attemptsRemaining: 5 - prescription.dispenseOtpAttempts
            });
        }

        // OTP valid — mark as used (replay protection)
        otpToken.used = true;
        await otpToken.save();

        // Reset attempt counters
        prescription.dispenseOtpAttempts = 0;
        prescription.dispenseOtpLockedUntil = null;
        await prescription.save();

        // Issue short-lived dispense MFA token
        const mfaToken = jwt.sign(
            {
                prescriptionId,
                type: 'dispense-mfa',
                method: 'emailOtp',
                pharmacyUserId: req.user.id,
                verifiedAt: Date.now()
            },
            process.env.JWT_SECRET,
            { expiresIn: '10m' }
        );

        console.log(`✅ [DISPENSE-MFA] Email OTP verified for ${prescriptionId}`);

        res.json({
            success: true,
            mfaToken,
            method: 'emailOtp',
            message: 'Patient identity verified via email code.',
            expiresInSeconds: 600
        });

    } catch (error) {
        console.error('❌ Dispense Verify-OTP Error:', error.message);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

module.exports = router;
