const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const PrescriptionLog = require('../models/PrescriptionLog');
const { decrypt } = require('../utils/encryption');

// Middleware to protect patient routes
const protectPatient = (req, res, next) => {
    let token;

    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        try {
            // Get token from header
            token = req.headers.authorization.split(' ')[1];

            // Verify token
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            // Validate this is a patient token
            if (decoded.type !== 'patient') {
                return res.status(401).json({ message: 'Invalid patient token' });
            }

            // Attach patient info to request
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
// @desc    Patient authentication using prescription credentials
// @access  Public
router.post('/access', async (req, res) => {
    const { patientUsername, prescriptionId } = req.body;

    try {
        if (!patientUsername || !prescriptionId) {
            return res.status(400).json({ message: 'Please provide both username and prescription ID' });
        }

        // Find prescription by blockchain ID
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

        // Create temporary session token
        const token = jwt.sign(
            {
                prescriptionId: prescriptionId,
                type: 'patient'
            },
            process.env.JWT_SECRET,
            { expiresIn: '7d' } // Valid for 7 days or until dispensed
        );

        res.json({
            success: true,
            token,
            prescriptionId: prescription.blockchainId
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

        // Check if prescription is still accessible
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

        res.json({ success: true, data: decryptedPrescription });

    } catch (error) {
        console.error('Patient Prescription Fetch Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
