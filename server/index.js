// ============================================
// STEP 1: LOAD ENVIRONMENT VARIABLES
// ============================================
require('dotenv').config();

// ============================================
// STEP 2: VALIDATE CRITICAL ENVIRONMENT VARS
// ============================================
const requiredEnvVars = ['MONGO_URI', 'JWT_SECRET'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('❌ FATAL: Missing required environment variables:');
    missingVars.forEach(varName => console.error(`   - ${varName}`));
    console.error('\n💡 Create a .env file in the server directory with these variables.');
    console.error('   See .env.example for reference.\n');
    process.exit(1);
}

// Validate MONGO_URI is a non-empty string
if (typeof process.env.MONGO_URI !== 'string' || process.env.MONGO_URI.trim() === '') {
    console.error('❌ FATAL: MONGO_URI must be a non-empty string');
    process.exit(1);
}

console.log('✅ Environment variables loaded and validated');

// ============================================
// STEP 3: INITIALIZE EXPRESS APP
// ============================================
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ============================================
// STEP 4: CONNECT TO MONGODB (BEFORE ROUTES)
// ============================================
const MONGO_URI = process.env.MONGO_URI.trim();

console.log('🔄 Connecting to MongoDB...');

mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 5000, // Fail fast if can't connect
    bufferCommands: false, // Disable buffering to fail immediately on connection issues
})
    .then(() => {
        console.log('✅ MongoDB Connected Successfully');
        console.log(`   Database: ${mongoose.connection.name}`);

        // ============================================
        // STEP 5: REGISTER ROUTES (AFTER DB CONNECTED)
        // ============================================
        const prescriptionRoutes = require('./routes/prescriptions');
        const analyticsRoutes = require('./routes/analytics');
        const inventoryRoutes = require('./routes/inventory');
        const authRoutes = require('./routes/auth');
        const patientRoutes = require('./routes/patient');
        const mfaRoutes = require('./routes/mfa');

        app.use('/api/prescriptions', prescriptionRoutes);
        app.use('/api/analytics', analyticsRoutes);
        app.use('/api/inventory', inventoryRoutes);
        app.use('/api/auth', authRoutes);
        app.use('/api/patient', patientRoutes);
        app.use('/api/mfa', mfaRoutes);

        const dispenseMfaRoutes = require('./routes/dispenseMfa');
        app.use('/api/dispense-mfa', dispenseMfaRoutes);

        console.log('✅ API Routes Registered');

        // ============================================
        // STEP 6: START BACKGROUND SERVICES
        // ============================================
        const startExpiryJob = require('./cron/expiryJob');
        const startBlockchainListener = require('./services/blockchainListener');

        startExpiryJob();
        startBlockchainListener();

        console.log('✅ Background Services Started');

        // ============================================
        // STEP 7: START SERVER (ONLY AFTER DB READY)
        // ============================================
        const PORT = process.env.PORT || 5000;
        app.listen(PORT, () => {
            console.log(`\n🚀 Server running on port ${PORT}`);
            console.log(`   MongoDB: Connected`);
            console.log(`   Status: Ready to accept requests\n`);
        });
    })
    .catch(err => {
        console.error('❌ FATAL: MongoDB Connection Failed');
        console.error('   Error:', err.message);
        console.error('\n💡 Troubleshooting:');
        console.error('   1. Ensure MongoDB is running (mongod service)');
        console.error('   2. Check MONGO_URI in .env file');
        console.error('   3. Verify network connectivity\n');
        process.exit(1);
    });
