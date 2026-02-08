const mongoose = require('mongoose');

const InventorySchema = new mongoose.Schema({
    batchId: {
        type: String,
        required: true,
        unique: true
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

module.exports = mongoose.model('Inventory', InventorySchema);
