/**
 * Adaptive MFA Middleware
 * 
 * Express middleware that enforces MFA requirements based on
 * risk level for high-risk operations (dispensing, consent, etc).
 * 
 * Usage:
 *   router.post('/dispense', protectPatient, requireMfa('high'), handler);
 */

const jwt = require('jsonwebtoken');
const PrescriptionLog = require('../models/PrescriptionLog');
const { assessRiskLevel, checkMfaSatisfaction } = require('../utils/riskEngine');

/**
 * Create MFA enforcement middleware for a specific action.
 * 
 * @param {string} action - Action name matching riskEngine config (e.g., 'dispense')
 * @returns {function} Express middleware
 */
function requireMfa(action) {
    return async (req, res, next) => {
        try {
            const riskLevel = assessRiskLevel(action);

            // Low risk: no additional MFA needed beyond initial auth
            if (riskLevel === 'low') {
                return next();
            }

            // Get the MFA token from the request header
            const mfaHeader = req.headers['x-mfa-token'];
            if (!mfaHeader) {
                return res.status(403).json({
                    message: 'Additional MFA verification required for this operation.',
                    requiredLevel: riskLevel,
                    action
                });
            }

            // Decode the MFA verification token
            let mfaPayload;
            try {
                mfaPayload = jwt.verify(mfaHeader, process.env.JWT_SECRET);
            } catch (err) {
                return res.status(403).json({
                    message: 'Invalid or expired MFA token.',
                    requiredLevel: riskLevel
                });
            }

            if (mfaPayload.type !== 'mfa-verified') {
                return res.status(403).json({
                    message: 'Invalid MFA token type.'
                });
            }

            // Lookup prescription MFA status
            const prescriptionId = req.patient?.prescriptionId || req.body?.prescriptionId;
            if (!prescriptionId) {
                return res.status(400).json({ message: 'Prescription ID required for MFA verification.' });
            }

            const prescription = await PrescriptionLog.findOne({ blockchainId: prescriptionId });
            if (!prescription) {
                return res.status(404).json({ message: 'Prescription not found.' });
            }

            const patientMfaStatus = {
                emailOtpEnabled: prescription.emailOtpEnabled !== false,
                totpEnabled: prescription.totpEnabled === true
            };

            const completedMethods = mfaPayload.completedMethods || [];
            const { satisfied, missing } = checkMfaSatisfaction(completedMethods, riskLevel, patientMfaStatus);

            if (!satisfied) {
                return res.status(403).json({
                    message: 'Insufficient MFA verification for this operation.',
                    requiredLevel: riskLevel,
                    missingMethods: missing
                });
            }

            // MFA satisfied — proceed
            req.mfaVerified = true;
            req.mfaLevel = riskLevel;
            next();

        } catch (error) {
            console.error('MFA Middleware Error:', error);
            res.status(500).json({ message: 'MFA verification error.' });
        }
    };
}

module.exports = { requireMfa };
