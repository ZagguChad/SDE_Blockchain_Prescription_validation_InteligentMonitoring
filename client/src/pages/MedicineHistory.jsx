import { useState, useEffect } from 'react';
import axios from 'axios';

const MedicineHistory = () => {
    const [stats, setStats] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetchStats();
    }, []);

    const fetchStats = async () => {
        try {
            const res = await axios.get('http://localhost:5000/api/analytics/medicines');
            if (res.data.success) {
                setStats(res.data.data);
            }
        } catch (err) {
            setError(err.message);
        }
        setLoading(false);
    };

    if (loading) return <div className="container center-text mt-4">Loading stats...</div>;
    if (error) return <div className="container center-text mt-4 error-text">Error: {error}</div>;

    return (
        <div className="container animate-fade">
            <h2 className="center-text">Medicine Analytics Dashboard</h2>
            <p className="center-text" style={{ color: 'var(--text-muted)' }}>
                Intelligent monitoring of dispensing patterns and anomalies.
            </p>

            <div className="grid-responsive mt-4">
                {stats.length === 0 ? (
                    <p className="center-text">No data available.</p>
                ) : (
                    stats.map((item, index) => (
                        <div key={index} className="card" style={{
                            borderLeft: item.isHighAlert ? '4px solid #ef4444' : '4px solid var(--success)',
                            position: 'relative',
                            overflow: 'hidden'
                        }}>
                            {/* Anomaly Badge */}
                            {item.isHighAlert && (
                                <div style={{
                                    position: 'absolute',
                                    top: 0,
                                    right: 0,
                                    background: '#ef4444',
                                    color: 'white',
                                    padding: '0.25rem 0.75rem',
                                    fontSize: '0.75rem',
                                    borderBottomLeftRadius: '8px'
                                }}>
                                    HIGH USAGE ALERT
                                </div>
                            )}

                            <h3>{item.name}</h3>
                            <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '1rem' }}>
                                <div>
                                    <small style={{ color: 'var(--text-muted)' }}>Total Dispensed</small>
                                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{item.count}</div>
                                </div>
                                <div>
                                    <small style={{ color: 'var(--text-muted)' }}>Total Quantity</small>
                                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{item.totalQuantity}</div>
                                </div>
                            </div>

                            <div className="mt-2">
                                <small style={{ color: 'var(--text-muted)' }}>Common Dosages:</small>
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                                    {item.dosages.map((d, i) => (
                                        <span key={i} style={{
                                            background: 'rgba(255,255,255,0.1)',
                                            padding: '2px 8px',
                                            borderRadius: '4px',
                                            fontSize: '0.85rem'
                                        }}>
                                            {d}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            <div className="mt-2" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                Last Dispensed: {new Date(item.lastDispensed).toLocaleDateString()}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default MedicineHistory;
