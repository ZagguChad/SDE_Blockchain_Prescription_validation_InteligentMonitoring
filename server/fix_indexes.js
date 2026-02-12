const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();

async function fixIndexes() {
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log("✅ MongoDB Connected");

        console.log("🛠 Syncing Indexes...");

        // This drops mismatched indexes and recreates them based on the Schema
        await User.syncIndexes();

        console.log("✅ Indexes Synced Successfully. 'sparse: true' should now be enforced on email.");
        process.exit();

    } catch (error) {
        console.error("❌ Error syncing indexes:", error);
        process.exit(1);
    }
}

fixIndexes();
