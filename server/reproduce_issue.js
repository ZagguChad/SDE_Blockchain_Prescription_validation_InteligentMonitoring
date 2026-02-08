const BASE_URL = 'http://localhost:5000/api';

async function testFlow() {
    console.log("🧪 Starting Full Flow Test...");

    // 1. Register Doctor
    console.log("\n🔹 1. Registering Doctor...");
    const doctorEmail = `doc_${Date.now()}@test.com`;
    const doctorPass = 'password123';
    let doctorToken = '';
    let doctorAddress = '0xDoctorAddress_' + Date.now();

    try {
        const res = await fetch(`${BASE_URL}/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Dr. Test',
                email: doctorEmail,
                password: doctorPass,
                role: 'doctor'
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(`${res.status} - ${JSON.stringify(data)}`);
        doctorToken = data.token;
        console.log("✅ Doctor Registered & Logged In");
    } catch (e) {
        console.error("❌ Doctor Signup Failed:", e.message);
        if (e.message.includes('500')) console.log("🚨 CAPTURED 500 IN SIGNUP");
        return;
    }

    // 2. Issue Prescription (Prescriptions Flow)
    console.log("\n🔹 2. Issuing Prescription...");
    const blockchainId = '0xPrescriptionHash_' + Date.now();
    try {
        const res = await fetch(`${BASE_URL}/prescriptions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${doctorToken}`
            },
            body: JSON.stringify({
                blockchainId,
                doctorAddress,
                patientName: 'John Doe',
                patientAge: 30,
                diagnosis: 'Flu',
                allergies: 'None',
                medicines: [{ name: 'Paracetamol', dosage: '500mg', instructions: 'Twice a day' }],
                notes: 'Rest well',
                expiryDate: new Date(Date.now() + 86400000).toISOString()
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(`${res.status} - ${JSON.stringify(data)}`);
        console.log("✅ Prescription Issued:", data.success);
    } catch (e) {
        console.error("❌ Prescription Issue Failed:", e.message);
        if (e.message.includes('500')) console.log("🚨 CAPTURED 500 IN PRESCRIBE");
    }

    // 3. Login as Patient using Auto-Access (Patient Flow)
    console.log("\n🔹 3. Patient Auto-Login...");
    // Username: RX-{First 6 of ID}
    // Password: The full Blockchain ID
    const patientUser = `RX-${blockchainId.slice(0, 6)}`;
    const patientPass = blockchainId;

    try {
        const res = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: patientUser,
                password: patientPass
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(`${res.status} - ${JSON.stringify(data)}`);
        console.log("✅ Patient Logged In");
    } catch (e) {
        console.error("❌ Patient Login Failed:", e.message);
        if (e.message.includes('500')) console.log("🚨 CAPTURED 500 IN PATIENT LOGIN");
    }

}

testFlow();
