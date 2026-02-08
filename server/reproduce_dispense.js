// Native fetch used


const BASE_URL = 'http://localhost:5000/api';

async function reproduceError() {
    console.log("🧪 Testing Inventory Consume with Malformed Data...");

    // Scenario: Sending an object without 'name' property
    // This simulates the "undefined" error source
    const payload = {
        medicines: [
            { quantity: 1 } // Missing 'name'
        ]
    };

    try {
        const res = await fetch(`${BASE_URL}/inventory/consume`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        console.log(`Response Status: ${res.status}`);
        console.log(`Response Body: ${JSON.stringify(data)}`);

        if (data.message && data.message.includes('Insufficient stock for undefined')) {
            console.log("✅ Custom Error Reproduced: 'Insufficient stock for undefined'");
        } else {
            console.log("❌ Failed to reproduce exact error message.");
        }

    } catch (e) {
        console.error("Network Error:", e);
    }
}

reproduceError();
