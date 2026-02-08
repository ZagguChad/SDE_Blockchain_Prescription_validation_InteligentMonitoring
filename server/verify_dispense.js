// Native fetch

// Actually, earlier native fetch worked without require.

const BASE_URL = 'http://localhost:5000/api';

async function runTest() {
    console.log("🧪 Starting Full Dispense Verification...");

    // 1. Create Pharmacy User
    console.log("\n🔹 1. Creating Pharmacy...");
    const pharmEmail = `pharm_${Date.now()}@test.com`;
    let pharmToken = '';

    try {
        const res = await fetch(`${BASE_URL}/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Test Pharmacy', email: pharmEmail, password: 'password123', role: 'pharmacy' })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message);
        pharmToken = data.token;
        console.log("✅ Pharmacy Created");
    } catch (e) { console.error("❌ Pharmacy Setup Failed:", e.message); return; }

    // 2. Add Inventory (Medicine: 'FixMed', Qty: 5)
    console.log("\n🔹 2. Adding Inventory...");
    const batchId = `BATCH-${Date.now()}`;
    try {
        const res = await fetch(`${BASE_URL}/inventory/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                batchId,
                medicineName: 'FixMed',
                supplierId: 'SUP-1',
                quantity: 5,
                expiryDate: new Date(Date.now() + 100000000).toISOString(),
                pharmacyAddress: '0xPharm',
                price: 10
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message);
        console.log("✅ Inventory Added: FixMed (Qty: 5)");
    } catch (e) { console.error("❌ Inventory Add Failed:", e.message); return; }

    // 3. Register Doctor & Issue Prescription
    console.log("\n🔹 3. Issuing Prescription...");
    const docEmail = `doc_${Date.now()}@test.com`;
    let docToken = '';
    const blockchainId = `TX-${Date.now()}`;

    try {
        // Doc Signup
        const r1 = await fetch(`${BASE_URL}/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Dr Test', email: docEmail, password: 'password123', role: 'doctor' })
        });
        docToken = (await r1.json()).token;

        // Prescribe
        const r2 = await fetch(`${BASE_URL}/prescriptions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${docToken}` },
            body: JSON.stringify({
                blockchainId,
                doctorAddress: '0xDoc',
                patientName: 'John',
                medicines: [{ name: 'FixMed', quantity: 2, dosage: '10mg' }] // Consuming 2 (Remaining 3)
            })
        });
        if (!r2.ok) throw new Error((await r2.json()).error);
        console.log("✅ Prescription Issued");
    } catch (e) { console.error("❌ Prescription Failed:", e.message); return; }

    // 4. Dispense Prescription
    console.log("\n🔹 4. Dispensing...");
    try {
        const res = await fetch(`${BASE_URL}/prescriptions/complete-dispense`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${pharmToken}` },
            body: JSON.stringify({
                blockchainId,
                invoiceDetails: [],
                totalCost: 20
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(JSON.stringify(data));
        console.log("✅ Dispense Success:", data.message);
    } catch (e) { console.error("❌ Dispense Failed:", e.message); return; }

    // 5. Verify Stock Reduction
    console.log("\n🔹 5. Verifying Stock...");
    try {
        const res = await fetch(`${BASE_URL}/inventory/stock/FixMed`);
        const data = await res.json();
        const batch = data.data.find(b => b.batchId === batchId);
        if (batch && batch.quantityAvailable === 3) {
            console.log("✅ Stock Correct: 3 remaining");
        } else {
            console.error("❌ Stock Incorrect:", batch ? batch.quantityAvailable : 'Batch not found');
        }
    } catch (e) { console.error("❌ Stock Check Failed:", e.message); }

    // 6. Test Insufficient Stock
    console.log("\n🔹 6. Testing Insufficient Stock...");
    // Create new prescription for 10 units (Have 3)
    const badTxId = `TX-BAD-${Date.now()}`;
    try {
        await fetch(`${BASE_URL}/prescriptions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${docToken}` },
            body: JSON.stringify({
                blockchainId: badTxId,
                doctorAddress: '0xDoc',
                patientName: 'John',
                medicines: [{ name: 'FixMed', quantity: 10, dosage: '10mg' }]
            })
        });

        const res = await fetch(`${BASE_URL}/prescriptions/complete-dispense`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${pharmToken}` },
            body: JSON.stringify({ blockchainId: badTxId })
        });
        const data = await res.json();

        if (res.status === 400 && data.message.includes('Insufficient stock')) {
            console.log("✅ Correctly Blocked Insufficient Stock:", data.message);
        } else {
            console.error("❌ Failed to block:", res.status, data);
        }

    } catch (e) { console.error("❌ Insufficient Stock Test Error:", e.message); }

}

runTest();
