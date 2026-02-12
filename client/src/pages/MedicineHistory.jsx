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
        <div className="page-container animate-fade">
            <h2 className="text-center" style={{ margin: 'var(--space-xl) 0' }}>Medicine Analytics Dashboard</h2>
            <p className="text-center text-muted" style={{ marginBottom: 'var(--space-xl)' }}>
                Intelligent monitoring of dispensing patterns and anomalies.
            </p>

            <div className="grid-layout">
                {stats.length === 0 ? (
                    <div className="card col-span-12 text-center">
                        <p className="text-muted">No data available yet.</p>
                    </div>
                ) : (
                    stats.map((item, index) => (
                        <div key={index} className="card col-span-6" style={{
                            borderLeft: item.isHighAlert ? '4px solid #ef4444' : '4px solid var(--success)',
                            position: 'relative',
                            overflow: 'hidden'
                        }}>
                            {/* Anomaly Badge */}
                            {item.isHighAlert && (
                                <div style={{
                                    position: 'absolute', top: 0, right: 0,
                                    background: '#ef4444', color: 'white',
                                    padding: '0.25rem 0.75rem', fontSize: '0.75rem',
                                    borderBottomLeftRadius: '8px', fontWeight: 'bold'
                                }}>
                                    HIGH USAGE
                                </div>
                            )}

                            <h3 style={{ marginBottom: 'var(--space-md)' }}>{item.name}</h3>

                            <div className="flex gap-md" style={{ marginBottom: 'var(--space-md)' }}>
                                <div style={{ background: 'rgba(0,0,0,0.2)', padding: 'var(--space-sm)', borderRadius: '4px', flex: 1 }}>
                                    <small className="text-muted block">Dispensed</small>
                                    <span className="text-xl">{item.count}</span>
                                </div>
                                <div style={{ background: 'rgba(0,0,0,0.2)', padding: 'var(--space-sm)', borderRadius: '4px', flex: 1 }}>
                                    <small className="text-muted block">Total Qty</small>
                                    <span className="text-xl">{item.totalQuantity}</span>
                                </div>
                            </div>

                            <div style={{ marginBottom: 'var(--space-md)' }}>
                                <small className="text-muted block" style={{ marginBottom: 'var(--space-xs)' }}>Common Dosages</small>
                                <div className="flex flex-wrap gap-sm">
                                    {item.dosages.map((d, i) => (
                                        <span key={i} style={{
                                            background: 'rgba(255,255,255,0.05)',
                                            border: '1px solid var(--glass-border)',
                                            padding: '2px 8px', borderRadius: '4px', fontSize: '0.85rem'
                                        }}>
                                            {d}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            <div className="text-sm text-right text-muted" style={{ marginTop: 'auto', paddingTop: 'var(--space-sm)', borderTop: '1px solid var(--glass-border)' }}>
                                Last: {new Date(item.lastDispensed).toLocaleDateString()}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default MedicineHistory;
