const mongoose = require('mongoose');

/**
 * Generate a canonical medicineId from a medicine name.
 * E.g. "Paracetamol 500mg" → "paracetamol-500mg"
 * This is exported so other modules can use the same normalization.
 */
function generateMedicineId(name) {
    if (!name) return '';
    return name
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')   // Replace non-alphanumeric with hyphens
        .replace(/^-+|-+$/g, '');       // Trim leading/trailing hyphens
}

const InventorySchema = new mongoose.Schema({
    batchId: {
        type: String,
        required: true,
        unique: true
    },
    medicineId: {
        type: String,
        required: true,
        index: true  // Indexed for fast lookups
    },
    medicineName: {
        type: String,
        required: true
    },
    supplierId: {
        type: String,
        required: true
    },
    quantityInitial: {
        type: Number,
        required: true
    },
    quantityAvailable: {
        type: Number,
        required: true
    },
    expiryDate: {
        type: Date,
        required: true
    },
    pharmacyAddress: {
        type: String,
        required: true
    },
    addedAt: {
        type: Date,
        default: Date.now
    },
    pricePerUnit: {
        type: Number,
        required: true,
        default: 0
    },
    status: {
        type: String,
        enum: ['ACTIVE', 'EXPIRED', 'DEPLETED'],
        default: 'ACTIVE'
    }
});

// Auto-generate medicineId from medicineName before saving
InventorySchema.pre('save', function (next) {
    if (this.isModified('medicineName') || !this.medicineId) {
        this.medicineId = generateMedicineId(this.medicineName);
    }
    next();
});

const Inventory = mongoose.model('Inventory', InventorySchema);

module.exports = Inventory;
module.exports.generateMedicineId = generateMedicineId;
