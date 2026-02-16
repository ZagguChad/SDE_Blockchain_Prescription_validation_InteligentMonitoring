const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User'); // Fixed path
require('dotenv').config(); // Fixed path

// If running from server root: require('dotenv').config();
// If running from scripts folder: require('dotenv').config({ path: '../.env' });
// Let's assume we run from server root for simplicity or handle both.
// Current CWD in run_command is server root typically.

async function seedAdmin() {
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });

        const adminEmail = process.env.ADMIN_EMAIL || 'admin@blockrx.com';
        const adminPass = process.env.ADMIN_PASS || 'admin123';

        const userExists = await User.findOne({ email: adminEmail });
        if (userExists) {
            console.log('Admin already exists.');
            process.exit();
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(adminPass, salt);

        await User.create({
            name: 'System Admin',
            email: adminEmail,
            password: hashedPassword,
            role: 'admin'
        });

        console.log('Admin user created successfully.');
        console.log(`Email: ${adminEmail}`);
        console.log(`Password: ${adminPass}`);
        process.exit();

    } catch (error) {
        console.error('Error seeding admin:', error);
        process.exit(1);
    }
}

seedAdmin();
