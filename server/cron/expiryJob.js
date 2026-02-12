const cron = require('node-cron');
const PrescriptionLog = require('../models/PrescriptionLog');

// Run every hour
const startExpiryJob = () => {
    cron.schedule('0 * * * *', async () => {
        console.log('⏳ Running Expiry Check Job...');

        try {
            const now = new Date();

            // Find prescriptions that are expired but still marked as ACTIVE
            const expiredPrescriptions = await PrescriptionLog.find({
                expiryDate: { $lt: now },
                status: 'ACTIVE'
            });

            if (expiredPrescriptions.length > 0) {
                console.log(`Found ${expiredPrescriptions.length} expired prescriptions. Updating status...`);

                const result = await PrescriptionLog.updateMany(
                    { _id: { $in: expiredPrescriptions.map(p => p._id) } },
                    { $set: { status: 'EXPIRED' } }
                );

                console.log(`✅ Updated ${result.modifiedCount} prescriptions to EXPIRED.`);
            } else {
                console.log('No expired prescriptions found.');
            }
        } catch (error) {
            console.error('❌ Error in Expiry Job:', error);
        }
    });

    console.log('🕒 Expiry Job Scheduled (Runs every hour).');
};

module.exports = startExpiryJob;
