const cron = require('node-cron');
const PrescriptionLog = require('../models/PrescriptionLog');
const { transitionStatus } = require('../utils/stateTransitions');

// Run every hour
const startExpiryJob = () => {
    cron.schedule('0 * * * *', async () => {
        console.log('⏳ Running Expiry Check Job...');

        try {
            const now = new Date();

            // Find prescriptions that are expired but still in a non-terminal state
            const expiredPrescriptions = await PrescriptionLog.find({
                expiryDate: { $lt: now },
                status: { $in: ['ACTIVE', 'PENDING_DISPENSE', 'DISPENSED'] }
            });

            if (expiredPrescriptions.length > 0) {
                console.log(`Found ${expiredPrescriptions.length} expired prescriptions. Updating status...`);

                let transitioned = 0;
                let blocked = 0;

                for (const rx of expiredPrescriptions) {
                    // Phase 3: Use state transition guard
                    const result = await transitionStatus(rx.blockchainId, 'EXPIRED');
                    if (result) {
                        transitioned++;
                    } else {
                        blocked++;
                    }
                }

                console.log(`✅ Expiry Job: ${transitioned} transitioned to EXPIRED, ${blocked} blocked by state guard.`);
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

