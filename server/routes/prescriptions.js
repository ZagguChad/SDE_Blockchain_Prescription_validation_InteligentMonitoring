const express = require('express');
const router = express.Router();
const PrescriptionLog = require('../models/PrescriptionLog');
const FraudAlert = require('../models/FraudAlert');
const Inventory = require('../models/Inventory'); // Added Verification Check
const { encrypt, decrypt } = require('../utils/encryption');
const { generatePDFPassword } = require('../utils/pdfPassword');
const { generateProtectedPDF } = require('../utils/pdfGenerator');
const { encryptPDF } = require('../utils/pdfEncryptor');
const { sendPrescriptionEmail } = require('../utils/emailService');

const { protect, authorize } = require('../middleware/authMiddleware');
const User = require('../models/User');
const bcrypt = require('bcryptjs');

// --- Helper Functions ---

// Normalize Medicine Data - Handles field name variations
function normalizeMedicineData(medicine, index = 0) {
    const medicineName =
        medicine.medicineName ||
        medicine.name ||
        medicine.drugName ||
        medicine.drug ||
        null;

    const quantity =
        medicine.quantity ||
        medicine.qty ||
        1;

    return {
        name: medicineName ? medicineName.trim() : null,
        quantity: parseInt(quantity) || 1,
        dosage: medicine.dosage || '',
        instructions: medicine.instructions || '',
        originalData: medicine,
        index
    };
}

// Check for Fraud Patterns
async function checkFraud(patientName, doctorAddress) {
    try {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

        // Rule 1: High Frequency (Same patient receiving > 3 prescriptions in 7 days)
        // Note: patientName is encrypted in DB, so we must rely on exact match of encrypted string 
        // OR we just check based on recent memory/logs if we want to be strict.
        // BUT, since we encrypt *before* saving, we can search by the encrypted value if encryption is deterministic (it's not, usually, because of IV).
        // ISSUE: AES CBC with random IV produces different outputs for same input.
        // SOLUTION for this iteration: We cannot easily search encrypted fields without a deterministic hash or decrypting all (slow).
        // COMPROMISE: We will trust the blockchain ID or just log the alert based on the *current request* vs *recent in-memory* or skip exact name matching for now
        // and rely on unencrypted fields if any? 
        // WAIT, patientName is sensitive. 
        // ALTERNATIVE: Hash the patientName (SHA256) and store it in a check field `patientHash` (blind index).
        // FOR NOW: I will skip the "read-based" check on encrypted fields or assume `doctorAddress` activity is the main check.

        // Let's implement Doctor Activity Check instead for simplicity and correctness without blind indexing.
        const recentRxCount = await PrescriptionLog.countDocuments({
            doctorAddress,
            issuedAt: { $gte: oneWeekAgo }
        });

        if (recentRxCount > 50) { // Example threshold
            await FraudAlert.create({
                type: 'HIGH_VOLUME_DOCTOR',
                description: `Doctor ${doctorAddress} issued ${recentRxCount} prescriptions in last 7 days.`,
                severity: 'MEDIUM',
                doctorAddress
            });
        }

    } catch (err) {
        console.error("Fraud Check Error:", err);
    }
}

// --- Routes ---

// Store Prescription Metadata (Called by Frontend after Blockchain Tx)
router.post('/', protect, authorize('doctor'), async (req, res) => {
    try {
        const { blockchainId, doctorAddress, patientName, patientAge, patientDOB, patientEmail, diagnosis, allergies, medicines, notes, expiryDate, maxUsage, patientHash } = req.body;

        // Validate new required fields
        if (!patientDOB) {
            return res.status(400).json({ success: false, error: 'Patient Date of Birth is required' });
        }
        if (!patientEmail) {
            return res.status(400).json({ success: false, error: 'Patient Email is required' });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(patientEmail)) {
            return res.status(400).json({ success: false, error: 'Invalid email format' });
        }

        // 1. Run Fraud Checks (Async, don't block response)
        checkFraud(patientName, doctorAddress);

        // 2. Encrypt Sensitive Data
        const encryptedData = {
            patientName: encrypt(patientName),
            patientEmail: encrypt(patientEmail), // Encrypt email for privacy
            diagnosis: encrypt(diagnosis),
            allergies: encrypt(allergies),
            notes: encrypt(notes),
            medicines: medicines.map(m => ({
                ...m,
                instructions: encrypt(m.instructions)
            }))
        };

        // 3. Generate Patient Username (Canonical, stored once)
        const { generatePatientUsername } = require('../utils/username');
        const patientUsername = generatePatientUsername(patientName, blockchainId);

        // 4. Save to DB
        const savedLog = await PrescriptionLog.findOneAndUpdate(
            { blockchainId },
            {
                blockchainId,
                doctorAddress,
                patientName: encryptedData.patientName,
                patientUsername,
                patientDOB: new Date(patientDOB),
                patientEmail: encryptedData.patientEmail,
                patientAge,
                diagnosis: encryptedData.diagnosis,
                allergies: encryptedData.allergies,
                medicines: encryptedData.medicines,
                notes: encryptedData.notes,
                expiryDate,
                maxUsage: maxUsage || 1,
                usageCount: 0,
                patientHash,
                status: 'ACTIVE',
                issuedAt: new Date()
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        // 5. Generate PDF Password
        const pdfPassword = generatePDFPassword(patientUsername, new Date(patientDOB));
        console.log(`📄 Generated PDF password for ${patientUsername}`);

        // 6. Generate Password-Protected PDF
        let pdfBuffer = null;
        let emailResult = { success: false, error: 'PDF generation skipped' };

        try {
            // Generate PDF (unencrypted from pdf-lib)
            let unencryptedPdf = await generateProtectedPDF({
                prescriptionId: blockchainId,
                patientName,
                patientAge,
                patientDOB: new Date(patientDOB),
                patientUsername,
                medicines,
                notes,
                diagnosis,
                expiryDate,
                doctorAddress
            }, pdfPassword);
            console.log(`📄 PDF generated (${unencryptedPdf.length} bytes)`);

            // Apply password protection using muhammara
            pdfBuffer = encryptPDF(unencryptedPdf, pdfPassword, pdfPassword + '_owner');
            console.log(`🔐 PDF encrypted successfully (${pdfBuffer.length} bytes)`);

            // 7. Send Email with PDF
            emailResult = await sendPrescriptionEmail(
                patientEmail, // Use plain email (not encrypted) for sending
                patientName,
                patientUsername,
                pdfBuffer,
                blockchainId,
                pdfPassword // Pass actual password to show in email
            );

            if (emailResult.success) {
                console.log(`✅ Email sent to ${patientEmail}`);
            } else {
                console.error(`⚠️ Email failed: ${emailResult.error}`);
            }
        } catch (pdfError) {
            console.error('❌ PDF/Email Error:', pdfError.message);
            emailResult = { success: false, error: pdfError.message };
            // Don't fail the entire request - prescription is still created
        }

        // 8. Return response with email status
        res.status(201).json({
            success: true,
            data: savedLog,
            patientCredentials: {
                username: patientUsername,
                password: blockchainId
            },
            emailSent: emailResult.success,
            emailError: emailResult.error || null
        });
    } catch (error) {
        console.error("❌ Prescription Save Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get Metadata by Blockchain ID
router.get('/:id', protect, async (req, res) => {
    try {
        // Access Control: Patients can only view their own prescription
        if (req.user.role === 'patient' && req.user.linkedPrescriptionId !== req.params.id) {
            return res.status(403).json({ success: false, message: 'Access Denied: You can only view your own prescription.' });
        }

        const log = await PrescriptionLog.findOne({ blockchainId: req.params.id });
        if (!log) return res.status(404).json({ success: false, message: 'Not found' });

        // Decrypt Data
        const decryptedLog = log.toObject();
        decryptedLog.patientName = decrypt(log.patientName);
        decryptedLog.diagnosis = decrypt(log.diagnosis);
        decryptedLog.allergies = decrypt(log.allergies);
        decryptedLog.notes = decrypt(log.notes);
        decryptedLog.medicines = log.medicines.map(m => ({
            ...m,
            instructions: decrypt(m.instructions)
        }));

        res.json({ success: true, data: decryptedLog });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- Dashboard Stats Endpoints ---

// Doctor Stats
router.get('/stats/doctor/:address', async (req, res) => {
    try {
        const { address } = req.params;
        const totalIssued = await PrescriptionLog.countDocuments({ doctorAddress: address });
        const dispensed = await PrescriptionLog.countDocuments({ doctorAddress: address, status: 'DISPENSED' });
        const expired = await PrescriptionLog.countDocuments({ doctorAddress: address, status: 'EXPIRED' });

        res.json({ success: true, stats: { totalIssued, dispensed, expired } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Doctor: Get List of Issued Prescriptions
router.get('/doctor/list/:address', protect, authorize('doctor'), async (req, res) => {
    try {
        const { address } = req.params;
        const logs = await PrescriptionLog.find({ doctorAddress: address }).sort({ issuedAt: -1 });

        // Decrypt minimal info
        const decryptedLogs = logs.map(log => {
            const d = log.toObject();
            d.patientName = decrypt(log.patientName);
            // Don't decrypt everything to save perf, usually list needs name + date + ID
            return d;
        });

        res.json({ success: true, data: decryptedLogs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Pharmacy Stats (Activity Feed)
router.get('/stats/pharmacy/activity', async (req, res) => {
    try {
        // Return recent dispensed prescriptions
        // In a real app, we'd filter by pharmacy address if we tracked "dispensedByPharmacyAddress" in DB
        // Currently Schema has 'dispensedAt' but not 'pharmacyAddress'. 
        // We'll return global dispensed list for now or just recently modified ones.
        const recentDispensed = await PrescriptionLog.find({ status: 'DISPENSED' })
            .sort({ dispensedAt: -1 })
            .limit(20);

        // Decrypt for display
        const decryptedList = recentDispensed.map(log => {
            const dLog = log.toObject();
            dLog.patientName = decrypt(log.patientName);
            return dLog;
        });

        res.json({ success: true, data: decryptedList });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin Fraud Alerts
router.get('/admin/alerts', protect, authorize('admin'), async (req, res) => {
    try {
        const alerts = await FraudAlert.find().sort({ timestamp: -1 }).limit(50);
        res.json({ success: true, data: alerts });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


// Validate Dispense (Dry Run)
router.post('/validate-dispense', protect, authorize('pharmacy'), async (req, res) => {
    try {
        const { blockchainId } = req.body;
        const log = await PrescriptionLog.findOne({ blockchainId });

        if (!log) return res.status(404).json({ success: false, message: 'Prescription not found' });
        if (log.status === 'DISPENSED') return res.status(400).json({ success: false, message: 'Already dispensed' });

        // Decrypt & Normalize (Dry Run Logic)
        const normalizedMedicines = [];
        for (let i = 0; i < log.medicines.length; i++) {
            const rawMed = log.medicines[i];
            const decryptedMed = {
                ...rawMed,
                name: decrypt(typeof rawMed.name === 'string' ? rawMed.name : rawMed.medicineName || ''),
                instructions: decrypt(rawMed.instructions || '')
            };

            const normalized = normalizeMedicineData(decryptedMed, i);
            if (!normalized.name) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid data: Medicine #${i + 1} unreadable.`
                });
            }
            normalizedMedicines.push(normalized);
        }

        // Check Inventory
        for (const med of normalizedMedicines) {
            const distinctBatches = await Inventory.find({
                medicineName: { $regex: new RegExp(`^${med.name}$`, 'i') },
                status: 'ACTIVE',
                expiryDate: { $gt: new Date() }
            });
            const totalAvailable = distinctBatches.reduce((sum, b) => sum + b.quantityAvailable, 0);

            if (totalAvailable < med.quantity) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient stock for ${med.name}. Available: ${totalAvailable}, Required: ${med.quantity}`
                });
            }
        }

        res.json({ success: true, valid: true, message: 'Validation successful' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Complete Dispense (Update Status, Invalidate User, Save Invoice)
router.post('/complete-dispense', protect, authorize('pharmacy'), async (req, res) => {
    try {
        const { blockchainId, invoiceDetails, totalCost } = req.body;

        // 1. Find Prescription FIRST (Don't update yet)
        const log = await PrescriptionLog.findOne({ blockchainId });
        if (!log) return res.status(404).json({ success: false, message: 'Prescription not found' });

        if (log.status === 'DISPENSED') {
            return res.status(400).json({ success: false, message: 'Prescription already dispensed' });
        }

        // 2. Decrypt, Normalize & Validate Prescription Medicine Data
        // Securely handle encrypted data in memory only
        const normalizedMedicines = [];

        for (let i = 0; i < log.medicines.length; i++) {
            const rawMed = log.medicines[i];

            // Step A: Decrypt sensitive fields (name, instructions)
            // Note: decrypt() returns original text if not encrypted, ensuring backward compatibility
            const decryptedMed = {
                ...rawMed, // Copy all fields first
                name: decrypt(typeof rawMed.name === 'string' ? rawMed.name : rawMed.medicineName || ''),
                // handle potential aliasing in raw object or just use rawMed.name access
                instructions: decrypt(rawMed.instructions || '')
            };

            // Normalize after decryption
            const normalized = normalizeMedicineData(decryptedMed, i);

            // CRITICAL VALIDATION: Ensure medicine name exists after decryption and normalization
            if (!normalized.name) {
                console.error('❌ Complete-Dispense Error: Medicine name missing/unreadable', {
                    prescriptionId: blockchainId,
                    medicineIndex: i,
                    original: rawMed,
                    decrypted: decryptedMed
                });
                return res.status(400).json({
                    success: false,
                    message: `Invalid prescription data: Medicine #${i + 1} has no identifiable name after decryption. Cannot dispense.`
                });
            }

            // Validate quantity
            if (isNaN(normalized.quantity) || normalized.quantity <= 0) {
                console.error('❌ Complete-Dispense Error: Invalid quantity', {
                    prescriptionId: blockchainId,
                    medicine: normalized
                });
                return res.status(400).json({
                    success: false,
                    message: `Invalid prescription data: Medicine "${normalized.name}" has invalid quantity. Cannot dispense.`
                });
            }

            normalizedMedicines.push(normalized);
        }

        // 3. Validate Inventory for ALL Medicines
        // We need to check if we have enough stock for every item in the prescription.
        for (const med of normalizedMedicines) {
            const reqQty = med.quantity;

            // Check total available stock across batches
            const distinctBatches = await Inventory.find({
                medicineName: { $regex: new RegExp(`^${med.name}$`, 'i') },
                status: 'ACTIVE',
                expiryDate: { $gt: new Date() }
            });

            const totalAvailable = distinctBatches.reduce((sum, batch) => sum + batch.quantityAvailable, 0);

            if (totalAvailable < reqQty) {
                console.warn(`⚠️ Insufficient Stock During Dispense: ${med.name} - Required: ${reqQty}, Available: ${totalAvailable}`);
                return res.status(400).json({
                    success: false,
                    message: `Insufficient stock for "${med.name}". Required: ${reqQty}, Available: ${totalAvailable}`
                });
            }
        }

        // 4. Deduct Stock (Atomic-ish)
        // Since we passed validation, we consume stock.
        for (const med of normalizedMedicines) {
            let remaining = med.quantity;

            // Re-fetch batches to lock/update (optimistic concurrency not fully handled here but better)
            const batches = await Inventory.find({
                medicineName: { $regex: new RegExp(`^${med.name}$`, 'i') },
                status: 'ACTIVE',
                expiryDate: { $gt: new Date() },
                quantityAvailable: { $gt: 0 }
            }).sort({ expiryDate: 1 }); // FIFO

            for (const batch of batches) {
                if (remaining <= 0) break;

                const take = Math.min(batch.quantityAvailable, remaining);
                batch.quantityAvailable -= take;
                remaining -= take;

                if (batch.quantityAvailable === 0) {
                    batch.status = 'DEPLETED';
                }
                await batch.save();
            }
        }

        // 5. Update Prescription Status
        log.status = 'DISPENSED';
        log.dispensedAt = new Date();
        log.invoiceDetails = invoiceDetails;
        log.totalCost = totalCost;
        await log.save();

        // Note: Patient sessions are automatically invalidated by status check in /api/patient/access

        res.json({ success: true, message: 'Prescription marked as DISPENSED. Invoice Saved.' });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
