const mongoose = require('mongoose');
const PrescriptionLog = require('./models/PrescriptionLog');

async function run() {
    try {
        await mongoose.connect('mongodb://localhost:27017/blockchain-prescription');
        console.log('Connected');

        const testId = "1";
        console.log(`Searching for ID: ${testId}`);

        const result = await PrescriptionLog.findOne({ blockchainId: testId });
        console.log('Result:', result);

        const invalidId = "abc";
        console.log(`Searching for invalid ID: ${invalidId}`);
        try {
            await PrescriptionLog.findOne({ blockchainId: invalidId });
        } catch (e) {
            console.log('caught expected error for invalid ID:', e.message);
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.disconnect();
    }
}

run();
