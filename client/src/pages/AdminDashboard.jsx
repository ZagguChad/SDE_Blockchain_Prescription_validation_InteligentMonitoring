import { useState, useEffect } from 'react';
import axios from 'axios';

const AdminDashboard = () => {
    const [alerts, setAlerts] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchAlerts();
    }, []);

    const fetchAlerts = async () => {
        try {
            const res = await axios.get('http://localhost:5000/api/prescriptions/admin/alerts');
            if (res.data.success) {
                setAlerts(res.data.data);
            }
        } catch (error) {
            console.error("Error fetching alerts:", error);
        }
        setLoading(false);
    };

    return (
        <div className="page-container animate-fade">
            <h2 className="text-center" style={{ margin: 'var(--space-xl) 0' }}>Admin Dashboard</h2>

            <div className="card">
                <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-lg)' }}>
                    <h3>🚨 Fraud Alerts</h3>
                    <button className="btn btn-sm btn-secondary" onClick={fetchAlerts}>Refresh</button>
                </div>

                {loading ? (
                    <p>Loading alerts...</p>
                ) : alerts.length === 0 ? (
                    <p className="text-muted text-center" style={{ padding: '2rem' }}>No alerts found. System is secure.</p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                        {alerts.map((alert, index) => (
                            <div key={index} style={{
                                padding: '1rem',
                                borderLeft: `4px solid ${alert.severity === 'HIGH' ? 'var(--error)' : alert.severity === 'MEDIUM' ? 'orange' : 'yellow'}`,
                                background: 'rgba(0,0,0,0.1)',
                                borderRadius: '4px'
                            }}>
                                <div className="flex justify-between">
                                    <strong style={{ color: 'var(--text-main)' }}>{alert.type}</strong>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{new Date(alert.timestamp).toLocaleString()}</span>
                                </div>
                                <p style={{ margin: '0.5rem 0 0', color: 'var(--text-secondary)' }}>{alert.description}</p>
                                {alert.doctorAddress && (
                                    <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', fontFamily: 'monospace' }}>Doctor: {alert.doctorAddress}</p>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AdminDashboard;
