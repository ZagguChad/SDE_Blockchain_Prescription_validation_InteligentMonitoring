const axios = require('axios');

const BASE_URL = 'http://localhost:5000/api';

async function runTests() {
    console.log("🧪 Starting Diagnosis...");

    // 1. Test Login (Common failure)
    try {
        console.log("\n🔹 Testing Login...");
        // Use a dummy user or one we hope exists or even invalid creds should return 400, NOT 500.
        const res = await axios.post(`${BASE_URL}/auth/login`, {
            email: 'admin@blockrx.com', // Assuming admin exists
            password: 'password123'
        });
        console.log("✅ Login Success:", res.status);
    } catch (err) {
        if (err.response) {
            console.log(`❌ Login Failed: ${err.response.status} - ${JSON.stringify(err.response.data)}`);
            if (err.response.status === 500) console.log("🚨 CAPTURED 500 ERROR IN LOGIN");
        } else {
            console.log("❌ Login Network Error:", err.message);
        }
    }

    // 2. Test Public Inventory (No Auth needed usually? Or is it protected?)
    // Inventory GET / is public or protected?
    // Inventory routes usually protected? 
    // routes/inventory.js: "router.get('/', async (req, res)..." -> No protect middleware!
    try {
        console.log("\n🔹 Testing Inventory List (Public)...");
        const res = await axios.get(`${BASE_URL}/inventory`);
        console.log("✅ Inventory List Success:", res.status);
    } catch (err) {
        if (err.response) {
            console.log(`❌ Inventory Failed: ${err.response.status} - ${JSON.stringify(err.response.data)}`);
        } else {
            console.log("❌ Inventory Network Error:", err.message);
        }
    }
}

// Wait for server to start
setTimeout(runTests, 3000);
