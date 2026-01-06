import { useState } from 'react';
import { ethers } from 'ethers';
import axios from 'axios';


import contractInfo from '../contractInfo.json';

const CONTRACT_ADDRESS = contractInfo.address;
const ABI = contractInfo.abi;

const DoctorDashboard = ({ account }) => {
    const [formData, setFormData] = useState({
        patientName: '',
        age: '',
        diagnosis: '',
        allergies: '',
        medicines: [{ name: '', quantity: 1, dosage: '', instructions: '' }],
        notes: ''
    });
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('');
    const [statusType, setStatusType] = useState('info'); // info, success, error

    const [lastIssuedPrescription, setLastIssuedPrescription] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [txHexData, setTxHexData] = useState('');


    const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

    // Medicine Array Handlers
    const handleMedicineChange = (index, field, value) => {
        const newMedicines = [...formData.medicines];
        newMedicines[index][field] = value;
        setFormData({ ...formData, medicines: newMedicines });
    };

    const addMedicine = () => {
        setFormData({
            ...formData,
            medicines: [...formData.medicines, { name: '', quantity: 1, dosage: '', instructions: '' }]
        });
    };

    const removeMedicine = (index) => {
        const newMedicines = formData.medicines.filter((_, i) => i !== index);
        setFormData({ ...formData, medicines: newMedicines });
    };

    // Medicine Array Handlers

    const issuePrescription = async (e) => {
        e.preventDefault();
        if (!account) return alert("Connect Wallet first!");
        setLoading(true);
        setStatus('Preparing transaction...');
        setStatusType('info');

        try {
            // 1. Hash the data
            const patientHash = ethers.keccak256(ethers.toUtf8Bytes(formData.patientName + formData.age));
            // Hash the entire medicines array for integrity
            const medHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(formData.medicines)));

            // UNSAFE BUT READABLE ID GENERATION (Requested by User)
            // Generate a unique hash based on details + timestamp, then take 6 chars
            const rawUniqueHash = ethers.id(`${formData.patientName}-${formData.age}-${Date.now()}`);
            const shortId = rawUniqueHash.substring(2, 8).toUpperCase(); // Take 6 chars after 0x

            // For Blockchain: Convert the 6-char string to bytes32
            // We use encodeBytes32String so it stores the actual text "A1B2C3", not the hash of it
            const prescriptionIdBytes = ethers.encodeBytes32String(shortId);

            console.log("🆔 Generated Readable ID:", shortId);
            console.log("🆔 Bytes32 Format:", prescriptionIdBytes);

            // Calculate total quantity for contract (metric only)
            const totalQty = formData.medicines.reduce((acc, m) => acc + Number(m.quantity), 0);

            // Expiry Logic: Default 30 days for now (Can be made dynamic)
            const expiryDays = 30;
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + expiryDays);
            const expiryTimestamp = Math.floor(expiryDate.getTime() / 1000); // Unix timestamp for Contract

            // 2. Interact with Blockchain
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

            // Log the Raw Hex Data for verification
            const txData = await contract.issuePrescription.populateTransaction(prescriptionIdBytes, patientHash, medHash, totalQty, expiryTimestamp);
            console.log("🔐 Transaction Data (Hex/Encrypted):", txData.data);
            setTxHexData(txData.data);
            setStatus(`Sending Data...`);

            const tx = await contract.issuePrescription(prescriptionIdBytes, patientHash, medHash, totalQty, expiryTimestamp);
            setStatus('Transaction sent... waiting for confirmation');

            const receipt = await tx.wait();

            // Parse event to find ID
            const iface = new ethers.Interface(ABI);
            let pId = null;

            for (const log of receipt.logs) {
                try {
                    const parsed = iface.parseLog(log);
                    if (parsed && parsed.name === 'PrescriptionIssued') {
                        // The event returns the bytes32 id. We decode it to show the user the readable 6-char ID.
                        const rawBytes = parsed.args[0];
                        pId = ethers.decodeBytes32String(rawBytes);
                        console.log("✅ Found Event: PrescriptionIssued, ID:", pId);
                        break;
                    }
                } catch (e) {
                    console.warn("Log parse error:", e);
                }
            }

            if (pId === null) {
                throw new Error("Transaction succeeded but 'PrescriptionIssued' event was not found. Check contract.");
            }

            setStatus(`On-chain success! Issued ID: ${pId}. Saving metadata...`);

            // 3. Save Metadata to Backend
            await axios.post('http://localhost:5000/api/prescriptions', {
                blockchainId: pId,
                doctorAddress: account,
                patientName: formData.patientName,
                patientAge: Number(formData.age),
                diagnosis: formData.diagnosis,
                allergies: formData.allergies,
                medicines: formData.medicines,
                notes: formData.notes,
                expiryDate: expiryDate // Save actual Date object
            });

            // Set for display
            setLastIssuedPrescription({
                blockchainId: pId,
                patientName: formData.patientName,
                age: formData.age,
                medicines: formData.medicines,
                notes: formData.notes,
                expiryDate: expiryDate
            });

            setStatus(`Success! Prescription #${pId} Issued.`);
            setStatusType('success');
            setShowModal(true);

        } catch (error) {
            console.error(error);
            setStatus('Error: ' + (error.reason || error.message));
            setStatusType('error');
        }
        setLoading(false);
    };

    const copyToClipboard = () => {
        if (!lastIssuedPrescription) return;
        const meds = lastIssuedPrescription.medicines.map(m => `- ${m.name} (${m.dosage}, Qty: ${m.quantity})`).join('\n');
        const text = `Prescription #${lastIssuedPrescription.blockchainId}\nPatient: ${lastIssuedPrescription.patientName} (Age: ${lastIssuedPrescription.age})\n\nMedicines:\n${meds}\n\nNotes: ${lastIssuedPrescription.notes}`;
        navigator.clipboard.writeText(text);
        alert("Prescription copied to clipboard!");
    };

    return (
        <div className="container animate-fade">
            <h2 className="center-text">Doctor Dashboard</h2>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '2rem' }}>
                {/* Voice Assistant Removed */}
            </div>

            <div className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
                <form onSubmit={issuePrescription} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Patient Name</label>
                            <input className="input-field" name="patientName" placeholder="John Doe" value={formData.patientName} onChange={handleChange} required />
                        </div>
                        <div>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Age</label>
                            <input className="input-field" name="age" placeholder="45" type="number" value={formData.age} onChange={handleChange} required />
                        </div>
                    </div>

                    <div>
                        <label style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Diagnosis</label>
                        <input className="input-field" name="diagnosis" placeholder="Type 2 Diabetes" value={formData.diagnosis} onChange={handleChange} />
                    </div>
                    <div>
                        <label style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Allergies</label>
                        <input className="input-field" name="allergies" placeholder="Penicillin" value={formData.allergies} onChange={handleChange} />
                    </div>


                    <div style={{ border: '1px solid var(--border-color)', padding: '1rem', borderRadius: 'var(--radius-sm)' }}>
                        <label style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem', display: 'block' }}>Medicines</label>
                        {formData.medicines.map((med, index) => (
                            <div key={index} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                                <input
                                    className="input-field"
                                    placeholder="Medicine Name"
                                    value={med.name}
                                    onChange={(e) => handleMedicineChange(index, 'name', e.target.value)}
                                    required
                                />
                                <input
                                    className="input-field"
                                    placeholder="Dosage"
                                    value={med.dosage}
                                    onChange={(e) => handleMedicineChange(index, 'dosage', e.target.value)}
                                />
                                <input
                                    className="input-field"
                                    type="number"
                                    placeholder="Qty"
                                    value={med.quantity}
                                    onChange={(e) => handleMedicineChange(index, 'quantity', e.target.value)}
                                    required
                                />
                                {formData.medicines.length > 1 && (
                                    <button type="button" onClick={() => removeMedicine(index)} style={{ background: 'none', border: 'none', color: 'var(--danger-color)', cursor: 'pointer' }}>
                                        🗑️
                                    </button>
                                )}
                            </div>
                        ))}
                        <button type="button" className="btn btn-secondary" onClick={addMedicine} style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}>
                            + Add Another Medicine
                        </button>
                    </div>

                    <div>
                        <label style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Notes</label>
                        <textarea className="input-field" name="notes" rows="3" placeholder="Dosage: 500mg twice daily..." value={formData.notes} onChange={handleChange} />
                    </div>

                    <button className="btn" disabled={loading} style={{ marginTop: '1rem' }}>
                        {loading ? 'Processing...' : 'Issue Prescription'}
                    </button>
                </form>

                {
                    status && (
                        <div className={`mt-4 fade-in`} style={{
                            padding: '1rem',
                            borderRadius: 'var(--radius-sm)',
                            background: statusType === 'success' ? 'rgba(34, 197, 94, 0.15)' : (statusType === 'error' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(56, 189, 248, 0.15)'),
                            color: statusType === 'success' ? '#4ade80' : (statusType === 'error' ? '#f87171' : '#38bdf8'),
                            border: `1px solid ${statusType === 'success' ? 'rgba(34, 197, 94, 0.2)' : (statusType === 'error' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(56, 189, 248, 0.2)')}`
                        }}>
                            {status}
                        </div>
                    )
                }

            </div >

            {/* Modal Popup */}
            {showModal && lastIssuedPrescription && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 1000, backdropFilter: 'blur(5px)'
                }}>
                    <div className="card animate-fade" style={{ width: '90%', maxWidth: '600px', background: 'var(--bg-main)', border: '1px solid var(--primary-color)', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                            <h2 style={{ margin: 0, color: 'var(--primary-color)' }}>✅ Prescription Issued</h2>
                            <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--text-color)' }}>×</button>
                        </div>

                        <div style={{ display: 'grid', gap: '0.8rem', fontSize: '0.95rem' }}>
                            <p><strong>ID:</strong> <span style={{ fontSize: '1.2rem', color: 'var(--accent-color)' }}>#{lastIssuedPrescription.blockchainId}</span></p>
                            <p><strong>Patient:</strong> {lastIssuedPrescription.patientName} ({lastIssuedPrescription.age} yrs)</p>
                            <div>
                                <strong>Medicines:</strong>
                                <ul style={{ margin: '0.5rem 0 0 1.5rem', padding: 0 }}>
                                    {lastIssuedPrescription.medicines.map((m, i) => (
                                        <li key={i}>{m.name} - {m.dosage} (Qty: {m.quantity})</li>
                                    ))}
                                </ul>
                            </div>
                            {lastIssuedPrescription.notes && <p><strong>Notes:</strong> {lastIssuedPrescription.notes}</p>}
                        </div>

                        {/* Hex Data Display */}
                        {txHexData && (
                            <div style={{ marginTop: '1.5rem', background: '#1e1e1e', padding: '0.8rem', borderRadius: '4px', border: '1px solid #333' }}>
                                <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: '#888' }}>🔐 Blockchain Transaction Data (Calldata)</p>
                                <div style={{ fontSize: '0.7rem', color: '#4ade80', fontFamily: 'monospace', wordBreak: 'break-all', maxHeight: '100px', overflowY: 'auto' }}>
                                    {txHexData}
                                </div>
                            </div>
                        )}

                        <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Close</button>
                            <button className="btn" onClick={copyToClipboard} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                📋 Copy Prescription
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
};

export default DoctorDashboard;
