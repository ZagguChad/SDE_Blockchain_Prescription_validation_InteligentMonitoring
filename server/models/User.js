const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    username: {
        type: String,
        unique: true,
        sparse: true // Allows null/undefined to not conflict, but we will generate it for patients
    },
    email: {
        type: String,
        required: false, // Changed from true to false to support patients without email
        unique: true,
        sparse: true // Allows multiple nulls (though we usually want unique if present)
    },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ['doctor', 'pharmacy', 'patient', 'admin'],
        required: true
    },
    // New fields for Prescription-Driven Patient Access
    isTemporary: {
        type: Boolean,
        default: false
    },
    linkedPrescriptionId: {
        type: String,
        default: null
    },
    active: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('User', UserSchema);
