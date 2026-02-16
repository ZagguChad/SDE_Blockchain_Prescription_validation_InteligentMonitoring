import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import axios from 'axios';

import contractInfo from '../contractInfo.json';

const CONTRACT_ADDRESS = contractInfo.address;
const ABI = contractInfo.abi;

const PharmacyDashboard = ({ account }) => {
    const [activeTab, setActiveTab] = useState('dispense');

    // Dispense Tab State
    const [searchId, setSearchId] = useState('');
    const [data, setData] = useState(null);
    const [chainData, setChainData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('');
    const [activityLog, setActivityLog] = useState([]);

    const [invoiceData, setInvoiceData] = useState(null);
    const [hashVerified, setHashVerified] = useState(null); // ZKP Phase 2: null = not checked, true/false = result

    // Dispense MFA State (Patient Re-Verification)
    const [mfaStatus, setMfaStatus] = useState(null);       // { mfaRequired, totpEnabled, emailAvailable, maskedEmail }
    const [showMfaModal, setShowMfaModal] = useState(false);
    const [mfaStep, setMfaStep] = useState('totp');          // 'totp' | 'otp' | 'success' | 'blocked'
    const [mfaCode, setMfaCode] = useState('');
    const [mfaLoading, setMfaLoading] = useState(false);
    const [mfaError, setMfaError] = useState('');
    const [mfaSuccess, setMfaSuccess] = useState('');
    const [dispenseMfaToken, setDispenseMfaToken] = useState(null);
    const [otpSent, setOtpSent] = useState(false);
    const [mfaAttemptsRemaining, setMfaAttemptsRemaining] = useState(5);

    // Inventory Tab State
    const [inventory, setInventory] = useState([]);
    const [newItem, setNewItem] = useState({
        batchId: '',
        medicineName: '',
        supplierId: '',
        quantity: '',
        price: '',
        expiryDate: ''
    });
    const [inventoryIntegrity, setInventoryIntegrity] = useState(null); // ZKP Phase 3

    useEffect(() => {
        if (activeTab === 'dispense') fetchActivity();
        if (activeTab === 'inventory') {
            fetchInventory();
            fetchInventoryIntegrity();
        }
    }, [activeTab]);

    const fetchActivity = async () => {
        try {
            const res = await axios.get('http://localhost:5000/api/prescriptions/stats/pharmacy/activity');
            if (res.data.success) setActivityLog(res.data.data);
        } catch (error) {
            console.error("Error fetching activity:", error);
        }
    };

    const fetchInventory = async () => {
        try {
            const res = await axios.get('http://localhost:5000/api/inventory');
            if (res.data.success) setInventory(res.data.data);
        } catch (error) {
            console.error("Error fetching inventory:", error);
        }
    };

    const fetchInventoryIntegrity = async () => {
        try {
            const res = await axios.get('http://localhost:5000/api/inventory/verify-integrity');
            setInventoryIntegrity(res.data);
        } catch (error) {
            console.error("Integrity check failed:", error);
            setInventoryIntegrity({ valid: false, error: true });
        }
    };

    const handleSearch = async () => {
        if (!searchId) return;
        setLoading(true);
        setStatus('Fetching details...');
        setData(null);
        setChainData(null);
        setHashVerified(null);
        setMfaStatus(null);
        setDispenseMfaToken(null);
        setShowMfaModal(false);

        try {
            // 1. Get Off-chain Metadata
            const res = await axios.get(`http://localhost:5000/api/prescriptions/${encodeURIComponent(searchId)}`);
            if (res.data.success) {
                setData(res.data.data);
            } else {
                setStatus('Prescription not found in database.');
                setLoading(false);
                return;
            }

            // 2. Get On-chain Status
            try {
                const provider = new ethers.BrowserProvider(window.ethereum);
                const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

                const formattedId = ethers.encodeBytes32String(searchId);
                const result = await contract.verifyPrescription(formattedId);
                const exists = result[0];
                const onChainStatus = Number(result[1]);
                const remaining = Number(result[2]);

                if (!exists) {
                    const dbSynced = res.data.data.blockchainSynced;
                    if (dbSynced) {
                        setStatus('⚠️ Blockchain record mismatch (possible Hardhat restart). Prescription may need re-sync.');
                    } else {
                        setStatus('⏳ Pending Blockchain Confirmation — prescription is viewable but cannot be dispensed yet.');
                    }
                    setChainData({ status: 'PENDING_SYNC', pendingSync: true });
                } else {
                    setChainData({
                        status: getStatusString(onChainStatus),
                        issuer: res.data.data.doctorAddress,
                        remaining,
                        pendingSync: false
                    });
                    setStatus('');
                }
            } catch (chainErr) {
                console.warn('Blockchain query failed, showing DB data:', chainErr.message);
                setStatus('⚠️ Could not verify on blockchain. Showing database record.');
                setChainData({ status: 'CHAIN_UNAVAILABLE', pendingSync: true });
            }

            // 3. Fetch Dispense MFA Status
            try {
                const mfaRes = await axios.get(`http://localhost:5000/api/dispense-mfa/status/${encodeURIComponent(searchId)}`);
                if (mfaRes.data.success) {
                    setMfaStatus(mfaRes.data);
                }
            } catch (mfaErr) {
                console.warn('MFA status check failed:', mfaErr.message);
                setMfaStatus({ mfaRequired: false });
            }

        } catch (error) {
            console.error(error);
            setStatus('Error fetching data: ' + error.message);
        }
        setLoading(false);
    };

    const getStatusString = (statusValues) => {
        const mapping = ["CREATED", "ACTIVE", "USED", "EXPIRED"];
        return mapping[statusValues] || "UNKNOWN";
    };

    // MFA Verification Handlers
    const handleDispenseClick = () => {
        // If MFA is required, show modal first. Otherwise, dispense directly.
        if (mfaStatus?.mfaRequired && !dispenseMfaToken) {
            setShowMfaModal(true);
            setMfaStep(mfaStatus.totpEnabled ? 'totp' : 'otp');
            setMfaCode('');
            setMfaError('');
            setMfaSuccess('');
            setOtpSent(false);
            setMfaAttemptsRemaining(5);
        } else {
            dispense();
        }
    };

    const handleVerifyTotp = async () => {
        if (!mfaCode || mfaCode.length !== 6) {
            setMfaError('Please enter a 6-digit authenticator code.');
            return;
        }
        setMfaLoading(true);
        setMfaError('');
        try {
            const res = await axios.post('http://localhost:5000/api/dispense-mfa/verify-totp', {
                prescriptionId: data.blockchainId,
                token: mfaCode
            });
            if (res.data.success) {
                setDispenseMfaToken(res.data.mfaToken);
                setMfaStep('success');
                setMfaSuccess('✅ Patient verified via authenticator!');
                setTimeout(() => {
                    setShowMfaModal(false);
                    dispense(res.data.mfaToken);
                }, 1200);
            }
        } catch (err) {
            const msg = err.response?.data?.message || 'Verification failed.';
            setMfaError(msg);
            if (err.response?.data?.canFallbackToOtp) {
                setMfaError(msg + ' You can use email OTP instead.');
            }
        }
        setMfaLoading(false);
        setMfaCode('');
    };

    const handleSendOtp = async () => {
        setMfaLoading(true);
        setMfaError('');
        try {
            const res = await axios.post('http://localhost:5000/api/dispense-mfa/send-otp', {
                prescriptionId: data.blockchainId
            });
            if (res.data.success) {
                setOtpSent(true);
                setMfaStep('otp');
                setMfaSuccess(`Code sent to ${res.data.maskedEmail}`);
            }
        } catch (err) {
            setMfaError(err.response?.data?.message || 'Failed to send OTP.');
        }
        setMfaLoading(false);
    };

    const handleVerifyOtp = async () => {
        if (!mfaCode || mfaCode.length !== 6) {
            setMfaError('Please enter a 6-digit verification code.');
            return;
        }
        setMfaLoading(true);
        setMfaError('');
        try {
            const res = await axios.post('http://localhost:5000/api/dispense-mfa/verify-otp', {
                prescriptionId: data.blockchainId,
                otp: mfaCode
            });
            if (res.data.success) {
                setDispenseMfaToken(res.data.mfaToken);
                setMfaStep('success');
                setMfaSuccess('✅ Patient verified via email code!');
                setTimeout(() => {
                    setShowMfaModal(false);
                    dispense(res.data.mfaToken);
                }, 1200);
            }
        } catch (err) {
            const msg = err.response?.data?.message || 'Verification failed.';
            setMfaError(msg);
            if (err.response?.data?.attemptsRemaining !== undefined) {
                setMfaAttemptsRemaining(err.response.data.attemptsRemaining);
            }
            if (err.response?.status === 429) {
                setMfaStep('blocked');
            }
        }
        setMfaLoading(false);
        setMfaCode('');
    };

    const dispense = async (mfaTokenOverride) => {
        if (!account) return alert('Connect Wallet!');
        const currentMfaToken = mfaTokenOverride || dispenseMfaToken;
        setLoading(true);
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

            const formattedId = ethers.encodeBytes32String(searchId);

            // 1. Basic sanity check
            if (!data.medicines || data.medicines.length === 0) {
                throw new Error('Invalid prescription: No medicines found.');
            }

            // 2. Pre-Check Validation (no patient signature — verified via TOTP/OTP)
            try {
                const validateRes = await axios.post('http://localhost:5000/api/prescriptions/validate-dispense', {
                    blockchainId: data.blockchainId
                });

                if (!validateRes.data.success) {
                    throw new Error(validateRes.data.message || 'Validation failed');
                }
                setHashVerified(validateRes.data.hashVerified === true);
            } catch (validationErr) {
                const serverMsg = validationErr.response?.data?.message || validationErr.message;
                throw new Error(`Cannot Dispense: ${serverMsg}`);
            }

            // 3. Dispense on Blockchain
            const tx = await contract.dispensePrescription(formattedId);
            setStatus('Dispensing transaction sent...');
            await tx.wait();

            setStatus('Dispensed on-chain! Updating inventory & generating invoice...');
            setChainData(prev => ({ ...prev, status: 'DISPENSED' }));

            // 4. Complete Dispense — includes MFA token if available
            try {
                const dispenseRes = await axios.post('http://localhost:5000/api/prescriptions/complete-dispense', {
                    blockchainId: data.blockchainId,
                    dispenseMfaToken: currentMfaToken || undefined
                });

                if (dispenseRes.data.success) {
                    setStatus('Dispensed, Stock Updated & Invoice Generated!');
                    setInvoiceData({
                        blockchainId: data.blockchainId,
                        dispenseId: dispenseRes.data.dispenseId,
                        patientName: data.patientName,
                        results: dispenseRes.data.invoiceDetails,
                        totalAmount: dispenseRes.data.totalCost,
                        invoicePdfBase64: dispenseRes.data.invoicePdfBase64,
                        date: new Date()
                    });
                } else {
                    setStatus('Dispensed on-chain, but server-side processing failed: ' + (dispenseRes.data.message || 'Unknown error'));
                }
            } catch (finalErr) {
                const serverMsg = finalErr.response?.data?.message || finalErr.message;
                setStatus(`Dispensed on-chain, but server error: ${serverMsg}`);
            }

            fetchActivity();

            // Auto-refresh prescription data to get updated status from chain
            setTimeout(() => handleSearch(), 1500);

        } catch (error) {
            let msg = error.reason || error.message;
            if (msg.includes('Not a pharmacy')) msg = 'Access Denied: You are not a registered Pharmacy.';
            if (msg.includes('Prescription expired')) msg = 'Cannot dispense: Prescription has EXPIRED.';
            if (msg.includes('already been dispensed') || msg.includes('already dispensed')) msg = 'Cannot dispense: Prescription has already been DISPENSED.';
            setStatus('Error: ' + msg);
        }
        setLoading(false);
        setDispenseMfaToken(null);
    };

    // Download Invoice PDF from base64
    const downloadInvoicePDF = () => {
        if (!invoiceData?.invoicePdfBase64) {
            alert('Invoice PDF not available');
            return;
        }
        const byteCharacters = atob(invoiceData.invoicePdfBase64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/pdf' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Invoice_${invoiceData.dispenseId || invoiceData.blockchainId}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
    };

    const handleRegisterBatch = async () => {
        if (!account) return alert('Connect Wallet!');
        // Strict Validation
        if (!newItem.batchId || !newItem.medicineName || !newItem.supplierId || !newItem.expiryDate) {
            return alert("All text fields are required.");
        }
        if (!newItem.quantity || Number(newItem.quantity) <= 0) return alert("Quantity must be > 0");
        if (!newItem.price || Number(newItem.price) <= 0) return alert("Price must be > 0");
        if (new Date(newItem.expiryDate) <= new Date()) return alert("Expiry date must be in the future.");

        setLoading(true);
        setStatus("Registering Batch on Blockchain...");

        try {
            // 1. Register on Blockchain
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

            // Create a simple hash for integrity
            const batchHash = ethers.keccak256(ethers.toUtf8Bytes(newItem.batchId + newItem.supplierId));

            const tx = await contract.registerBatch(newItem.batchId, batchHash);
            await tx.wait();

            // 2. Save to DB
            setStatus("Saving to Inventory DB...");
            await axios.post('http://localhost:5000/api/inventory/add', {
                ...newItem,
                pharmacyAddress: account
            });

            setStatus("Batch Registered & Stock Added!");
            setNewItem({ batchId: '', medicineName: '', supplierId: '', quantity: '', price: '', expiryDate: '' });
            fetchInventory();

        } catch (error) {
            console.error(error);
            setStatus("Error: " + (error.reason || error.message));
        }
        setLoading(false);
    };

    return (
        <div className="page-container animate-fade">
            <h2 className="text-center" style={{ margin: 'var(--space-xl) 0' }}>Pharmacy Dashboard</h2>

            {/* Tabs */}
            <div className="flex justify-center gap-md" style={{ marginBottom: 'var(--space-xl)' }}>
                <button
                    className={`btn ${activeTab === 'dispense' ? '' : 'btn-outline'}`}
                    onClick={() => setActiveTab('dispense')}
                >
                    💊 Dispense Prescription
                </button>
                <button
                    className={`btn ${activeTab === 'inventory' ? '' : 'btn-outline'}`}
                    onClick={() => setActiveTab('inventory')}
                >
                    📦 Inventory Management
                </button>
            </div>

            {activeTab === 'dispense' ? (
                // --- DISPENSE VIEW ---
                <div className="grid-layout" style={{ margin: '0 0 var(--space-2xl) 0' }}>
                    {/* Search Card */}
                    <div className="card col-span-4" style={{ height: 'fit-content' }}>
                        <h3>🔍 Search</h3>
                        <p className="text-muted text-sm" style={{ marginBottom: 'var(--space-md)' }}>Enter ID to verify authenticity</p>
                        <div className="flex flex-col gap-sm">
                            <input
                                className="input-field"
                                style={{ margin: 0 }}
                                placeholder="ID (e.g. A1B2C3)"
                                value={searchId}
                                onChange={e => setSearchId(e.target.value)}
                            />
                            <button className="btn" onClick={handleSearch} disabled={loading} style={{ width: '100%' }}>
                                {loading ? '...' : 'Verify'}
                            </button>
                        </div>
                        {status && <p className="text-sm" style={{ marginTop: 'var(--space-md)', color: 'var(--text-muted)' }}>{status}</p>}
                    </div>

                    {/* Results Card */}
                    {data && chainData && (
                        <div className="card col-span-8">
                            <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-lg)', paddingBottom: 'var(--space-md)', borderBottom: '1px solid var(--glass-border)' }}>
                                <div>
                                    <h2 style={{ margin: 0, color: 'var(--accent)', fontSize: '2rem' }}>#{data.blockchainId}</h2>
                                    <span className="text-sm text-muted">ID Verification Match</span>
                                </div>
                                <div className="flex gap-sm">
                                    {new Date(data.expiryDate) < new Date() && (
                                        <span className="badge badge-error">EXPIRED (DB)</span>
                                    )}
                                    <span className={`badge ${chainData.status === 'ACTIVE' ? 'badge-success' : 'badge-error'}`}>
                                        {chainData.status}
                                    </span>
                                    {hashVerified !== null && (
                                        <span className={`badge ${hashVerified ? 'badge-success' : 'badge-error'}`}
                                            title={hashVerified ? 'On-chain hash matches off-chain data' : 'WARNING: Data integrity mismatch detected'}>
                                            {hashVerified ? '✅ Hash Verified' : '❌ Hash Mismatch'}
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="grid-layout" style={{ marginTop: 0, gap: 'var(--space-lg)', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                                <div>
                                    <h4 className="text-muted text-sm">Patient Details</h4>
                                    <p className="text-xl">{data.patientName}</p>
                                    <p>Age: {data.patientAge}</p>
                                </div>
                                <div>
                                    <h4 className="text-muted text-sm">Doctor</h4>
                                    <p title={data.doctorAddress} style={{ fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {data.doctorAddress.slice(0, 10)}...
                                    </p>
                                </div>
                                <div className="col-span-12">
                                    <h4 className="text-muted text-sm">Prescribed Medicines</h4>
                                    {data.medicines && data.medicines.length > 0 ? (
                                        <ul style={{ paddingLeft: '1.2rem', marginTop: '0.5rem' }}>
                                            {data.medicines.map((m, i) => (
                                                <li key={i}>
                                                    <strong style={{ color: 'var(--text-main)' }}>{m.name || m.medicineName || 'Unknown'}</strong>
                                                    <span style={{ color: 'var(--text-muted)' }}> - {m.dosage || 'N/A'} (Qty: {m.quantity || 1})</span>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p style={{ color: 'var(--error)', marginTop: '0.5rem' }}>
                                            ⚠️ Prescription data corrupted — no medicines found.
                                        </p>
                                    )}
                                </div>
                                {data.notes && (
                                    <div className="col-span-12" style={{ background: 'rgba(0,0,0,0.2)', padding: 'var(--space-md)', borderRadius: 'var(--radius-sm)' }}>
                                        <h4 className="text-muted text-sm">Notes</h4>
                                        <p style={{ margin: 0 }}>{data.notes}</p>
                                    </div>
                                )}
                            </div>

                            {chainData.status === 'ACTIVE' && data.medicines && data.medicines.length > 0 && (
                                <div style={{ marginTop: 'var(--space-lg)', paddingTop: 'var(--space-lg)', borderTop: '1px solid var(--glass-border)' }}>
                                    {/* MFA Status Indicator */}
                                    {mfaStatus?.mfaRequired && (
                                        <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-sm) var(--space-md)', marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span style={{ fontSize: '1.2rem' }}>🔐</span>
                                            <div>
                                                <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: '#f59e0b' }}>Patient Verification Required</p>
                                                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                    {mfaStatus.totpEnabled ? 'Authenticator code' : 'Email verification'} required before dispensing
                                                    {dispenseMfaToken && ' — ✅ Verified'}
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex justify-end">
                                        <button
                                            className="btn"
                                            style={{ background: 'linear-gradient(135deg, var(--secondary), #db2777)', width: '100%', maxWidth: '300px' }}
                                            onClick={handleDispenseClick}
                                            disabled={loading}
                                        >
                                            {loading ? 'Processing...' : mfaStatus?.mfaRequired && !dispenseMfaToken ? '🔐 Verify Patient & Dispense' : 'Dispense Medicine'}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Safeguard: Non-dispensable status messages */}
                            {chainData.status === 'USED' && (
                                <div style={{ marginTop: 'var(--space-lg)', paddingTop: 'var(--space-lg)', borderTop: '1px solid var(--glass-border)', textAlign: 'center' }}>
                                    <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                                        <span style={{ fontSize: '1.5rem' }}>✅</span>
                                        <p style={{ margin: 0, fontWeight: 600, color: '#ef4444' }}>This prescription has already been dispensed.</p>
                                    </div>
                                </div>
                            )}
                            {chainData.status === 'EXPIRED' && (
                                <div style={{ marginTop: 'var(--space-lg)', paddingTop: 'var(--space-lg)', borderTop: '1px solid var(--glass-border)', textAlign: 'center' }}>
                                    <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                                        <span style={{ fontSize: '1.5rem' }}>⏰</span>
                                        <p style={{ margin: 0, fontWeight: 600, color: '#ef4444' }}>This prescription has expired and cannot be dispensed.</p>
                                    </div>
                                </div>
                            )}
                            {chainData.status === 'DISPENSED' && (
                                <div style={{ marginTop: 'var(--space-lg)', paddingTop: 'var(--space-lg)', borderTop: '1px solid var(--glass-border)', textAlign: 'center' }}>
                                    <div style={{ background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                                        <span style={{ fontSize: '1.5rem' }}>✅</span>
                                        <p style={{ margin: 0, fontWeight: 600, color: '#22c55e' }}>Prescription dispensed successfully.</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Invoice View */}
                    {invoiceData && (
                        <div className="card col-span-12 animate-scale-in printable" style={{ border: '1px solid var(--accent)', background: 'var(--card-bg)' }}>
                            <div className="flex justify-between items-end" style={{ borderBottom: '1px dashed var(--text-muted)', paddingBottom: '1rem', marginBottom: '1rem' }}>
                                <div>
                                    <h2 style={{ color: 'var(--accent)' }}>INVOICE</h2>
                                    <p className="text-sm text-muted">BlockRx Pharmacy System</p>
                                </div>
                                <div className="text-right">
                                    <p>Date: {invoiceData.date.toLocaleDateString()}</p>
                                    <p>Prescription: #{invoiceData.blockchainId}</p>
                                    {invoiceData.dispenseId && <p className="text-sm text-muted">{invoiceData.dispenseId}</p>}
                                </div>
                            </div>

                            <table style={{ width: '100%', marginBottom: '1rem' }}>
                                <thead>
                                    <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                                        <th>Item</th>
                                        <th>Qty</th>
                                        <th>Price/Unit</th>
                                        <th>Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {invoiceData.results.map((item, i) => (
                                        <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                            <td style={{ padding: '0.5rem 0' }}>{item.name}</td>
                                            <td>{item.quantity}</td>
                                            <td>${(item.pricePerUnit || 0).toFixed(2)}</td>
                                            <td>${(item.total || 0).toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            <div className="flex justify-between items-center" style={{ marginTop: '1rem', borderTop: '2px solid var(--accent)', paddingTop: '1rem' }}>
                                <h3>TOTAL</h3>
                                <h2 style={{ color: 'var(--accent)' }}>${invoiceData.totalAmount.toFixed(2)}</h2>
                            </div>

                            <div className="text-center" style={{ marginTop: '2rem', display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                {invoiceData.invoicePdfBase64 && (
                                    <button className="btn" style={{ background: 'linear-gradient(135deg, #27ae60, #2ecc71)' }} onClick={downloadInvoicePDF}>📥 Download Invoice PDF</button>
                                )}
                                <button className="btn" onClick={() => window.print()}>🖨️ Print Invoice</button>
                                <button className="btn btn-outline" onClick={() => { setData(null); setChainData(null); setInvoiceData(null); setSearchId(''); }}>Done</button>
                            </div>
                        </div>
                    )}

                    {/* Dispensing Activity */}
                    <div className="card col-span-12" style={{ marginTop: 'var(--space-lg)' }}>
                        <h3>Recent Dispensing Activity</h3>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--glass-border)', textAlign: 'left' }}>
                                        <th>ID</th>
                                        <th>Patient</th>
                                        <th>Medicines</th>
                                        <th>Date</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {activityLog.map((log, i) => (
                                        <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                            <td style={{ padding: '0.8rem 0.5rem', fontFamily: 'monospace' }}>{log.blockchainId}</td>
                                            <td style={{ padding: '0.8rem 0.5rem' }}>{log.patientName}</td>
                                            <td style={{ padding: '0.8rem 0.5rem' }}>{log.medicines.map(m => m.name || m.medicineName || 'Unknown').join(', ')}</td>
                                            <td style={{ padding: '0.8rem 0.5rem' }}>{new Date(log.dispensedAt).toLocaleDateString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            ) : (
                // --- INVENTORY VIEW ---
                <div className="grid-layout">
                    {/* ZKP Phase 3: Inventory Integrity Indicator */}
                    <div className="card col-span-12" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem' }}>
                        <div>
                            <h4 style={{ margin: 0 }}>🔒 Inventory Integrity</h4>
                            <p className="text-sm text-muted" style={{ margin: 0 }}>On-chain Merkle root verification</p>
                        </div>
                        {inventoryIntegrity ? (
                            <span className={`badge ${inventoryIntegrity.valid ? 'badge-success' : 'badge-error'}`}
                                title={inventoryIntegrity.valid ? `Root: ${inventoryIntegrity.currentRoot?.substring(0, 10)}... (${inventoryIntegrity.batchCount} batches)` : 'Inventory state does not match on-chain anchor'}
                                style={{ fontSize: '0.9rem', padding: '0.4rem 0.8rem' }}>
                                {inventoryIntegrity.valid ? '✅ Synced with Blockchain' : '⚠️ Out of Sync'}
                            </span>
                        ) : (
                            <span className="badge" style={{ opacity: 0.5 }}>Checking...</span>
                        )}
                    </div>

                    {/* Add Batch Form */}
                    <div className="card col-span-4">
                        <h3>📦 Add Medicine Batch</h3>
                        <p className="text-muted text-sm">Register incoming stock on Blockchain</p>

                        <div className="flex flex-col gap-sm" style={{ marginTop: '1rem' }}>
                            <input className="input-field" placeholder="Batch ID (e.g. B-001)"
                                value={newItem.batchId} onChange={e => setNewItem({ ...newItem, batchId: e.target.value })} />

                            <input className="input-field" placeholder="Medicine Name"
                                value={newItem.medicineName} onChange={e => setNewItem({ ...newItem, medicineName: e.target.value })} />

                            <input className="input-field" placeholder="Supplier ID"
                                value={newItem.supplierId} onChange={e => setNewItem({ ...newItem, supplierId: e.target.value })} />

                            <div className="flex gap-sm">
                                <input type="number" className="input-field" placeholder="Qty" style={{ width: '80px' }}
                                    value={newItem.quantity} onChange={e => setNewItem({ ...newItem, quantity: e.target.value })} />
                                <input type="number" className="input-field" placeholder="Price ($)" style={{ width: '80px' }}
                                    value={newItem.price} onChange={e => setNewItem({ ...newItem, price: e.target.value })} />
                                <input type="date" className="input-field"
                                    value={newItem.expiryDate} onChange={e => setNewItem({ ...newItem, expiryDate: e.target.value })} />
                            </div>

                            <button className="btn" onClick={handleRegisterBatch} disabled={loading} style={{ background: 'var(--secondary)' }}>
                                {loading ? 'Processing...' : 'Register Batch'}
                            </button>
                        </div>
                        {status && <p className="text-sm" style={{ marginTop: '0.5rem', color: 'var(--accent)' }}>{status}</p>}
                    </div>

                    {/* Stock Table */}
                    <div className="card col-span-8">
                        <div className="flex justify-between items-center">
                            <h3>Current Stock</h3>
                            <button className="btn-outline text-sm" onClick={fetchInventory}>Refresh</button>
                        </div>

                        <div style={{ overflowX: 'auto', maxHeight: '500px', overflowY: 'auto', marginTop: '1rem' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead style={{ position: 'sticky', top: 0, background: 'var(--card-bg)', zIndex: 1 }}>
                                    <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--glass-border)' }}>
                                        <th style={{ padding: '0.5rem' }}>Batch</th>
                                        <th style={{ padding: '0.5rem' }}>Medicine</th>
                                        <th style={{ padding: '0.5rem' }}>Qty</th>
                                        <th style={{ padding: '0.5rem' }}>Expiry</th>
                                        <th style={{ padding: '0.5rem' }}>Status</th>
                                        <th style={{ padding: '0.5rem' }}>Price</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {inventory.map((item, i) => {
                                        const isExpiring = new Date(item.expiryDate) < new Date(Date.now() + 7 * 86400000);
                                        const isExpired = new Date(item.expiryDate) < new Date();
                                        return (
                                            <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                                <td style={{ padding: '0.8rem 0.5rem', fontFamily: 'monospace' }}>{item.batchId}</td>
                                                <td style={{ padding: '0.8rem 0.5rem', fontWeight: 'bold' }}>{item.medicineName}</td>
                                                <td style={{ padding: '0.8rem 0.5rem' }}>{item.quantityAvailable} <span className="text-muted">/ {item.quantityInitial}</span></td>
                                                <td style={{ padding: '0.8rem 0.5rem', color: isExpired ? 'var(--error)' : isExpiring ? 'var(--warning)' : 'inherit' }}>
                                                    {new Date(item.expiryDate).toLocaleDateString()}
                                                    {isExpiring && !isExpired && " ⚠️"}
                                                </td>
                                                <td style={{ padding: '0.8rem 0.5rem' }}>
                                                    <span className={`badge ${item.status === 'ACTIVE' ? 'badge-success' : 'badge-error'}`} style={{ fontSize: '0.7rem' }}>
                                                        {item.status}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '0.8rem 0.5rem' }}>${item.pricePerUnit}</td>
                                            </tr>
                                        );
                                    })}
                                    {inventory.length === 0 && (
                                        <tr>
                                            <td colSpan="6" style={{ textAlign: 'center', padding: '2rem' }}>No stock found. Not rich enough?</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* Patient Verification Modal */}
            {showMfaModal && (
                <div className="mfa-modal-overlay" onClick={() => setShowMfaModal(false)}>
                    <div className="mfa-modal" onClick={e => e.stopPropagation()}>
                        <div className="mfa-modal-header">
                            <h3 style={{ margin: 0 }}>🔐 Patient Verification Required</h3>
                            <button className="mfa-modal-close" onClick={() => setShowMfaModal(false)}>✕</button>
                        </div>

                        {mfaStatus?.patientName && (
                            <p style={{ textAlign: 'center', color: 'var(--text-muted)', margin: '0 0 1rem' }}>
                                Verifying: <strong style={{ color: 'var(--text-main)' }}>{mfaStatus.patientName}</strong>
                            </p>
                        )}

                        {mfaStep === 'success' && (
                            <div className="mfa-success-block">
                                <span style={{ fontSize: '3rem' }}>✅</span>
                                <p style={{ fontSize: '1.1rem', fontWeight: 600 }}>{mfaSuccess}</p>
                                <p className="text-muted text-sm">Proceeding to dispense...</p>
                            </div>
                        )}

                        {mfaStep === 'blocked' && (
                            <div className="mfa-blocked-block">
                                <span style={{ fontSize: '3rem' }}>🔒</span>
                                <p style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--error)' }}>Verification Locked</p>
                                <p className="text-muted text-sm">Too many failed attempts. Please wait 30 minutes.</p>
                                <button className="btn btn-outline" onClick={() => setShowMfaModal(false)}>Close</button>
                            </div>
                        )}

                        {mfaStep === 'totp' && (
                            <div className="mfa-step-content">
                                <div className="mfa-step-badge">Step 1: Authenticator Code</div>
                                <p className="text-sm text-muted" style={{ textAlign: 'center' }}>
                                    Ask the patient for their Google Authenticator code
                                </p>
                                <input
                                    className="input-field mfa-code-input"
                                    type="text"
                                    maxLength={6}
                                    placeholder="000000"
                                    value={mfaCode}
                                    onChange={e => setMfaCode(e.target.value.replace(/\D/g, ''))}
                                    onKeyDown={e => e.key === 'Enter' && handleVerifyTotp()}
                                    autoFocus
                                />
                                {mfaError && <p className="mfa-error">{mfaError}</p>}
                                <button
                                    className="btn mfa-verify-btn"
                                    onClick={handleVerifyTotp}
                                    disabled={mfaLoading || mfaCode.length !== 6}
                                >
                                    {mfaLoading ? 'Verifying...' : 'Verify Code'}
                                </button>
                                <div className="mfa-divider">
                                    <span>or</span>
                                </div>
                                <button
                                    className="btn btn-outline mfa-fallback-btn"
                                    onClick={handleSendOtp}
                                    disabled={mfaLoading}
                                >
                                    📧 Send OTP to Patient Email
                                </button>
                            </div>
                        )}

                        {mfaStep === 'otp' && (
                            <div className="mfa-step-content">
                                <div className="mfa-step-badge" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6' }}>
                                    {mfaStatus?.totpEnabled ? 'Fallback: Email Verification' : 'Email Verification'}
                                </div>
                                {!otpSent ? (
                                    <>
                                        <p className="text-sm text-muted" style={{ textAlign: 'center' }}>
                                            Send a verification code to: <strong>{mfaStatus?.maskedEmail || 'patient email'}</strong>
                                        </p>
                                        {mfaError && <p className="mfa-error">{mfaError}</p>}
                                        <button
                                            className="btn mfa-verify-btn"
                                            style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
                                            onClick={handleSendOtp}
                                            disabled={mfaLoading}
                                        >
                                            {mfaLoading ? 'Sending...' : '📧 Send Verification Code'}
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        {mfaSuccess && <p className="mfa-success-text">{mfaSuccess}</p>}
                                        <p className="text-sm text-muted" style={{ textAlign: 'center' }}>
                                            Enter the 6-digit code sent to the patient's email
                                        </p>
                                        <input
                                            className="input-field mfa-code-input"
                                            type="text"
                                            maxLength={6}
                                            placeholder="000000"
                                            value={mfaCode}
                                            onChange={e => setMfaCode(e.target.value.replace(/\D/g, ''))}
                                            onKeyDown={e => e.key === 'Enter' && handleVerifyOtp()}
                                            autoFocus
                                        />
                                        {mfaError && <p className="mfa-error">{mfaError}</p>}
                                        <p className="text-sm text-muted" style={{ textAlign: 'center' }}>
                                            Attempts remaining: {mfaAttemptsRemaining}
                                        </p>
                                        <button
                                            className="btn mfa-verify-btn"
                                            style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
                                            onClick={handleVerifyOtp}
                                            disabled={mfaLoading || mfaCode.length !== 6}
                                        >
                                            {mfaLoading ? 'Verifying...' : 'Verify Code'}
                                        </button>
                                        <button
                                            className="btn btn-outline mfa-fallback-btn"
                                            onClick={handleSendOtp}
                                            disabled={mfaLoading}
                                            style={{ fontSize: '0.8rem' }}
                                        >
                                            Resend Code
                                        </button>
                                    </>
                                )}
                                {mfaStatus?.totpEnabled && (
                                    <button
                                        className="btn btn-outline mfa-fallback-btn"
                                        onClick={() => { setMfaStep('totp'); setMfaCode(''); setMfaError(''); }}
                                        style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}
                                    >
                                        ← Back to Authenticator
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default PharmacyDashboard;
