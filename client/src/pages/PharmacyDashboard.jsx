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

    useEffect(() => {
        if (activeTab === 'dispense') fetchActivity();
        if (activeTab === 'inventory') fetchInventory();
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

    const handleSearch = async () => {
        if (!searchId) return;
        setLoading(true);
        setStatus('Fetching details...');
        setData(null);
        setChainData(null);

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
                // verifyPrescription returns (bool exists, uint8 status, uint256 remaining)
                const exists = result[0];
                const onChainStatus = Number(result[1]);
                const remaining = Number(result[2]);

                if (!exists) {
                    // Blockchain record not found — check DB sync flag
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

    const dispense = async () => {
        if (!account) return alert('Connect Wallet!');
        setLoading(true);
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

            const formattedId = ethers.encodeBytes32String(searchId);

            // 1. Basic sanity check — backend performs authoritative validation
            if (!data.medicines || data.medicines.length === 0) {
                throw new Error('Invalid prescription: No medicines found. Prescription data may be corrupted.');
            }

            // 2. Pre-Check Validation (Backend Authoritative — stock check without deduction)
            try {
                const validateRes = await axios.post('http://localhost:5000/api/prescriptions/validate-dispense', {
                    blockchainId: data.blockchainId
                });

                if (!validateRes.data.success) {
                    throw new Error(validateRes.data.message || "Validation failed");
                }
                console.log("✅ Backend Validation Passed");
            } catch (validationErr) {
                console.error("Validation Error:", validationErr);
                const serverMsg = validationErr.response?.data?.message || validationErr.message;
                throw new Error(`Cannot Dispense: ${serverMsg}`);
            }

            // 3. Dispense on Blockchain
            const tx = await contract.dispensePrescription(formattedId);
            setStatus('Dispensing transaction sent...');
            await tx.wait();

            setStatus('Dispensed on-chain! Updating inventory & generating invoice...');
            setChainData(prev => ({ ...prev, status: 'DISPENSED' }));

            // 4. Complete Dispense — SINGLE server call handles:
            //    Stock deduction + Invoice computation + PDF generation + Email
            //    (No separate /consume call — fixes double-deduction bug)
            try {
                const dispenseRes = await axios.post('http://localhost:5000/api/prescriptions/complete-dispense', {
                    blockchainId: data.blockchainId
                });

                if (dispenseRes.data.success) {
                    setStatus('Dispensed, Stock Updated & Invoice Generated!');

                    // Render Invoice Data from server response (not client-computed)
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
                console.error("Complete Dispense Error:", finalErr);
                const serverMsg = finalErr.response?.data?.message || finalErr.message;
                setStatus(`Dispensed on-chain, but server error: ${serverMsg}`);
            }

            fetchActivity();

        } catch (error) {
            console.error(error);
            let msg = error.reason || error.message;
            if (msg.includes("Not a pharmacy")) msg = "Access Denied: You are not a registered Pharmacy.";
            if (msg.includes("Prescription expired")) msg = "Cannot dispense: Prescription has EXPIRED.";
            setStatus('Error: ' + msg);
        }
        setLoading(false);
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
                                <div className="flex justify-end" style={{ marginTop: 'var(--space-lg)', paddingTop: 'var(--space-lg)', borderTop: '1px solid var(--glass-border)' }}>
                                    <button
                                        className="btn"
                                        style={{ background: 'linear-gradient(135deg, var(--secondary), #db2777)', width: '100%', maxWidth: '300px' }}
                                        onClick={dispense}
                                    >
                                        Dispense Medicine
                                    </button>
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
        </div>
    );
};

export default PharmacyDashboard;
