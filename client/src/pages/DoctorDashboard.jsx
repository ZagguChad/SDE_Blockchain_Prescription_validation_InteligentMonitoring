import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import axios from 'axios';
import jsPDF from 'jspdf';
import contractInfo from '../contractInfo.json';

const CONTRACT_ADDRESS = contractInfo.address;
const ABI = contractInfo.abi;

const DoctorDashboard = ({ account }) => {
    const [formData, setFormData] = useState({
        patientName: '',
        age: '',
        patientDOB: '',
        patientEmail: '',
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
    const [stats, setStats] = useState({ totalIssued: 0, dispensed: 0, expired: 0 });

    const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

    // Fetch Stats
    useEffect(() => {
        if (account) {
            axios.get(`http://localhost:5000/api/prescriptions/stats/doctor/${account}`)
                .then(res => {
                    if (res.data.success) setStats(res.data.stats);
                })
                .catch(err => console.error("Stats Fetch Error:", err));
        }
    }, [account, lastIssuedPrescription]); // Re-fetch when new prescription issued

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

    const issuePrescription = async (e) => {
        e.preventDefault();
        if (!account) return alert("Connect Wallet first!");
        setLoading(true);
        setStatus('Preparing transaction...');
        setStatusType('info');

        try {
            // 1. Hash the data (CANONICAL — must match server/utils/canonicalSnapshot.js)
            // Canonical medicine: {name, dosage, quantity(Number)} — NO instructions
            // Sorted alphabetically by name for determinism
            const canonicalMeds = formData.medicines
                .map(m => ({
                    name: String(m.name || '').trim(),
                    dosage: String(m.dosage || '').trim(),
                    quantity: Math.floor(Number(m.quantity) || 0)
                }))
                .sort((a, b) => a.name.localeCompare(b.name));

            const patientHash = ethers.keccak256(ethers.toUtf8Bytes(
                String(formData.patientName).trim() + String(formData.age).trim()
            ));
            const medHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(canonicalMeds)));

            // ID Generation
            const rawUniqueHash = ethers.id(`${formData.patientName}-${formData.age}-${Date.now()}`);
            const shortId = rawUniqueHash.substring(2, 8).toUpperCase();
            const prescriptionIdBytes = ethers.encodeBytes32String(shortId);

            // Validate each medicine quantity before computing total
            for (let i = 0; i < formData.medicines.length; i++) {
                const qty = parseInt(formData.medicines[i].quantity);
                if (isNaN(qty) || qty <= 0) {
                    throw new Error(`Medicine #${i + 1} ("${formData.medicines[i].name || 'unnamed'}") has invalid quantity: ${formData.medicines[i].quantity}`);
                }
            }

            const totalQty = formData.medicines.reduce((acc, m) => acc + (parseInt(m.quantity) || 0), 0);

            // Safety guard: totalQty MUST be positive before blockchain call
            if (totalQty <= 0) {
                throw new Error('Total prescription quantity must be greater than zero.');
            }

            // Expiry Logic: Default 30 days
            const expiryDays = 30;
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + expiryDays);
            const expiryTimestamp = Math.floor(expiryDate.getTime() / 1000);
            const maxUsage = 1; // Default to 1 for now, could be dynamic

            // 2. Interact with Blockchain
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

            // Populate Tx for UI
            const txData = await contract.issuePrescription.populateTransaction(prescriptionIdBytes, patientHash, medHash, totalQty, expiryTimestamp, maxUsage);
            setTxHexData(txData.data);
            setStatus(`Sending Data...`);

            const tx = await contract.issuePrescription(prescriptionIdBytes, patientHash, medHash, totalQty, expiryTimestamp, maxUsage);
            setStatus('Transaction sent... waiting for confirmation');

            const receipt = await tx.wait();

            // Parse event to find ID
            const iface = new ethers.Interface(ABI);
            let pId = null;

            for (const log of receipt.logs) {
                try {
                    const parsed = iface.parseLog(log);
                    if (parsed && parsed.name === 'PrescriptionCreated') { // Event name changed
                        const rawBytes = parsed.args[0];
                        pId = ethers.decodeBytes32String(rawBytes);
                        break;
                    }
                } catch (e) {
                    console.warn("Log parse error:", e);
                }
            }

            if (pId === null) {
                throw new Error("Transaction succeeded but 'PrescriptionCreated' event was not found.");
            }

            setStatus(`On-chain success! Issued ID: ${pId}. Saving metadata...`);

            // 3. Save Metadata to Backend (include blockchain sync info)
            const backendRes = await axios.post('http://localhost:5000/api/prescriptions', {
                blockchainId: pId,
                doctorAddress: account,
                patientName: formData.patientName,
                patientAge: Number(formData.age),
                patientDOB: formData.patientDOB,
                patientEmail: formData.patientEmail,
                diagnosis: formData.diagnosis,
                allergies: formData.allergies,
                medicines: formData.medicines,
                notes: formData.notes,
                expiryDate: expiryDate,
                maxUsage: maxUsage,
                patientHash: patientHash,
                txHash: receipt.hash,
                blockNumber: receipt.blockNumber,
                blockchainSynced: receipt.status === 1
            });

            const { patientCredentials, emailSent, emailError } = backendRes.data;

            // Set for display
            setLastIssuedPrescription({
                blockchainId: pId,
                patientName: formData.patientName,
                patientEmail: formData.patientEmail,
                patientUsername: patientCredentials.username,
                age: formData.age,
                medicines: formData.medicines,
                notes: formData.notes,
                expiryDate: expiryDate,
                timestamp: new Date().toLocaleString(),
                emailSent: emailSent,
                emailError: emailError
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

    const generatePDF = () => {
        if (!lastIssuedPrescription) return;
        const doc = new jsPDF();

        doc.setFontSize(20);
        doc.text("Medical Prescription", 105, 20, null, null, "center");

        doc.setFontSize(10);
        doc.text(`ID: ${lastIssuedPrescription.blockchainId}`, 15, 35);
        doc.text(`Date: ${lastIssuedPrescription.timestamp}`, 15, 40);
        doc.text(`Doctor Hash: ${account.substring(0, 10)}...`, 15, 45);

        doc.setFontSize(12);
        doc.text("Patient Details:", 15, 55);
        doc.setFontSize(10);
        doc.text(`Name: ${lastIssuedPrescription.patientName}`, 20, 62);
        doc.text(`Age: ${lastIssuedPrescription.age}`, 20, 67);

        // Print Credentials
        doc.setFontSize(11);
        doc.setTextColor(0, 0, 255); // Blue for visibility
        doc.text(`Login Username: ${lastIssuedPrescription.patientUsername}`, 15, 75);
        doc.setTextColor(0, 0, 0); // Reset to black

        doc.setFontSize(12);
        doc.text("Medicines:", 15, 80);

        let y = 87;
        lastIssuedPrescription.medicines.forEach((med, i) => {
            doc.setFontSize(10);
            const line = `${i + 1}. ${med.name} - ${med.dosage} (Qty: ${med.quantity})`;
            doc.text(line, 20, y);
            y += 7;
        });

        if (lastIssuedPrescription.notes) {
            y += 5;
            doc.text(`Notes: ${lastIssuedPrescription.notes}`, 15, y);
        }

        doc.save(`Prescription_${lastIssuedPrescription.blockchainId}.pdf`);
    };

    const copyToClipboard = () => {
        if (!lastIssuedPrescription) return;
        const meds = lastIssuedPrescription.medicines.map(m => `- ${m.name} (${m.dosage}, Qty: ${m.quantity})`).join('\n');
        const text = `Prescription #${lastIssuedPrescription.blockchainId}\nPatient: ${lastIssuedPrescription.patientName} (Age: ${lastIssuedPrescription.age})\nLogin Username: ${lastIssuedPrescription.patientUsername}\n\nMedicines:\n${meds}\n\nNotes: ${lastIssuedPrescription.notes}`;
        navigator.clipboard.writeText(text);
        alert("Prescription copied to clipboard!");
    };

    return (
        <div className="page-container animate-fade">
            <h2 className="text-center" style={{ margin: 'var(--space-xl) 0' }}>Doctor Dashboard</h2>

            {/* Stats Cards */}
            <div className="grid-layout" style={{ marginBottom: 'var(--space-lg)' }}>
                <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                    <h3 style={{ fontSize: '2rem', color: 'var(--primary-color)', margin: '0 0 0.5rem' }}>{stats.totalIssued}</h3>
                    <span style={{ color: 'var(--text-color)', opacity: 0.7 }}>Total Issued</span>
                </div>
                <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                    <h3 style={{ fontSize: '2rem', color: '#4ade80', margin: '0 0 0.5rem' }}>{stats.dispensed}</h3>
                    <span style={{ color: 'var(--text-color)', opacity: 0.7 }}>Dispensed</span>
                </div>
                <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                    <h3 style={{ fontSize: '2rem', color: '#f87171', margin: '0 0 0.5rem' }}>{stats.expired}</h3>
                    <span style={{ color: 'var(--text-color)', opacity: 0.7 }}>Expired (Unused)</span>
                </div>
            </div>

            <form onSubmit={issuePrescription} className="grid-layout">

                {/* Card 1: Patient Information */}
                <div className="card col-span-6">
                    <h3>👤 Patient Details</h3>
                    <div className="flex gap-md" style={{ flexDirection: 'row' }}>
                        <div className="input-group" style={{ flex: 2 }}>
                            <label className="label">Patient Name</label>
                            <input className="input-field" name="patientName" placeholder="John Doe" value={formData.patientName} onChange={handleChange} required />
                        </div>
                        <div className="input-group" style={{ flex: 1 }}>
                            <label className="label">Age</label>
                            <input className="input-field" name="age" placeholder="45" type="number" value={formData.age} onChange={handleChange} required />
                        </div>
                    </div>
                    <div className="flex gap-md" style={{ flexDirection: 'row', marginTop: 'var(--space-md)' }}>
                        <div className="input-group" style={{ flex: 1 }}>
                            <label className="label">Date of Birth</label>
                            <input className="input-field" name="patientDOB" type="date" value={formData.patientDOB} onChange={handleChange} required />
                        </div>
                        <div className="input-group" style={{ flex: 2 }}>
                            <label className="label">Email Address</label>
                            <input className="input-field" name="patientEmail" type="email" placeholder="patient@example.com" value={formData.patientEmail} onChange={handleChange} required />
                        </div>
                    </div>
                </div>

                {/* Card 2: Clinical Data */}
                <div className="card col-span-6">
                    <h3>📋 Clinical Data</h3>
                    <div className="input-group">
                        <label className="label">Diagnosis</label>
                        <input className="input-field" name="diagnosis" placeholder="Type 2 Diabetes" value={formData.diagnosis} onChange={handleChange} />
                    </div>
                    <div className="input-group">
                        <label className="label">Allergies</label>
                        <input className="input-field" name="allergies" placeholder="Populate from AI..." value={formData.allergies} onChange={handleChange} />
                    </div>
                </div>

                {/* Card 3: Medicines (Full Width) */}
                <div className="card col-span-12">
                    <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-md)' }}>
                        <h3>💊 Prescribed Medicines</h3>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={addMedicine}>
                            + Add Medicine
                        </button>
                    </div>

                    <div className="flex flex-col gap-sm">
                        {formData.medicines.map((med, index) => (
                            <div key={index} style={{
                                border: '1px solid var(--glass-border)',
                                padding: 'var(--space-md)',
                                borderRadius: 'var(--radius-sm)',
                                background: 'rgba(0,0,0,0.1)'
                            }}>
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                                    gap: 'var(--space-md)',
                                    alignItems: 'end'
                                }}>
                                    <div className="input-group" style={{ margin: 0 }}>
                                        {index === 0 && <label className="label">Medicine Name</label>}
                                        <input
                                            className="input-field"
                                            placeholder="Medicine Name"
                                            value={med.name}
                                            onChange={(e) => handleMedicineChange(index, 'name', e.target.value)}
                                            required
                                        />
                                    </div>
                                    <div className="input-group" style={{ margin: 0 }}>
                                        {index === 0 && <label className="label">Dosage</label>}
                                        <input
                                            className="input-field"
                                            placeholder="Dosage"
                                            value={med.dosage}
                                            onChange={(e) => handleMedicineChange(index, 'dosage', e.target.value)}
                                        />
                                    </div>
                                    <div className="flex gap-sm items-center">
                                        <div className="input-group" style={{ margin: 0, flex: 1 }}>
                                            {index === 0 && <label className="label">Qty</label>}
                                            <input
                                                className="input-field"
                                                type="number"
                                                placeholder="Qty"
                                                value={med.quantity}
                                                onChange={(e) => handleMedicineChange(index, 'quantity', e.target.value)}
                                                required
                                            />
                                        </div>
                                        {formData.medicines.length > 1 && (
                                            <button type="button" onClick={() => removeMedicine(index)}
                                                style={{
                                                    background: 'none', border: 'none',
                                                    color: 'var(--error)', cursor: 'pointer',
                                                    fontSize: '1.2rem', padding: '0 0.5rem',
                                                    height: '48px', display: 'flex', alignItems: 'center'
                                                }}>
                                                ✕
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="input-group" style={{ marginTop: 'var(--space-lg)' }}>
                        <label className="label">Notes</label>
                        <textarea className="input-field" name="notes" rows="3" placeholder="Additional instructions..." value={formData.notes} onChange={handleChange} />
                    </div>

                    <div className="flex justify-end" style={{ marginTop: 'var(--space-md)' }}>
                        <button className="btn" disabled={loading} style={{ width: '100%', maxWidth: '300px' }}>
                            {loading ? 'Processing Transaction...' : '🔒 Issue Prescription'}
                        </button>
                    </div>
                </div>

                {/* Status Message */}
                {status && (
                    <div className={`col-span-12 card ${statusType === 'success' ? 'badge-success' : statusType === 'error' ? 'badge-error' : ''}`}
                        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                        {status}
                    </div>
                )}
            </form>

            {/* Modal Popup */}
            {showModal && lastIssuedPrescription && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 1000, backdropFilter: 'blur(5px)'
                }}>
                    <div className="card animate-fade" style={{ width: '90%', maxWidth: '700px', background: 'var(--bg-main)', border: '1px solid var(--primary-color)', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                            <h2 style={{ margin: 0, color: 'var(--primary-color)' }}>✅ Prescription Issued</h2>
                            <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--text-color)' }}>×</button>
                        </div>

                        <div style={{ display: 'flex', gap: '2rem', flexDirection: window.innerWidth < 600 ? 'column' : 'row' }}>
                            {/* Prescription Info */}
                            <div style={{ flex: 1, display: 'grid', gap: '0.8rem', fontSize: '0.95rem' }}>
                                <p><strong>ID:</strong> <span style={{ fontSize: '1.2rem', color: 'var(--accent-color)' }}>#{lastIssuedPrescription.blockchainId}</span></p>
                                <p><strong>Patient:</strong> {lastIssuedPrescription.patientName} ({lastIssuedPrescription.age} yrs)</p>
                                <p><strong>Email:</strong> {lastIssuedPrescription.patientEmail}</p>
                                <p><strong>Login Username:</strong> <code style={{ background: '#eee', padding: '2px 5px', borderRadius: '4px' }}>{lastIssuedPrescription.patientUsername}</code></p>

                                <div>
                                    <strong>Medicines:</strong>
                                    <ul style={{ margin: '0.5rem 0 0 1.5rem', padding: 0 }}>
                                        {lastIssuedPrescription.medicines.map((m, i) => (
                                            <li key={i}>{m.name} - {m.dosage} (Qty: {m.quantity})</li>
                                        ))}
                                    </ul>
                                </div>
                                {lastIssuedPrescription.notes && <p><strong>Notes:</strong> {lastIssuedPrescription.notes}</p>}

                                {/* Email Status */}
                                {lastIssuedPrescription.emailSent ? (
                                    <div style={{ marginTop: '1rem', padding: '0.8rem', background: '#d1fae5', border: '1px solid #10b981', borderRadius: '6px' }}>
                                        <p style={{ margin: 0, color: '#065f46', fontSize: '0.9rem' }}>
                                            ✅ <strong>Email Sent Successfully</strong><br />
                                            <span style={{ fontSize: '0.85rem' }}>Password-protected PDF sent to patient's email</span>
                                        </p>
                                    </div>
                                ) : (
                                    <div style={{ marginTop: '1rem', padding: '0.8rem', background: '#fee2e2', border: '1px solid #ef4444', borderRadius: '6px' }}>
                                        <p style={{ margin: 0, color: '#991b1b', fontSize: '0.9rem' }}>
                                            ⚠️ <strong>Email Failed</strong><br />
                                            <span style={{ fontSize: '0.85rem' }}>{lastIssuedPrescription.emailError || 'Unknown error'}</span>
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {txHexData && (
                            <div style={{ marginTop: '1.5rem', background: '#1e1e1e', padding: '0.8rem', borderRadius: '4px', border: '1px solid #333' }}>
                                <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: '#888' }}>🔐 Blockchain Transaction Data (Calldata)</p>
                                <div style={{ fontSize: '0.7rem', color: '#4ade80', fontFamily: 'monospace', wordBreak: 'break-all', maxHeight: '102px', overflowY: 'auto' }}>
                                    {txHexData}
                                </div>
                            </div>
                        )}

                        <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Close</button>
                            <button className="btn" onClick={generatePDF} style={{ background: '#e0f2fe', color: '#0369a1' }}>
                                ⬇️ Download PDF
                            </button>
                            <button className="btn" onClick={copyToClipboard} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                📋 Copy Text
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
};

export default DoctorDashboard;
