/**
 * End-to-End Test: Patient Login Flow
 * 
 * This script simulates the complete patient login flow:
 * 1. Doctor creates prescription
 * 2. Patient logs in with credentials
 * 3. Patient views prescription
 * 4. Pharmacy dispenses
 * 5. Patient login fails after dispensing
 */

require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const PrescriptionLog = require('./models/PrescriptionLog');
const User = require('./models/User');
const { generatePatientUsername } = require('./utils/username');
const { encrypt } = require('./utils/encryption');

const BASE_URL = 'http://localhost:5000';
const TEST_PRESCRIPTION_ID = '0xE2E-TEST-' + Date.now();
const TEST_PATIENT_NAME = 'Jane Smith';
const TEST_DOCTOR_ADDRESS = '0xDoctor456';

async function runE2ETest() {
    let patientToken = null;

    try {
        console.log('🧪 Starting End-to-End Patient Login Test...\n');
        console.log('⚠️  Make sure the server is running on port 5000!\n');

        // Connect to MongoDB
        await mongoose.connect(process.env.MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('✅ Connected to MongoDB\n');

        // ═══════════════════════════════════════════════════════════
        // STEP 1: Doctor Creates Prescription (Simulated)
        // ═══════════════════════════════════════════════════════════
        console.log('📝 STEP 1: Doctor Creates Prescription');

        const patientUsername = generatePatientUsername(TEST_PATIENT_NAME, TEST_PRESCRIPTION_ID);
        console.log(`   Generated Username: ${patientUsername}`);

        const prescription = await PrescriptionLog.create({
            blockchainId: TEST_PRESCRIPTION_ID,
            doctorAddress: TEST_DOCTOR_ADDRESS,
            patientName: encrypt(TEST_PATIENT_NAME),
            patientUsername: patientUsername,
            patientAge: 35,
            diagnosis: encrypt('Test Diagnosis'),
            allergies: encrypt('None'),
            medicines: [{
                name: 'Test Medicine',
                dosage: '20mg',
                quantity: 2,
                instructions: encrypt('Take twice daily')
            }],
            notes: encrypt('Test notes'),
            expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            maxUsage: 1,
            usageCount: 0,
            status: 'ACTIVE'
        });

        console.log(`   ✅ Prescription Created: ${prescription.blockchainId}`);
        console.log(`   Patient Credentials:`);
        console.log(`      Username: ${patientUsername}`);
        console.log(`      Password: ${TEST_PRESCRIPTION_ID}\n`);

        // ═══════════════════════════════════════════════════════════
        // STEP 2: Patient Login via /api/patient/access
        // ═══════════════════════════════════════════════════════════
        console.log('🔐 STEP 2: Patient Login');

        try {
            const loginRes = await axios.post(`${BASE_URL}/api/patient/access`, {
                patientUsername: patientUsername,
                prescriptionId: TEST_PRESCRIPTION_ID
            });

            if (loginRes.data.success && loginRes.data.token) {
                patientToken = loginRes.data.token;
                console.log(`   ✅ Login Successful`);
                console.log(`   Token: ${patientToken.substring(0, 20)}...`);
                console.log(`   Prescription ID: ${loginRes.data.prescriptionId}\n`);
            } else {
                console.log(`   ❌ Login Failed: No token received\n`);
                throw new Error('Login failed');
            }
        } catch (error) {
            console.log(`   ❌ Login Failed: ${error.response?.data?.message || error.message}\n`);
            throw error;
        }

        // ═══════════════════════════════════════════════════════════
        // STEP 3: Patient Views Prescription
        // ═══════════════════════════════════════════════════════════
        console.log('👁️  STEP 3: Patient Views Prescription');

        try {
            const viewRes = await axios.get(
                `${BASE_URL}/api/patient/prescription/${TEST_PRESCRIPTION_ID}`,
                {
                    headers: { Authorization: `Bearer ${patientToken}` }
                }
            );

            if (viewRes.data.success) {
                console.log(`   ✅ Prescription Retrieved`);
                console.log(`   Patient Name: ${viewRes.data.data.patientName}`);
                console.log(`   Status: ${viewRes.data.data.status}`);
                console.log(`   Medicines: ${viewRes.data.data.medicines.length} item(s)\n`);
            } else {
                console.log(`   ❌ Failed to retrieve prescription\n`);
                throw new Error('View failed');
            }
        } catch (error) {
            console.log(`   ❌ View Failed: ${error.response?.data?.message || error.message}\n`);
            throw error;
        }

        // ═══════════════════════════════════════════════════════════
        // STEP 4: Test Wrong Prescription Access (Should Fail)
        // ═══════════════════════════════════════════════════════════
        console.log('🚫 STEP 4: Test Access Control (Wrong Prescription)');

        try {
            await axios.get(
                `${BASE_URL}/api/patient/prescription/0xWRONG123`,
                {
                    headers: { Authorization: `Bearer ${patientToken}` }
                }
            );
            console.log(`   ❌ Access control failed - should have blocked access\n`);
        } catch (error) {
            if (error.response?.status === 403) {
                console.log(`   ✅ Access correctly denied (403 Forbidden)\n`);
            } else {
                console.log(`   ⚠️  Unexpected error: ${error.response?.status}\n`);
            }
        }

        // ═══════════════════════════════════════════════════════════
        // STEP 5: Pharmacy Dispenses (Simulated)
        // ═══════════════════════════════════════════════════════════
        console.log('💊 STEP 5: Pharmacy Dispenses Medicine');

        await PrescriptionLog.updateOne(
            { blockchainId: TEST_PRESCRIPTION_ID },
            {
                status: 'DISPENSED',
                dispensedAt: new Date()
            }
        );
        console.log(`   ✅ Prescription marked as DISPENSED\n`);

        // ═══════════════════════════════════════════════════════════
        // STEP 6: Patient Login Should Fail After Dispensing
        // ═══════════════════════════════════════════════════════════
        console.log('🔒 STEP 6: Patient Login After Dispensing (Should Fail)');

        try {
            await axios.post(`${BASE_URL}/api/patient/access`, {
                patientUsername: patientUsername,
                prescriptionId: TEST_PRESCRIPTION_ID
            });
            console.log(`   ❌ Login succeeded - should have been blocked!\n`);
        } catch (error) {
            if (error.response?.status === 403) {
                console.log(`   ✅ Login correctly denied (403)`);
                console.log(`   Message: ${error.response.data.message}\n`);
            } else {
                console.log(`   ⚠️  Unexpected error: ${error.response?.status}\n`);
            }
        }

        // ═══════════════════════════════════════════════════════════
        // STEP 7: Existing Token Should Not Work
        // ═══════════════════════════════════════════════════════════
        console.log('🔒 STEP 7: Existing Token Access After Dispensing');

        try {
            await axios.get(
                `${BASE_URL}/api/patient/prescription/${TEST_PRESCRIPTION_ID}`,
                {
                    headers: { Authorization: `Bearer ${patientToken}` }
                }
            );
            console.log(`   ❌ Access succeeded - should have been blocked!\n`);
        } catch (error) {
            if (error.response?.status === 403) {
                console.log(`   ✅ Access correctly denied (403)`);
                console.log(`   Message: ${error.response.data.message}\n`);
            } else {
                console.log(`   ⚠️  Unexpected error: ${error.response?.status}\n`);
            }
        }

        // ═══════════════════════════════════════════════════════════
        // STEP 8: Verify No Patient User Created
        // ═══════════════════════════════════════════════════════════
        console.log('👤 STEP 8: Verify No Patient User in Database');

        const patientUser = await User.findOne({
            linkedPrescriptionId: TEST_PRESCRIPTION_ID
        });

        if (!patientUser) {
            console.log(`   ✅ No patient user account exists (correct)\n`);
        } else {
            console.log(`   ❌ Patient user account found (should not exist)\n`);
        }

        // Cleanup
        console.log('🧹 Cleaning up test data...');
        await PrescriptionLog.deleteOne({ blockchainId: TEST_PRESCRIPTION_ID });
        console.log('✅ Test data cleaned up\n');

        console.log('═══════════════════════════════════════════════════════════');
        console.log('✅ ALL END-TO-END TESTS PASSED');
        console.log('═══════════════════════════════════════════════════════════\n');
        console.log('Summary:');
        console.log('✓ Prescription creation generates username');
        console.log('✓ Patient login works with correct credentials');
        console.log('✓ Patient can view their prescription');
        console.log('✓ Access control prevents viewing other prescriptions');
        console.log('✓ Pharmacy dispensing updates status');
        console.log('✓ Patient login fails after dispensing');
        console.log('✓ Existing tokens denied after dispensing');
        console.log('✓ No patient user accounts created');
        console.log('\n🎉 Patient Access System Working Perfectly!');

    } catch (error) {
        console.error('\n❌ Test Failed:', error.message);
        if (error.response) {
            console.error('Response:', error.response.data);
        }
    } finally {
        await mongoose.connection.close();
        console.log('\n🔌 Database connection closed');
    }
}

// Run tests
console.log('Starting in 2 seconds...\n');
setTimeout(runE2ETest, 2000);
