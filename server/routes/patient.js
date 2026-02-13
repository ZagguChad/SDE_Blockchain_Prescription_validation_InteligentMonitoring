const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const PrescriptionLog = require('../models/PrescriptionLog');
const { decrypt } = require('../utils/encryption');
const {
    createChallengeMessage,
    verifyPatientSignature,
    verifyCommitmentMatch,
    validateChallengeTimestamp
} = require('../utils/patientCrypto');

// Middleware to protect patient routes
const protectPatient = (req, res, next) => {
    let token;

    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            if (decoded.type !== 'patient') {
                return res.status(401).json({ message: 'Invalid patient token' });
            }

            req.patient = {
                prescriptionId: decoded.prescriptionId
            };

            next();
        } catch (error) {
            console.error(error);
            return res.status(401).json({ message: 'Not authorized, token failed' });
        }
    } else {
        return res.status(401).json({ message: 'Not authorized, no token' });
    }
};

// @route   POST /api/patient/access
// @desc    Patient authentication — supports BOTH legacy (username) and ZKP (signature) login
// @access  Public
router.post('/access', async (req, res) => {
    try {
        const mongoose = require('mongoose');
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({
                message: 'Service temporarily unavailable. Database connection not ready.'
            });
        }

        const { patientUsername, prescriptionId, signature, timestamp } = req.body;

        // =========================================================================
        // MODE 1: ZKP Signature-Based Login (new prescriptions)
        // =========================================================================
        if (signature && prescriptionId && timestamp) {
            // Validate timestamp window (replay protection)
            const tsValidation = validateChallengeTimestamp(timestamp);
            if (!tsValidation.valid) {
                return res.status(401).json({
                    message: `Authentication failed: ${tsValidation.error}`
                });
            }

            // Find prescription
            const prescription = await PrescriptionLog.findOne({ blockchainId: prescriptionId });
            if (!prescription) {
                return res.status(400).json({ message: 'Invalid credentials' });
            }

            // Check if this prescription has a commitment
            if (!prescription.patientCommitment) {
                return res.status(400).json({
                    message: 'This prescription does not support signature-based login. Use username login instead.'
                });
            }

            // Check prescription status
            if (prescription.status === 'DISPENSED') {
                return res.status(403).json({ message: 'This prescription has been dispensed. Access is no longer available.' });
            }
            if (prescription.status === 'EXPIRED') {
                return res.status(403).json({ message: 'This prescription has expired. Access is no longer available.' });
            }
            if (prescription.status !== 'ACTIVE') {
                return res.status(403).json({ message: 'This prescription is not active.' });
            }

            // Verify signature: recover address from signed challenge
            const challengeMessage = createChallengeMessage(prescriptionId, timestamp);
            const sigResult = verifyPatientSignature(challengeMessage, signature);

            if (!sigResult.valid) {
                return res.status(401).json({ message: 'Invalid signature' });
            }

            // Verify commitment: keccak256(recoveredAddress || DOB) === storedCommitment
            const commitmentMatch = verifyCommitmentMatch(
                sigResult.recoveredAddress,
                prescription.patientDOB,
                prescription.patientCommitment
            );

            if (!commitmentMatch) {
                return res.status(401).json({ message: 'Ownership verification failed. Invalid key.' });
            }

            // SUCCESS: Create token
            const token = jwt.sign(
                {
                    prescriptionId: prescriptionId,
                    type: 'patient',
                    authMethod: 'zkp-signature'
                },
                process.env.JWT_SECRET,
                { expiresIn: '7d' }
            );

            return res.json({
                success: true,
                token,
                prescriptionId: prescription.blockchainId,
                authMethod: 'zkp-signature'
            });
        }

        // =========================================================================
        // MODE 2: Legacy Username Login (backward compatibility for old prescriptions)
        // =========================================================================
        if (patientUsername && prescriptionId) {
            const prescription = await PrescriptionLog.findOne({ blockchainId: prescriptionId });

            if (!prescription) {
                return res.status(400).json({ message: 'Invalid credentials' });
            }

            // Verify username matches exactly
            if (prescription.patientUsername !== patientUsername) {
                return res.status(400).json({ message: 'Invalid credentials' });
            }

            // Check prescription status
            if (prescription.status === 'DISPENSED') {
                return res.status(403).json({ message: 'This prescription has been dispensed. Access is no longer available.' });
            }
            if (prescription.status === 'EXPIRED') {
                return res.status(403).json({ message: 'This prescription has expired. Access is no longer available.' });
            }
            if (prescription.status !== 'ACTIVE') {
                return res.status(403).json({ message: 'This prescription is not active.' });
            }

            const token = jwt.sign(
                {
                    prescriptionId: prescriptionId,
                    type: 'patient',
                    authMethod: 'legacy-username'
                },
                process.env.JWT_SECRET,
                { expiresIn: '7d' }
            );

            return res.json({
                success: true,
                token,
                prescriptionId: prescription.blockchainId,
                authMethod: 'legacy-username'
            });
        }

        // =========================================================================
        // Neither mode provided
        // =========================================================================
        return res.status(400).json({
            message: 'Please provide either (signature + prescriptionId + timestamp) or (patientUsername + prescriptionId)'
        });

    } catch (error) {
        console.error('Patient Access Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/patient/prescription/:id
// @desc    Get prescription details for patient
// @access  Private (Patient only)
router.get('/prescription/:id', protectPatient, async (req, res) => {
    try {
        const { id } = req.params;

        // Verify patient can only access their own prescription
        if (req.patient.prescriptionId !== id) {
            return res.status(403).json({
                success: false,
                message: 'Access Denied: You can only view your own prescription.'
            });
        }

        const prescription = await PrescriptionLog.findOne({ blockchainId: id });

        if (!prescription) {
            return res.status(404).json({ success: false, message: 'Prescription not found' });
        }

        if (prescription.status === 'DISPENSED') {
            return res.status(403).json({
                success: false,
                message: 'This prescription has been dispensed and is no longer accessible.'
            });
        }

        if (prescription.status === 'EXPIRED') {
            return res.status(403).json({
                success: false,
                message: 'This prescription has expired and is no longer accessible.'
            });
        }

        // Decrypt sensitive data
        const decryptedPrescription = prescription.toObject();
        decryptedPrescription.patientName = decrypt(prescription.patientName);
        decryptedPrescription.diagnosis = decrypt(prescription.diagnosis);
        decryptedPrescription.allergies = decrypt(prescription.allergies);
        decryptedPrescription.notes = decrypt(prescription.notes);
        decryptedPrescription.medicines = prescription.medicines.map(m => ({
            ...m,
            instructions: decrypt(m.instructions)
        }));

        // Strip sensitive crypto fields from response
        delete decryptedPrescription.patientPublicKey;
        delete decryptedPrescription.patientAddress;

        res.json({ success: true, data: decryptedPrescription });

    } catch (error) {
        console.error('Patient Prescription Fetch Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
