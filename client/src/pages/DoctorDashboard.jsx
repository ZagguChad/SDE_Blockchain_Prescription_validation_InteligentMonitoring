import { useState } from 'react';
import { ethers } from 'ethers';
import axios from 'axios';
import VoiceAssistant from '../components/VoiceAssistant';

// Placeholder ABI & Address (Replace after deployment)
const CONTRACT_ADDRESS = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"; // Localhost default
const ABI = [
    "function issuePrescription(bytes32 _patientHash, bytes32 _medicationHash, uint256 _quantity) external",
    "event PrescriptionIssued(uint256 indexed id, address indexed issuer, bytes32 patientHash)"
];

const DoctorDashboard = ({ account }) => {
    const [formData, setFormData] = useState({
        patientName: '',
        age: '',
        medicine: '',
        quantity: 1,
        notes: ''
    });
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('');
    const [statusType, setStatusType] = useState('info'); // info, success, error

    const [fullTranscript, setFullTranscript] = useState('');

    const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

    // NLP Parsing Logic (LLM Powered)
    const handleVoiceTranscript = (finalChunk, interimChunk) => {
        // Accumulate final text
        if (finalChunk) {
            setFullTranscript(prev => {
                const newText = prev + finalChunk;
                return newText;
            });
        }

        // Feedback loops
        if (interimChunk) {
            setStatus(`Listening: ${interimChunk}`);
        }
    };

    const processWithAI = async (text) => {
        if (!text || text.length < 5) return;

        setStatus('AI Analysing...');
        setStatusType('info');

        try {
            const res = await axios.post('http://localhost:5000/api/parse-prescription', { transcript: text });
            if (res.data.success) {
                const aiData = res.data.data;
                console.log("AI Data:", aiData);

                setFormData(prev => ({
                    ...prev,
                    patientName: aiData.patientName || prev.patientName,
                    age: aiData.age || prev.age,
                    medicine: aiData.medicine || prev.medicine,
                    quantity: aiData.quantity || prev.quantity,
                    notes: aiData.notes || prev.notes
                }));

                setStatus('AI Updated Form');
                setStatusType('success');
            }
        } catch (err) {
            console.error("AI Error:", err);
            // Non-blocking error, just log
        }
    };

    const issuePrescription = async (e) => {
        e.preventDefault();
        if (!account) return alert("Connect Wallet first!");
        setLoading(true);
        setStatus('Preparing transaction...');
        setStatusType('info');

        try {
            // 1. Hash the data (Client-side simulation)
            const patientHash = ethers.keccak256(ethers.toUtf8Bytes(formData.patientName + formData.age));
            const medHash = ethers.keccak256(ethers.toUtf8Bytes(formData.medicine));

            // 2. Interact with Blockchain
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

            const tx = await contract.issuePrescription(patientHash, medHash, formData.quantity);
            setStatus('Transaction sent... waiting for confirmation');

            const receipt = await tx.wait();

            // Parse event to find ID (Simplification)
            const iface = new ethers.Interface(ABI);
            let pId = 0;
            // Best effort log parsing
            for (const log of receipt.logs) {
                try {
                    const parsed = iface.parseLog(log);
                    if (parsed && parsed.name === 'PrescriptionIssued') {
                        pId = Number(parsed.args[0]);
                        break;
                    }
                } catch (e) { }
            }

            setStatus(`On-chain success! Issued ID: ${pId}. Saving metadata...`);

            // 3. Save Metadata to Backend
            await axios.post('http://localhost:5000/api/prescriptions', {
                blockchainId: pId,
                doctorAddress: account,
                patientName: formData.patientName,
                patientAge: formData.age,
                medicineDetails: {
                    name: formData.medicine,
                    quantity: formData.quantity
                },
                notes: formData.notes
            });

            setStatus(`Success! Prescription #${pId} Issued.`);
            setStatusType('success');

        } catch (error) {
            console.error(error);
            setStatus('Error: ' + (error.reason || error.message));
            setStatusType('error');
        }
        setLoading(false);
    };

    return (
        <div className="container animate-fade">
            <h2 className="center-text">Doctor Dashboard</h2>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '2rem' }}>
                <VoiceAssistant
                    onTranscript={handleVoiceTranscript}
                    onStatusChange={(s) => {
                        if (s.includes('Error')) setStatusType('error');
                        else setStatusType('info');
                        setStatus(s);
                    }}
                />

                {/* Transcript Display & Manual Trigger */}
                <div style={{ width: '100%', maxWidth: '600px', marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
                    <textarea
                        className="input-field"
                        rows="2"
                        placeholder="Live transcript will appear here... (or type manually)"
                        value={fullTranscript}
                        onChange={(e) => setFullTranscript(e.target.value)}
                        style={{ fontSize: '0.9rem', flex: 1 }}
                    />
                    <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => processWithAI(fullTranscript)}
                        disabled={loading || !fullTranscript}
                        style={{ whiteSpace: 'nowrap' }}
                    >
                        ✨ AI Fill
                    </button>
                </div>
                <p className="center-text" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                    Tip: Speak naturally, then click "✨ AI Fill". <br />
                    <em>"Patient John Doe Age 40 Medicine Aspirin Quantity 10"</em>
                </p>
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

                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                        <div>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Medicine</label>
                            <input className="input-field" name="medicine" placeholder="Amoxicillin" value={formData.medicine} onChange={handleChange} required />
                        </div>
                        <div>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Qty</label>
                            <input className="input-field" name="quantity" placeholder="10" type="number" value={formData.quantity} onChange={handleChange} required />
                        </div>
                    </div>

                    <div>
                        <label style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Notes</label>
                        <textarea className="input-field" name="notes" rows="3" placeholder="Dosage: 500mg twice daily..." value={formData.notes} onChange={handleChange} />
                    </div>

                    <button className="btn" disabled={loading} style={{ marginTop: '1rem' }}>
                        {loading ? 'Processing...' : 'Issue Prescription'}
                    </button>
                </form>

                {status && (
                    <div className={`mt-4 fade-in`} style={{
                        padding: '1rem',
                        borderRadius: 'var(--radius-sm)',
                        background: statusType === 'success' ? 'rgba(34, 197, 94, 0.15)' : (statusType === 'error' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(56, 189, 248, 0.15)'),
                        color: statusType === 'success' ? '#4ade80' : (statusType === 'error' ? '#f87171' : '#38bdf8'),
                        border: `1px solid ${statusType === 'success' ? 'rgba(34, 197, 94, 0.2)' : (statusType === 'error' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(56, 189, 248, 0.2)')}`
                    }}>
                        {status}
                    </div>
                )}
            </div>
        </div>
    );
};

export default DoctorDashboard;
