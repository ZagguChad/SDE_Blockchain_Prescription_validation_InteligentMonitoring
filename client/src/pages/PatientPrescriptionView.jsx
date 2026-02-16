import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

function PatientPrescriptionView() {
    const { user, logout } = useAuth();
    const [prescription, setPrescription] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        const fetchPrescription = async () => {
            if (!user || user.role !== 'patient' || !user.prescriptionId) {
                setError('Invalid Patient Access');
                setLoading(false);
                return;
            }

            try {
                // Fetch prescription using the new patient-specific endpoint
                const res = await axios.get(`http://localhost:5000/api/patient/prescription/${user.prescriptionId}`);
                if (res.data.success) {
                    setPrescription(res.data.data);
                } else {
                    setError('Prescription not found');
                }
            } catch (err) {
                console.error(err);
                if (err.response?.status === 403) {
                    setError('This prescription has been dispensed or is no longer accessible.');
                } else {
                    setError('Failed to load prescription details.');
                }
            } finally {
                setLoading(false);
            }
        };

        fetchPrescription();
    }, [user]);

    if (loading) return <div className="page-container text-center">Loading Prescription...</div>;
    if (error) return <div className="page-container text-center text-error"><p>{error}</p><button className="btn" onClick={logout}>Logout</button></div>;
    if (!prescription) return null;

    return (
        <div className="page-container">
            <div className="header-row">
                <h2>My Prescription</h2>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => navigate('/patient/settings')} className="btn btn-outline">🔐 Security</button>
                    <button onClick={logout} className="btn btn-outline-danger">Exit / Logout</button>
                </div>
            </div>

            <div className="card animate-scale-in">
                <div className="grid-2">
                    <div>
                        <p><strong>Status:</strong> <span className={`badge badge-${prescription.status.toLowerCase()}`}>{prescription.status}</span></p>
                        <p><strong>Diagnosis:</strong> {prescription.diagnosis}</p>
                        <p><strong>Doctor Address:</strong> <span className="text-muted text-sm">{prescription.doctorAddress}</span></p>
                    </div>
                    <div>
                        <p><strong>Patient Name:</strong> {prescription.patientName}</p>
                        <p><strong>Age:</strong> {prescription.patientAge}</p>
                        <p><strong>Date:</strong> {new Date(prescription.issuedAt).toLocaleDateString()}</p>
                    </div>
                </div>

                <h3 style={{ marginTop: 'var(--space-lg)', borderBottom: '1px solid var(--border-color)', paddingBottom: 'var(--space-xs)' }}>Medicines</h3>
                <div className="table-container" style={{ marginTop: 'var(--space-md)' }}>
                    <table>
                        <thead>
                            <tr>
                                <th>Medicine</th>
                                <th>Dosage</th>
                                <th>Quantity</th>
                                <th>Instructions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {prescription.medicines.map((med, index) => (
                                <tr key={index}>
                                    <td>{med.name}</td>
                                    <td>{med.dosage}</td>
                                    <td>{med.quantity}</td>
                                    <td>{med.instructions}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {prescription.notes && (
                    <div style={{ marginTop: 'var(--space-lg)', background: 'var(--background-color)', padding: 'var(--space-md)', borderRadius: 'var(--radius-md)' }}>
                        <strong>Doctor's Notes:</strong>
                        <p style={{ marginTop: '5px' }}>{prescription.notes}</p>
                    </div>
                )}
            </div>

            {/* Authenticator Status */}
            <div className="card" style={{ marginTop: 'var(--space-md)', border: prescription.totpEnabled ? '1px solid #22c55e' : '1px solid #f59e0b' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                        <span style={{ fontSize: '1.5rem' }}>{prescription.totpEnabled ? '✅' : '⚠️'}</span>
                        <div>
                            <p style={{ margin: 0, fontWeight: 600 }}>
                                {prescription.totpEnabled ? 'Authenticator Active' : 'Set Up Authenticator'}
                            </p>
                            <p className="text-sm text-muted" style={{ margin: 0 }}>
                                {prescription.totpEnabled
                                    ? 'Your Google Authenticator is set up for pharmacy verification.'
                                    : 'Set up Google Authenticator for secure pharmacy verification.'}
                            </p>
                        </div>
                    </div>
                    <button onClick={() => navigate('/patient/settings')} className="btn btn-sm btn-outline">
                        {prescription.totpEnabled ? '⚙️ Manage' : '📱 Set Up'}
                    </button>
                </div>
            </div>

            <div className="text-center" style={{ marginTop: 'var(--space-xl)' }}>
                <p className="text-muted">Take this screen to the Pharmacy to dispense your medicine.</p>
                <div style={{ marginTop: '10px', fontSize: '2rem', letterSpacing: '2px', fontWeight: 'bold' }}>
                    ID: {prescription.blockchainId}
                </div>
            </div>
        </div>
    );
}

export default PatientPrescriptionView;
