const express = require('express');
const router = express.Router();
const PrescriptionLog = require('../models/PrescriptionLog');

// Store Prescription Metadata (Called by Frontend after Blockchain Tx)
router.post('/', async (req, res) => {
    try {
        const { blockchainId, doctorAddress, patientName, patientAge, medicineDetails, notes } = req.body;

        const newLog = new PrescriptionLog({
            blockchainId,
            doctorAddress,
            patientName,
            patientAge,
            medicineDetails,
            notes
        });

        await newLog.save();
        res.status(201).json({ success: true, data: newLog });
    } catch (error) {
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
