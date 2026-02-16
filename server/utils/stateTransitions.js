/**
 * stateTransitions.js — Status Consensus Control (Phase 3)
 * 
 * Enforces a strict state machine for prescription status transitions.
 * Only valid transitions are allowed — invalid ones are silently blocked
 * via atomic findOneAndUpdate with status precondition.
 * 
 * This is the SINGLE AUTHORITY for status changes across the system.
 * Both routes and event handlers must use transitionStatus().
 */

const PrescriptionLog = require('../models/PrescriptionLog');

/**
 * Valid state transitions map.
 * Key = current status, Value = array of allowed next statuses.
 * 
 * State Machine:
 *   CREATED → ACTIVE → PENDING_DISPENSE → DISPENSED → ACTIVE (multi-use)
 *                                        → USED (terminal)
 *   Any non-terminal → EXPIRED
 */
const VALID_TRANSITIONS = {
    'CREATED': ['ACTIVE'],
    'ACTIVE': ['PENDING_DISPENSE', 'EXPIRED'],
    'PENDING_DISPENSE': ['DISPENSED', 'USED', 'ACTIVE'],  // ACTIVE = rollback on tx failure
    'DISPENSED': ['ACTIVE', 'EXPIRED'],             // ACTIVE = multi-use Rx ready again
    'USED': [],                                 // Terminal
    'EXPIRED': [],                                 // Terminal
};

/**
 * Check if a status transition is valid.
 * @param {string} currentStatus 
 * @param {string} newStatus 
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateTransition(currentStatus, newStatus) {
    const allowed = VALID_TRANSITIONS[currentStatus];
    if (!allowed) {
        return { valid: false, reason: `Unknown current status: ${currentStatus}` };
    }
    if (!allowed.includes(newStatus)) {
        return {
            valid: false,
            reason: `Invalid transition: ${currentStatus} → ${newStatus}. Allowed: [${allowed.join(', ')}]`
        };
    }
    return { valid: true };
}

/**
 * Atomically transition a prescription's status with guard.
 * Uses findOneAndUpdate with status precondition — only succeeds if
 * the current status is one that allows the requested transition.
 * 
 * @param {string} blockchainId — Prescription ID
 * @param {string} newStatus — Target status
 * @param {object} options — Additional fields to set
 * @param {number} [options.usageCountIncrement] — Amount to $inc usageCount (only for event handler)
 * @param {Date} [options.dispensedAt] — Dispense timestamp
 * @param {string} [options.confirmedTxHash] — Confirmed transaction hash from event
 * @param {string} [options.pendingTxHash] — Pending transaction hash from route
 * @param {string} [options.dispenseId] — Dispense ID
 * @param {Array} [options.invoiceDetails] — Invoice items
 * @param {number} [options.totalCost] — Total cost
 * @returns {Promise<object|null>} Updated document, or null if transition was blocked
 */
async function transitionStatus(blockchainId, newStatus, options = {}) {
    // Determine which current statuses allow this transition
    const allowedFromStatuses = Object.entries(VALID_TRANSITIONS)
        .filter(([, targets]) => targets.includes(newStatus))
        .map(([from]) => from);

    if (allowedFromStatuses.length === 0) {
        console.warn(`⚠️ [STATE] No valid source states for target '${newStatus}'`);
        return null;
    }

    // Build the update object
    const $set = { status: newStatus };
    const update = { $set };

    // Add optional fields
    if (options.dispensedAt) $set.dispensedAt = options.dispensedAt;
    if (options.confirmedTxHash) $set.confirmedTxHash = options.confirmedTxHash;
    if (options.pendingTxHash) $set.pendingTxHash = options.pendingTxHash;
    if (options.dispenseId) $set.dispenseId = options.dispenseId;
    if (options.invoiceDetails) $set.invoiceDetails = options.invoiceDetails;
    if (options.totalCost !== undefined) $set.totalCost = options.totalCost;

    // usageCount increment — atomic, only via event handler
    if (options.usageCountIncrement) {
        update.$inc = { usageCount: options.usageCountIncrement };
    }

    // Atomic update with status precondition
    const result = await PrescriptionLog.findOneAndUpdate(
        {
            blockchainId,
            status: { $in: allowedFromStatuses }
        },
        update,
        { new: true }
    );

    if (result) {
        console.log(`✅ [STATE] ${blockchainId}: ${allowedFromStatuses.join('|')} → ${newStatus}`);
    } else {
        // Fetch current status to log why it was blocked
        const current = await PrescriptionLog.findOne({ blockchainId }, { status: 1 });
        const currentStatus = current ? current.status : 'NOT_FOUND';
        console.warn(`⚠️ [STATE] Transition BLOCKED for ${blockchainId}: ${currentStatus} → ${newStatus} (not in allowed sources: [${allowedFromStatuses.join(', ')}])`);
    }

    return result;
}

module.exports = {
    VALID_TRANSITIONS,
    validateTransition,
    transitionStatus,
};
