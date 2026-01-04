import { useState } from 'react';
import { ethers } from 'ethers';
import axios from 'axios';

import contractInfo from '../contractInfo.json';

const CONTRACT_ADDRESS = contractInfo.address;
const ABI = contractInfo.abi;

const PharmacyDashboard = ({ account }) => {
    const [searchId, setSearchId] = useState('');
    const [data, setData] = useState(null); // Backend Data
    const [chainData, setChainData] = useState(null); // Blockchain Data
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('');

    const handleSearch = async () => {
        if (!searchId) return;
        setLoading(true);
        setStatus('Fetching details...');
        setData(null);
        setChainData(null);

        try {
            // 1. Get Off-chain Metadata
            const res = await axios.get(`http://localhost:5000/api/prescriptions/${searchId}`);
            if (res.data.success) {
                setData(res.data.data);
            } else {
                setStatus('Prescription not found in database.');
                setLoading(false);
                return;
            }

            // 2. Get On-chain Status
            const provider = new ethers.BrowserProvider(window.ethereum);
            const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

            // Pass the ID as a bytes32 encoded string to find it on-chain
            const formattedId = ethers.encodeBytes32String(searchId);
            const p = await contract.getPrescription(formattedId);

            // p is a Result object or struct
            if (p.issuer === ethers.ZeroAddress) {
                setStatus('Prescription found in DB but NOT on Blockchain (Sync Error?)');
                setChainData(null);
                setLoading(false);
                return;
            }

            setChainData({
                status: p.status === 0n ? 'ISSUED' : 'DISPENSED', // 0=ISSUED, 1=DISPENSED
                issuer: p.issuer
            });
            setStatus('');

        } catch (error) {
            console.error(error);
            setStatus('Error fetching data: ' + error.message);
        }
        setLoading(false);
    };

    const dispense = async () => {
        if (!account) return alert('Connect Wallet!');
        setLoading(true);
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

            const formattedId = ethers.encodeBytes32String(searchId);
            const tx = await contract.dispensePrescription(formattedId);
            setStatus('Dispensing transaction sent...');
            await tx.wait();

            setStatus('Dispensed Successfully!');
            setChainData(prev => ({ ...prev, status: 'DISPENSED' }));

        } catch (error) {
            console.error(error);
            setStatus('Error dispensing: ' + error.reason);
        }
        setLoading(false);
    };

    return (
        <div className="container animate-fade">
            <h2 className="center-text">Pharmacy Dashboard</h2>
            <div className="card" style={{ maxWidth: '600px', margin: '2rem auto' }}>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <input
                        className="input-field"
                        style={{ marginBottom: 0 }}
                        placeholder="Enter Prescription ID"
                        value={searchId}
                        onChange={e => setSearchId(e.target.value)}
                    />
                    <button className="btn" onClick={handleSearch} disabled={loading}>
                        {loading ? '...' : 'Verify'}
                    </button>
                </div>

                {status && <p className="mt-2" style={{ color: 'var(--text-muted)' }}>{status}</p>}

                {data && chainData && (
                    <div className="mt-4 animate-fade" style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: 'var(--radius-sm)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h3 style={{ margin: 0 }}>#{data.blockchainId}</h3>
                            <span className={chainData.status === 'ISSUED' ? 'badge badge-success' : 'badge badge-error'}>
                                {chainData.status}
                            </span>
                        </div>

                        <div style={{ display: 'grid', gap: '0.5rem', color: 'var(--text-main)' }}>
                            <p><strong style={{ color: 'var(--text-muted)' }}>Patient:</strong> {data.patientName} (Age: {data.patientAge})</p>

                            <div>
                                <strong style={{ color: 'var(--text-muted)' }}>Medicines:</strong>
                                <ul style={{ paddingLeft: '1.2rem', marginTop: '0.2rem' }}>
                                    {data.medicines && data.medicines.map((m, i) => (
                                        <li key={i}>{m.name} ({m.dosage}) - Qty: {m.quantity}</li>
                                    ))}
                                </ul>
                            </div>

                            <p><strong style={{ color: 'var(--text-muted)' }}>Notes:</strong> {data.notes}</p>
                            <p><strong style={{ color: 'var(--text-muted)' }}>Doctor:</strong> <span style={{ fontFamily: 'monospace', fontSize: '0.9em' }}>{data.doctorAddress}</span></p>
                        </div>

                        {chainData.status === 'ISSUED' && (
                            <button className="btn mt-4" style={{ width: '100%', background: 'linear-gradient(135deg, var(--secondary), #db2777)' }} onClick={dispense}>
                                Dispense Medicine
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PharmacyDashboard;
