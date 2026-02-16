const express = require('express');
const router = express.Router();
const PrescriptionLog = require('../models/PrescriptionLog');
const FraudAlert = require('../models/FraudAlert');
const Inventory = require('../models/Inventory');
const { generateMedicineId } = require('../models/Inventory');
const { encrypt, decrypt } = require('../utils/encryption');
const { generatePDFPassword } = require('../utils/pdfPassword');
const { generateProtectedPDF, generateInvoicePDF } = require('../utils/pdfGenerator');
const { encryptPDF } = require('../utils/pdfEncryptor');
const { sendPrescriptionEmail, sendInvoiceEmail } = require('../utils/emailService');
const { normalizePrescriptionMedicines } = require('../utils/normalizeHelper');
const { createAddressCommitment } = require('../utils/patientCrypto');
const { generateTotpSecret, generateQrDataUrl, encryptTotpSecret, generateBackupCodes } = require('../utils/totpService');
const { verifyOnChainHashes } = require('../utils/hashVerifier');
const { validateOnChainState, ChainValidationError, ChainErrorCodes } = require('../utils/chainValidator');
const { anchorInventoryRoot, verifyRootOrAbort } = require('../utils/inventoryMerkle');

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

    const trimmedName = medicineName ? medicineName.trim() : null;

    return {
        name: trimmedName,
        medicineId: trimmedName ? generateMedicineId(trimmedName) : null,
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

        const recentRxCount = await PrescriptionLog.countDocuments({
            doctorAddress,
            issuedAt: { $gte: oneWeekAgo }
        });

        if (recentRxCount > 50) {
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
        const { blockchainId, doctorAddress, patientName, patientAge, patientDOB, patientEmail, diagnosis, allergies, medicines, notes, expiryDate, maxUsage, patientHash, txHash, blockNumber, blockchainSynced } = req.body;

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

        // 3b. Accept optional patient identity (backward compat — no longer required)
        const { patientAddress, patientCommitment } = req.body;

        // 3c. Auto-generate TOTP secret for patient verification at pharmacy
        const totpSecret = generateTotpSecret();
        const totpEncrypted = encryptTotpSecret(totpSecret);
        const totpLabel = `Rx-${blockchainId} (${patientName})`;
        const qrCodeDataUrl = await generateQrDataUrl(totpSecret, totpLabel);
        const backupCodes = generateBackupCodes(8);
        console.log(`🔐 TOTP secret generated for prescription ${blockchainId}`);

        // 4. Save to DB (with TOTP secret for pharmacy verification)
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
                patientCommitment: patientCommitment || null,
                patientAddress: patientAddress || null,
                totpEnabled: true,
                totpSecretEncrypted: totpEncrypted,
                totpBackupCodes: backupCodes,
                blockchainSynced: blockchainSynced || false,
                txHash: txHash || null,
                blockNumber: blockNumber || null,
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
                doctorAddress,
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

        // 8. Return response with email status + TOTP QR for doctor modal
        res.status(201).json({
            success: true,
            data: savedLog,
            patientCredentials: {
                username: patientUsername,
                password: blockchainId
            },
            // TOTP setup data for doctor to show patient
            totpSetup: {
                qrCodeDataUrl,
                manualEntryKey: totpSecret,
                backupCodes: backupCodes.map(bc => bc.code)
            },
            emailSent: emailResult.success,
            emailError: emailResult.error || null
        });

        // On-chain commitment (only if patientAddress was provided — backward compat)
        if (patientAddress && patientCommitment) {
            setImmediate(async () => {
                try {
                    const { ethers } = require('ethers');
                    const contractInfo = require('../contractInfo.json');
                    const provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC || 'http://127.0.0.1:8545');
                    const signer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider);
                    const contract = new ethers.Contract(contractInfo.address, contractInfo.abi, signer);

                    const idBytes = ethers.encodeBytes32String(blockchainId);
                    const tx = await contract.setPatientCommitment(idBytes, patientCommitment);
                    await tx.wait();
                    console.log(`✅ Patient commitment set on-chain for ${blockchainId}`);
                } catch (commitErr) {
                    console.warn(`⚠️ On-chain commitment failed for ${blockchainId}: ${commitErr.message}`);
                }
            });
        }
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

        // Normalize medicines: resolve field-name variations, decrypt only instructions
        // NOTE: medicine.name is stored as PLAIN TEXT (not encrypted)
        decryptedLog.medicines = log.medicines.map((m, i) => {
            const medObj = m.toObject ? m.toObject() : m;
            // Resolve name from possible field variations
            const name = (medObj.name || medObj.medicineName || medObj.drugName || medObj.drug || '').toString().trim();
            return {
                name: name,
                quantity: parseInt(medObj.quantity || medObj.qty) || 1,
                dosage: medObj.dosage || '',
                instructions: decrypt(medObj.instructions || '')
            };
        });

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
        const recentDispensed = await PrescriptionLog.find({ status: 'DISPENSED' })
            .sort({ dispensedAt: -1 })
            .limit(20);

        // Decrypt for display & normalize medicine names
        const decryptedList = recentDispensed.map(log => {
            const dLog = log.toObject();
            dLog.patientName = decrypt(log.patientName);
            // Normalize medicine names for activity feed display
            if (dLog.medicines && Array.isArray(dLog.medicines)) {
                dLog.medicines = dLog.medicines.map(m => ({
                    ...m,
                    name: (m.name || m.medicineName || 'Unknown').toString().trim()
                }));
            }
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


// Validate Dispense (Dry Run) — CHAIN AUTHORITY ENFORCED
router.post('/validate-dispense', protect, authorize('pharmacy'), async (req, res) => {
    try {
        const { blockchainId, signature, timestamp } = req.body;
        const log = await PrescriptionLog.findOne({ blockchainId });

        if (!log) return res.status(404).json({ success: false, message: 'Prescription not found' });
        if (log.status !== 'ACTIVE') {
            return res.status(400).json({
                success: false,
                message: `Prescription cannot be dispensed — current status: ${log.status}`,
                code: 'INVALID_STATE'
            });
        }

        // ── CHAIN AUTHORITY: Full on-chain state validation (HARD BLOCK) ──
        const plainPatientName = decrypt(log.patientName);
        const plainMedicines = log.medicines.map(m => {
            const medObj = m.toObject ? m.toObject() : m;
            return {
                name: medObj.name || '',
                dosage: medObj.dosage || '',
                quantity: medObj.quantity
            };
        });

        let chainResult;
        try {
            chainResult = await validateOnChainState(blockchainId, plainPatientName, log.patientAge, plainMedicines);
        } catch (chainErr) {
            if (chainErr instanceof ChainValidationError) {
                // Auto-sync DB status from chain when there's a state divergence
                const syncCodes = [ChainErrorCodes.STATUS_MISMATCH, ChainErrorCodes.USAGE_EXHAUSTED, ChainErrorCodes.EXPIRED_ON_CHAIN];
                if (syncCodes.includes(chainErr.code)) {
                    const chainStatus = chainErr.context?.actual || chainErr.context?.onChainState?.statusLabel;
                    const dbStatus = chainStatus === 'USED' ? 'DISPENSED' : chainStatus === 'EXPIRED' ? 'EXPIRED' : null;
                    if (dbStatus && log.status !== dbStatus) {
                        console.warn(`🔄 [DB_SYNC] Syncing DB status for ${blockchainId}: ${log.status} → ${dbStatus} (chain authority)`);
                        log.status = dbStatus;
                        if (dbStatus === 'DISPENSED') log.dispensedAt = log.dispensedAt || new Date();
                        await log.save();
                    }
                }

                return res.status(chainErr.httpStatus).json({
                    success: false,
                    message: chainErr.message,
                    code: chainErr.code,
                    details: chainErr.context
                });
            }
            // Unknown error — treat as chain unreachable
            console.error(`🔴 [CHAIN_UNREACHABLE] Validate-Dispense unexpected error for ${blockchainId}:`, chainErr.message);
            return res.status(503).json({
                success: false,
                message: 'Blockchain verification unavailable. Cannot validate prescription.',
                code: ChainErrorCodes.CHAIN_UNREACHABLE
            });
        }

        console.log(`✅ On-chain validation passed for ${blockchainId} (validate-dispense)`);

        // ── Patient verification now handled by TOTP/OTP at pharmacy counter ──
        // ── (see /api/dispense-mfa routes — signature verification removed) ──
        console.log(`ℹ️ Patient verification for ${blockchainId} will be handled by dispense MFA flow`);

        // Normalize medicines — name is stored as PLAIN TEXT (not encrypted)
        // Only instructions are encrypted
        let normalizedMedicines;
        try {
            const rawMedicines = log.medicines.map((m, i) => {
                const medObj = m.toObject ? m.toObject() : m;
                return {
                    name: (medObj.name || medObj.medicineName || '').toString().trim(),
                    quantity: medObj.quantity,
                    dosage: medObj.dosage || '',
                    instructions: decrypt(medObj.instructions || '')
                };
            });
            normalizedMedicines = normalizePrescriptionMedicines(rawMedicines, blockchainId);
        } catch (normErr) {
            console.error('❌ Validate-Dispense: Normalization failed', {
                prescriptionId: blockchainId,
                error: normErr.message
            });
            return res.status(normErr.statusCode || 400).json({
                success: false,
                message: normErr.message
            });
        }

        // Check Inventory using medicineId
        for (const med of normalizedMedicines) {
            const availableStock = await Inventory.aggregate([
                {
                    $match: {
                        medicineId: med.medicineId,
                        status: 'ACTIVE',
                        expiryDate: { $gt: new Date() }
                    }
                },
                { $group: { _id: null, total: { $sum: "$quantityAvailable" } } }
            ]);

            const totalAvailable = availableStock.length > 0 ? availableStock[0].total : 0;

            if (totalAvailable < med.quantity) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient stock for "${med.name}". Available: ${totalAvailable}, Required: ${med.quantity}`
                });
            }
        }

        res.json({
            success: true,
            valid: true,
            message: 'Validation successful — on-chain state verified',
            chainVerified: true,
            onChainState: chainResult.onChainState
        });
    } catch (error) {
        console.error('❌ Validate-Dispense Error:', error.message, { stack: error.stack });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// COMPLETE DISPENSE — Unified Atomic Transaction
// ============================================================================
// This is the SINGLE authoritative endpoint for dispensing.
// It handles: validation → stock deduction → invoice computation → PDF → email
// The frontend should ONLY call this endpoint (no separate /consume call).
// ============================================================================
router.post('/complete-dispense', protect, authorize('pharmacy'), async (req, res) => {
    try {
        const { blockchainId } = req.body;

        if (!blockchainId) {
            return res.status(400).json({ success: false, message: 'blockchainId is required' });
        }

        // ── STEP 1: Find and Validate Prescription ──
        const log = await PrescriptionLog.findOne({ blockchainId });
        if (!log) {
            console.error('❌ Dispense Error: Prescription not found', { blockchainId });
            return res.status(404).json({ success: false, message: 'Prescription not found' });
        }

        if (log.status !== 'ACTIVE') {
            return res.status(400).json({
                success: false,
                message: `Prescription cannot be dispensed — current status: ${log.status}`,
                code: 'INVALID_STATE'
            });
        }

        if (!log.medicines || log.medicines.length === 0) {
            return res.status(400).json({ success: false, message: 'Prescription contains no medicines' });
        }

        // ── STEP 1a: DISPENSE MFA GATE (Optional Patient Re-Verification) ──
        // If patient has TOTP or email configured, require a valid dispense-mfa token.
        // If neither is configured, skip MFA (backward compatible).
        const hasTotpConfigured = log.totpEnabled === true && !!log.totpSecretEncrypted;
        const hasEmailConfigured = !!log.patientEmail;
        const mfaRequired = hasTotpConfigured || hasEmailConfigured;

        if (mfaRequired) {
            const dispenseMfaToken = req.headers['x-dispense-mfa-token'] || req.body.dispenseMfaToken;

            if (!dispenseMfaToken) {
                return res.status(403).json({
                    success: false,
                    message: 'Patient verification required before dispensing.',
                    code: 'MFA_REQUIRED',
                    mfaRequired: true,
                    totpEnabled: hasTotpConfigured,
                    emailAvailable: hasEmailConfigured
                });
            }

            try {
                const jwt = require('jsonwebtoken');
                const mfaDecoded = jwt.verify(dispenseMfaToken, process.env.JWT_SECRET);

                if (mfaDecoded.type !== 'dispense-mfa') {
                    throw new Error('Invalid token type');
                }
                if (mfaDecoded.prescriptionId !== blockchainId) {
                    throw new Error('Token prescription mismatch');
                }

                console.log(`✅ Dispense MFA verified for ${blockchainId} via ${mfaDecoded.method}`);
            } catch (mfaErr) {
                return res.status(403).json({
                    success: false,
                    message: 'Invalid or expired patient verification. Please re-verify.',
                    code: 'MFA_INVALID'
                });
            }
        }

        // ── STEP 1b: CHAIN AUTHORITY — Full On-Chain Pre-Mutation Validation (HARD BLOCK) ──
        // NO FALLBACK. If blockchain is unreachable → error. If any check fails → abort.
        const plainPatientName = decrypt(log.patientName);
        const plainMedicines = log.medicines.map(m => {
            const medObj = m.toObject ? m.toObject() : m;
            return {
                name: medObj.name || '',
                dosage: medObj.dosage || '',
                quantity: medObj.quantity
            };
        });

        let chainValidation;
        try {
            chainValidation = await validateOnChainState(blockchainId, plainPatientName, log.patientAge, plainMedicines);
        } catch (chainErr) {
            if (chainErr instanceof ChainValidationError) {
                console.error(`🚫 DISPENSE BLOCKED [${chainErr.code}] for ${blockchainId}: ${chainErr.message}`);
                return res.status(chainErr.httpStatus).json({
                    success: false,
                    message: chainErr.message,
                    code: chainErr.code,
                    details: chainErr.context
                });
            }
            // Unknown error — treat as chain unreachable
            console.error(`🔴 [CHAIN_UNREACHABLE] Dispense unexpected error for ${blockchainId}:`, chainErr.message);
            return res.status(503).json({
                success: false,
                message: 'Blockchain verification unavailable. Dispense cannot proceed without on-chain validation.',
                code: ChainErrorCodes.CHAIN_UNREACHABLE
            });
        }

        // Mark chain verification as completed
        log.hashVerified = true;
        log.hashVerifiedAt = new Date();
        log.chainValidatedAt = new Date();
        console.log(`✅ Full on-chain validation passed for ${blockchainId} — status=${chainValidation.onChainState.statusLabel} usage=${chainValidation.onChainState.usageCount}/${chainValidation.onChainState.maxUsage}`);

        // ── STEP 2: Normalize All Medicine Data ──
        // NOTE: medicine.name is stored as PLAIN TEXT (not encrypted).
        // Only instructions are encrypted. Do NOT decrypt name.
        let normalizedMedicines;
        try {
            const rawMedicines = log.medicines.map((m, i) => {
                const medObj = m.toObject ? m.toObject() : m;
                return {
                    name: (medObj.name || medObj.medicineName || '').toString().trim(),
                    quantity: medObj.quantity,
                    dosage: medObj.dosage || '',
                    instructions: decrypt(medObj.instructions || '')
                };
            });
            normalizedMedicines = normalizePrescriptionMedicines(rawMedicines, blockchainId);
        } catch (normErr) {
            console.error('❌ Dispense Error: Medicine normalization failed', {
                prescriptionId: blockchainId,
                error: normErr.message
            });
            return res.status(normErr.statusCode || 400).json({
                success: false,
                message: normErr.message
            });
        }

        // ── STEP 3: Validate Quantities & Stock for ALL Medicines ──
        for (const med of normalizedMedicines) {
            // Safety guard: quantity must be positive
            if (!med.quantity || med.quantity <= 0 || isNaN(med.quantity)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid dispense quantity for "${med.name}": ${med.quantity}. Must be a positive number.`
                });
            }

            const availableStock = await Inventory.aggregate([
                {
                    $match: {
                        medicineId: med.medicineId,
                        status: 'ACTIVE',
                        expiryDate: { $gt: new Date() }
                    }
                },
                { $group: { _id: null, total: { $sum: "$quantityAvailable" } } }
            ]);

            const total = availableStock.length > 0 ? availableStock[0].total : 0;

            // Safety guard: never dispense more than available
            if (med.quantity > total) {
                console.warn(`⚠️ Insufficient Stock: ${med.name} (${med.medicineId}) — Required: ${med.quantity}, Available: ${total}`, { prescriptionId: blockchainId });
                return res.status(400).json({
                    success: false,
                    message: `Insufficient inventory for "${med.name}". Required: ${med.quantity}, Available: ${total}`
                });
            }
        }

        // ── STEP 3.5 (Phase 4): Pre-Deduction Root Verification ──
        // Verify inventory Merkle root matches on-chain before touching stock
        try {
            await verifyRootOrAbort();
        } catch (rootErr) {
            if (rootErr.code === 'INVENTORY_TAMPERED') {
                return res.status(409).json({
                    success: false,
                    message: 'Inventory integrity check failed — on-chain root does not match. Dispense blocked.',
                    code: 'INVENTORY_TAMPERED',
                    details: rootErr.details
                });
            }
            // Chain unreachable
            return res.status(503).json({
                success: false,
                message: `Cannot verify inventory integrity: ${rootErr.message}`,
                code: rootErr.code || 'CHAIN_UNREACHABLE'
            });
        }

        // ── STEP 4: Deduct Stock (with Rollback Journal) ──
        const deductionJournal = []; // Track all deductions for rollback
        const invoiceItems = [];     // Build invoice from actual deductions

        try {
            for (const med of normalizedMedicines) {
                let remaining = med.quantity;
                let totalCost = 0;
                let weightedPriceSum = 0;
                let totalDeducted = 0;

                // Find batches (FIFO: oldest expiry first)
                const batches = await Inventory.find({
                    medicineId: med.medicineId,
                    status: 'ACTIVE',
                    quantityAvailable: { $gt: 0 },
                    expiryDate: { $gt: new Date() }
                }).sort({ expiryDate: 1 });

                if (batches.length === 0) {
                    throw new Error(`No active batches found for "${med.name}" (${med.medicineId})`);
                }

                for (const batch of batches) {
                    if (remaining <= 0) break;

                    const take = Math.min(batch.quantityAvailable, remaining);
                    const previousQty = batch.quantityAvailable;
                    const previousStatus = batch.status;

                    batch.quantityAvailable -= take;
                    // Defensive: prevent negative stock
                    if (batch.quantityAvailable < 0) batch.quantityAvailable = 0;

                    remaining -= take;
                    totalCost += take * (batch.pricePerUnit || 0);
                    weightedPriceSum += take * (batch.pricePerUnit || 0);
                    totalDeducted += take;

                    if (batch.quantityAvailable === 0) {
                        batch.status = 'DEPLETED';
                    }

                    await batch.save();

                    // Record for rollback
                    deductionJournal.push({
                        batchId: batch.batchId,
                        batchObjectId: batch._id,
                        quantityDeducted: take,
                        previousQty: previousQty,
                        previousStatus: previousStatus
                    });
                }

                if (remaining > 0) {
                    throw new Error(`Could not fully deduct "${med.name}": ${remaining} units still needed after all batches`);
                }

                // Compute effective price per unit (weighted average across batches)
                const effectivePrice = totalDeducted > 0 ? weightedPriceSum / totalDeducted : 0;

                invoiceItems.push({
                    name: med.name,
                    medicineId: med.medicineId,
                    quantity: med.quantity,
                    pricePerUnit: Math.round(effectivePrice * 100) / 100,
                    total: Math.round(totalCost * 100) / 100
                });
            }
        } catch (deductionError) {
            // ── ROLLBACK: Reverse ALL deductions made so far ──
            console.error('❌ Dispense deduction failed, rolling back...', {
                prescriptionId: blockchainId,
                error: deductionError.message,
                journalEntries: deductionJournal.length
            });

            for (const entry of deductionJournal) {
                try {
                    await Inventory.updateOne(
                        { _id: entry.batchObjectId },
                        {
                            $inc: { quantityAvailable: entry.quantityDeducted },
                            $set: { status: entry.previousStatus }
                        }
                    );
                    console.log(`  ↩️ Rolled back ${entry.quantityDeducted} units for batch ${entry.batchId}`);
                } catch (rollbackErr) {
                    console.error('❌ CRITICAL: Rollback failed for batch', entry.batchId, rollbackErr.message);
                }
            }

            return res.status(500).json({
                success: false,
                message: `Dispense failed: ${deductionError.message}. All stock changes have been rolled back.`
            });
        }

        // ── STEP 5: Compute Invoice Totals ──
        const totalCost = invoiceItems.reduce((sum, item) => sum + item.total, 0);
        const dispenseId = `DISP-${blockchainId}-${Date.now()}`;
        const dispenseDate = new Date();

        // ── STEP 6: Update Prescription Status → PENDING_DISPENSE ──
        // Phase 3: Route does NOT set final status. It sets PENDING_DISPENSE.
        // The blockchain event handler (listener) promotes to DISPENSED or USED.
        const { transitionStatus } = require('../utils/stateTransitions');
        const transitioned = await transitionStatus(blockchainId, 'PENDING_DISPENSE', {
            dispensedAt: dispenseDate,
            dispenseId,
            invoiceDetails: invoiceItems,
            totalCost: Math.round(totalCost * 100) / 100,
        });

        if (!transitioned) {
            // State transition was blocked — prescription is in an unexpected state
            console.error(`🚫 [STATE] Could not transition ${blockchainId} to PENDING_DISPENSE`);
            return res.status(409).json({
                success: false,
                message: 'Prescription is not in a valid state for dispensing. It may have already been dispensed or expired.',
                code: 'INVALID_STATE_TRANSITION'
            });
        }

        console.log(`✅ Prescription ${blockchainId} dispensed. Invoice: $${totalCost.toFixed(2)} (${dispenseId})`);

        // ── STEP 5.5 (Phase 4): Anchor NEW Root Before Commit ──
        // Compute post-deduction root and anchor on-chain BEFORE committing status
        try {
            const { root, txHash } = await anchorInventoryRoot();
            console.log(`🌲 Post-deduction root anchored: ${root.substring(0, 10)}... (tx: ${txHash})`);
        } catch (anchorErr) {
            // Anchor failed — ROLLBACK all deductions
            console.error('❌ Inventory root anchor FAILED after deduction — rolling back all stock changes...', {
                prescriptionId: blockchainId,
                error: anchorErr.message
            });

            for (const entry of deductionJournal) {
                try {
                    await Inventory.updateOne(
                        { _id: entry.batchObjectId },
                        {
                            $inc: { quantityAvailable: entry.quantityDeducted },
                            $set: { status: entry.previousStatus }
                        }
                    );
                    console.log(`  ↩️ Rolled back ${entry.quantityDeducted} units for batch ${entry.batchId}`);
                } catch (rollbackErr) {
                    console.error('❌ CRITICAL: Rollback failed for batch', entry.batchId, rollbackErr.message);
                }
            }

            return res.status(503).json({
                success: false,
                message: 'Inventory root anchoring failed — all stock changes have been rolled back. Please retry.',
                code: 'ANCHOR_FAILED'
            });
        }

        // ── STEP 7: Generate Invoice PDF & Email (non-blocking) ──
        let invoicePdfBase64 = null;

        try {
            // Decrypt patient info for PDF/email
            const patientName = decrypt(log.patientName);
            const patientEmail = decrypt(log.patientEmail);

            // Generate Invoice PDF
            const invoicePdfBuffer = await generateInvoicePDF({
                dispenseId,
                prescriptionId: blockchainId,
                patientName,
                items: invoiceItems,
                totalAmount: totalCost,
                date: dispenseDate
            });

            invoicePdfBase64 = invoicePdfBuffer.toString('base64');
            console.log(`📄 Invoice PDF generated (${invoicePdfBuffer.length} bytes)`);

            // Email invoice to patient (don't block response on email failure)
            if (patientEmail) {
                sendInvoiceEmail(
                    patientEmail,
                    patientName,
                    blockchainId,
                    dispenseId,
                    invoicePdfBuffer,
                    totalCost
                ).then(result => {
                    if (result.success) {
                        console.log(`✅ Invoice emailed to ${patientEmail}`);
                    } else {
                        console.error(`⚠️ Invoice email failed: ${result.error}`);
                    }
                }).catch(err => {
                    console.error('❌ Invoice email error:', err.message);
                });
            }
        } catch (pdfError) {
            console.error('⚠️ Invoice PDF generation failed (dispense already completed):', pdfError.message);
            // Don't fail the response — dispense and stock update are already done
        }

        // ── STEP 8: Return Response ──
        res.json({
            success: true,
            message: 'Prescription dispensed successfully. Invoice generated.',
            dispenseId,
            invoiceDetails: invoiceItems,
            totalCost: Math.round(totalCost * 100) / 100,
            invoicePdfBase64
        });

    } catch (error) {
        console.error('❌ Complete-Dispense Error:', error.message, {
            stack: error.stack,
            blockchainId: req.body?.blockchainId
        });
        // Sanitize error message — never leak stack traces or internal details to client
        const safeMessage = (error.message || '').includes('Cannot read')
            || (error.message || '').includes('undefined')
            || (error.message || '').includes('ECONNREFUSED')
            ? 'An internal error occurred during dispensing. Please try again.'
            : error.message;
        res.status(500).json({ success: false, error: safeMessage });
    }
});

module.exports = router;
