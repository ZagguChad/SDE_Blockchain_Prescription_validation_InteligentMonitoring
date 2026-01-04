const express = require('express');
const router = express.Router();
const PrescriptionLog = require('../models/PrescriptionLog');

// Store Prescription Metadata (Called by Frontend after Blockchain Tx)
router.post('/', async (req, res) => {
    try {
        const { blockchainId, doctorAddress, patientName, patientAge, diagnosis, allergies, medicines, notes } = req.body;

        // Use upsert to handle cases where blockchain resets but DB persists
        // This updates the existing record if blockchainId exists, or creates a new one
        const savedLog = await PrescriptionLog.findOneAndUpdate(
            { blockchainId },
            {
                blockchainId,
                doctorAddress,
                patientName,
                patientAge,
                diagnosis,
                allergies,
                medicines,
                notes,
                issuedAt: new Date() // Update timestamp on overwrite
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        res.status(201).json({ success: true, data: savedLog });
    } catch (error) {
        console.error("❌ Prescription Save Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get Metadata by Blockchain ID
router.get('/:id', async (req, res) => {
    try {
        const log = await PrescriptionLog.findOne({ blockchainId: req.params.id });
        if (!log) return res.status(404).json({ success: false, message: 'Not found' });
        res.json({ success: true, data: log });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
