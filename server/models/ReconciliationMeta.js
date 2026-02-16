const mongoose = require('mongoose');

/**
 * ReconciliationMeta — Persists reconciliation state across server restarts.
 * Single-row key/value store for tracking the last reconciled block number.
 */
const ReconciliationMetaSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ReconciliationMeta', ReconciliationMetaSchema);
