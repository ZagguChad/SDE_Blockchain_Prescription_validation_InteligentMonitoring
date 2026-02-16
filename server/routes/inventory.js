const express = require('express');
const router = express.Router();
const Inventory = require('../models/Inventory');
const { generateMedicineId } = require('../models/Inventory');
const FraudAlert = require('../models/FraudAlert');
const { anchorInventoryRoot, verifyInventoryRoot } = require('../utils/inventoryMerkle');

// --- Helper: Normalize Medicine Data ---
// Handles field name variations for robustness
function normalizeMedicineData(medicine, index = 0) {
    // Extract medicine name from various possible field names
    const medicineName =
        medicine.medicineName ||
        medicine.name ||
        medicine.drugName ||
        medicine.drug ||
        null;

    // Extract quantity from various possible field names
    const quantity =
        medicine.quantity ||
        medicine.qty ||
        1; // Default to 1 if not specified

    const trimmedName = medicineName ? medicineName.trim() : null;

    return {
        name: trimmedName,
        medicineId: trimmedName ? generateMedicineId(trimmedName) : null,
        quantity: parseInt(quantity) || 1,
        originalData: medicine,
        index
    };
}

// --- Helper: Check for Inventory Fraud ---
async function checkInventoryFraud(batchId, quantityChange) {
    // Example: Flag massive single dispense events (e.g., > 50 units at once)
    if (quantityChange > 50) {
        await FraudAlert.create({
            type: 'ABNORMAL_STOCK_DEPLETION',
            description: `Batch ${batchId} had a sudden drop of ${quantityChange} units.`,
            severity: 'HIGH',
            doctorAddress: 'SYSTEM_INVENTORY' // Placeholder
        });
    }
}

// --- Routes ---

// 1. Add New Batch (Called after Blockchain Registration)
router.post('/add', async (req, res) => {
    try {
        const { batchId, medicineName, supplierId, quantity, expiryDate, pharmacyAddress, price } = req.body;

        // Validation
        if (!batchId || !medicineName || !supplierId || !quantity || !expiryDate || !pharmacyAddress || !price) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }
        if (Number(quantity) <= 0) return res.status(400).json({ success: false, message: 'Quantity must be positive' });
        if (Number(price) <= 0) return res.status(400).json({ success: false, message: 'Price must be positive' });
        if (new Date(expiryDate) <= new Date()) return res.status(400).json({ success: false, message: 'Cannot add expired medicine' });

        // Auto-generate medicineId from medicineName (pre-save hook also does this, but we set it explicitly)
        const medicineId = generateMedicineId(medicineName);

        const newBatch = new Inventory({
            batchId,
            medicineId,
            medicineName: medicineName.trim(),
            supplierId,
            quantityInitial: quantity,
            quantityAvailable: quantity,
            expiryDate,
            pharmacyAddress,
            pricePerUnit: price
        });

        await newBatch.save();

        // Phase 4: Anchor updated Merkle root (must succeed for tamper detection)
        try {
            await anchorInventoryRoot();
        } catch (e) {
            console.warn(`⚠️ Root anchor failed after batch add: ${e.message}`);
            // Non-critical for add — batch is saved, root will be re-anchored on next mutation
        }

        res.status(201).json({ success: true, data: newBatch });
    } catch (error) {
        console.error('❌ Inventory Add Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2. Get All Inventory (Active)
router.get('/', async (req, res) => {
    try {
        const inventory = await Inventory.find({ status: 'ACTIVE' }).sort({ expiryDate: 1 });
        res.json({ success: true, data: inventory });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. Get Specific Medicine Stock (by medicineId or name)
router.get('/stock/:medicineName', async (req, res) => {
    try {
        const { medicineName } = req.params;
        const medicineId = generateMedicineId(medicineName);
        const now = new Date();

        // Primary: lookup by canonical medicineId
        const batches = await Inventory.find({
            medicineId: medicineId,
            status: 'ACTIVE',
            expiryDate: { $gt: now },
            quantityAvailable: { $gt: 0 }
        }).sort({ expiryDate: 1 }); // Use oldest first (FIFO-ish)

        res.json({ success: true, data: batches });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 4. Dispense/Update Stock (single batch)
router.post('/dispense', async (req, res) => {
    try {
        const { batchId, quantity } = req.body;

        const batch = await Inventory.findOne({ batchId });
        if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });

        if (batch.quantityAvailable < quantity) {
            return res.status(400).json({ success: false, message: 'Insufficient stock' });
        }

        // Fraud Check
        await checkInventoryFraud(batchId, quantity);

        batch.quantityAvailable -= quantity;

        // Defensive: prevent negative stock
        if (batch.quantityAvailable < 0) batch.quantityAvailable = 0;

        if (batch.quantityAvailable === 0) {
            batch.status = 'DEPLETED';
        }

        await batch.save();

        // Phase 4: Anchor updated Merkle root
        try {
            await anchorInventoryRoot();
        } catch (e) {
            console.warn(`⚠️ Root anchor failed after dispense: ${e.message}`);
        }

        res.json({ success: true, message: 'Stock updated', currentStock: batch.quantityAvailable });
    } catch (error) {
        console.error('❌ Inventory Dispense Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 5. Check Expiry Alerts
router.get('/alerts/expiry', async (req, res) => {
    try {
        const now = new Date();
        const nextWeek = new Date();
        nextWeek.setDate(now.getDate() + 7);

        const expiringSoon = await Inventory.find({
            status: 'ACTIVE',
            expiryDate: { $lte: nextWeek, $gte: now }
        });

        const expired = await Inventory.find({
            status: 'ACTIVE', // Still marked active but actually expired
            expiryDate: { $lt: now }
        });

        // Auto-update expired status
        if (expired.length > 0) {
            const expiredIds = expired.map(b => b._id);
            await Inventory.updateMany({ _id: { $in: expiredIds } }, { status: 'EXPIRED' });

            // Phase 4: Anchor updated Merkle root after expiry changes
            try {
                await anchorInventoryRoot();
            } catch (e) {
                console.warn(`⚠️ Root anchor failed after expiry update: ${e.message}`);
            }
        }

        res.json({ success: true, data: { expiringSoon, expired } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 6. Bulk Consume (Strict 3-Phase: Normalize -> Check All -> Deduct All)
// NOTE: This is now only used for standalone inventory operations.
// The dispense flow uses complete-dispense in prescriptions.js (which has its own deduction logic).
router.post('/consume', async (req, res) => {
    try {
        const { medicines } = req.body; // Expects [{ name: 'Paracetamol', quantity: 2 }, ...]
        const results = [];

        // PHASE 1: NORMALIZATION & VALIDATION
        const normalizedMedicines = [];

        for (let i = 0; i < medicines.length; i++) {
            const normalized = normalizeMedicineData(medicines[i], i);

            // CRITICAL VALIDATION: Ensure medicine name exists after normalization
            if (!normalized.name || !normalized.medicineId) {
                console.error('❌ Inventory Consume Error: Medicine name is missing or empty', {
                    originalMedicine: medicines[i],
                    normalizedMedicine: normalized,
                    allMedicines: medicines
                });
                return res.status(400).json({
                    success: false,
                    message: `Invalid prescription data: Medicine #${i + 1} has no identifiable name (checked: name, medicineName, drugName, drug)`
                });
            }

            // Validate quantity
            if (isNaN(normalized.quantity) || normalized.quantity <= 0) {
                console.error('❌ Inventory Consume Error: Invalid quantity', { medicine: normalized });
                return res.status(400).json({
                    success: false,
                    message: `Invalid quantity for medicine "${normalized.name}". Quantity must be a positive number.`
                });
            }

            normalizedMedicines.push(normalized);
        }

        // PHASE 2: STRICT VERIFICATION (using medicineId)
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

            const total = availableStock.length > 0 ? availableStock[0].total : 0;
            if (total < med.quantity) {
                console.warn(`⚠️ Insufficient Stock: ${med.name} (${med.medicineId}) - Required: ${med.quantity}, Available: ${total}`);
                return res.status(400).json({
                    success: false,
                    message: `Insufficient stock for "${med.name}". Required: ${med.quantity}, Available: ${total}`
                });
            }
        }

        // PHASE 3: EXECUTION (Deduct Stock & Calculate Cost) with rollback journal
        const deductionJournal = []; // Track deductions for potential rollback

        try {
            for (const med of normalizedMedicines) {
                const reqQty = med.quantity;
                let remaining = reqQty;
                let totalCost = 0;

                // Find batches with stock, oldest first (FIFO), using medicineId
                const batches = await Inventory.find({
                    medicineId: med.medicineId,
                    status: 'ACTIVE',
                    quantityAvailable: { $gt: 0 },
                    expiryDate: { $gt: new Date() }
                }).sort({ expiryDate: 1 });

                // Decrement across batches
                for (const batch of batches) {
                    if (remaining <= 0) break;

                    const take = Math.min(batch.quantityAvailable, remaining);
                    const previousQty = batch.quantityAvailable;

                    batch.quantityAvailable -= take;
                    // Defensive: prevent negative stock
                    if (batch.quantityAvailable < 0) batch.quantityAvailable = 0;
                    remaining -= take;

                    // Pricing
                    totalCost += take * (batch.pricePerUnit || 0);

                    if (batch.quantityAvailable === 0) batch.status = 'DEPLETED';
                    await batch.save();

                    // Record deduction for rollback
                    deductionJournal.push({
                        batchId: batch.batchId,
                        batchObjectId: batch._id,
                        quantityDeducted: take,
                        previousQty: previousQty,
                        previousStatus: previousQty > 0 ? 'ACTIVE' : batch.status
                    });

                    // Fraud Check per batch usage
                    await checkInventoryFraud(batch.batchId, take);
                }

                results.push({
                    name: med.name,
                    medicineId: med.medicineId,
                    status: 'FILLED',
                    quantity: reqQty,
                    cost: totalCost
                });
            }
        } catch (deductionError) {
            // ROLLBACK: Reverse all deductions made so far
            console.error('❌ Deduction failed, rolling back...', deductionError.message);
            for (const entry of deductionJournal) {
                try {
                    await Inventory.updateOne(
                        { _id: entry.batchObjectId },
                        {
                            $inc: { quantityAvailable: entry.quantityDeducted },
                            $set: { status: 'ACTIVE' }
                        }
                    );
                } catch (rollbackErr) {
                    console.error('❌ CRITICAL: Rollback failed for batch', entry.batchId, rollbackErr.message);
                }
            }
            return res.status(500).json({
                success: false,
                message: 'Stock deduction failed. All changes have been rolled back.',
                error: deductionError.message
            });
        }

        // Phase 4: Anchor updated Merkle root after consume
        try {
            await anchorInventoryRoot();
        } catch (e) {
            console.warn(`⚠️ Root anchor failed after consume: ${e.message}`);
        }

        res.json({ success: true, results });
    } catch (error) {
        console.error('❌ Inventory Consume Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 7. Verify Inventory Integrity (ZKP Phase 3)
// Recomputes Merkle root from DB and compares against on-chain anchor.
router.get('/verify-integrity', async (req, res) => {
    try {
        const result = await verifyInventoryRoot();
        res.json({
            success: true,
            valid: result.valid,
            currentRoot: result.currentRoot,
            onChainRoot: result.onChainRoot,
            batchCount: result.batchCount
        });
    } catch (error) {
        console.error('❌ Integrity check error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
