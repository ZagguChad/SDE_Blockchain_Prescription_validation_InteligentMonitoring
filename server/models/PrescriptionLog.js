const mongoose = require('mongoose');

const PrescriptionSchema = new mongoose.Schema({
    blockchainId: { type: String, required: true, unique: true },
    doctorAddress: { type: String, required: true },
    patientName: { type: String }, // Encrypted
    patientUsername: { type: String, required: true }, // Generated once: normalize(name) + "-" + prescriptionId
    patientDOB: { type: Date, required: true }, // Date of Birth for PDF password
    patientEmail: { type: String, required: true }, // Encrypted - for PDF delivery
    patientAge: { type: Number },
    diagnosis: { type: String }, // Encrypted
    allergies: { type: String }, // Encrypted
    medicines: [{
        name: { type: String, required: true },
        dosage: { type: String },
        quantity: { type: Number, required: true },
        instructions: { type: String } // Encrypted
    }],
    notes: { type: String }, // Encrypted
    expiryDate: { type: Date },
    maxUsage: { type: Number, default: 1 }, // New
    usageCount: { type: Number, default: 0 }, // New
    patientHash: { type: String }, // New: Store on-chain hash for verification
    blockchainSynced: { type: Boolean, default: false }, // True after tx receipt.status === 1
    txHash: { type: String, default: null }, // Transaction hash from blockchain
    blockNumber: { type: Number, default: null }, // Block number of confirmed tx
    // Phase 5: Client-Side Identity — only address + commitment stored (NO keys)
    patientCommitment: { type: String, default: null }, // keccak256(patientAddress || DOB) — stored on-chain
    patientAddress: { type: String, default: null },      // Patient ECDSA address (for signature verification)
    // ZKP Phase 2: Hash Integrity Verification
    hashVerified: { type: Boolean, default: false },      // True after on-chain hash match at dispense
    hashVerifiedAt: { type: Date, default: null },        // When hash was verified
    status: { type: String, enum: ['CREATED', 'ACTIVE', 'PENDING_DISPENSE', 'USED', 'EXPIRED', 'DISPENSED'], default: 'ACTIVE' },
    dispensedAt: { type: Date },
    issuedAt: { type: Date, default: Date.now },
    pendingTxHash: { type: String, default: null },    // Phase 3: txHash stored when route sets PENDING_DISPENSE
    confirmedTxHash: { type: String, default: null },  // Phase 3: txHash from confirmed blockchain event
    // Part 3: Billing & Invoice
    dispenseId: { type: String }, // Transaction identifier: DISP-{blockchainId}-{timestamp}
    totalCost: { type: Number },
    invoiceDetails: [{
        name: String,
        quantity: Number,
        pricePerUnit: Number,
        total: Number
    }],
    // ==========================================
    // Adaptive MFA Fields (Phase: MFA Upgrade)
    // All fields are optional with safe defaults
    // for full backward compatibility.
    // ==========================================
    emailOtpEnabled: { type: Boolean, default: true },
    totpEnabled: { type: Boolean, default: false },
    totpSecretEncrypted: { type: String, default: null },
    totpBackupCodes: [{ code: String, used: { type: Boolean, default: false } }],
    mfaLevel: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
    otpAttempts: { type: Number, default: 0 },
    lastOtpRequest: { type: Date, default: null },
    otpLockedUntil: { type: Date, default: null },
    // Dispense-Time MFA Fields (pharmacy-side patient verification)
    dispenseOtpAttempts: { type: Number, default: 0 },
    dispenseOtpLockedUntil: { type: Date, default: null }
});

module.exports = mongoose.model('PrescriptionLog', PrescriptionSchema);
