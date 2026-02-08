import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function Login() {
    const [formData, setFormData] = useState({ email: '', password: '' });
    const [error, setError] = useState('');
    const { login } = useAuth();
    const navigate = useNavigate();

    const rolePaths = {
        doctor: '/doctor',
        pharmacy: '/pharmacy',
        patient: '/patient',
        admin: '/admin'
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        try {
            const user = await login(formData.email, formData.password);
            const path = rolePaths[user.role] || '/';
            navigate(path);
        } catch (err) {
            setError(err.response?.data?.message || 'Login failed');
        }
    };

    return (
        <div className="page-container" style={{ marginTop: 'var(--space-2xl)', maxWidth: '400px', margin: 'var(--space-2xl) auto' }}>
            <h2 className="text-center">Sign In</h2>
            {error && <div className="badge badge-error" style={{ width: '100%', marginBottom: 'var(--space-md)', justifyContent: 'center' }}>{error}</div>}
            <form onSubmit={handleSubmit} className="card animate-fade">
                <div className="input-group">
                    <label className="label">Email / Username</label>
                    <input
                        type="text"
                        required
                        className="input-field"
                        value={formData.email}
                        placeholder="doctor@example.com OR RX-123456"
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    />
                </div>
                <div className="input-group">
                    <label className="label">Password / Prescription ID</label>
                    <input
                        type="password"
                        required
                        className="input-field"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    />
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Login</button>
            </form>
            <div className="card" style={{ marginTop: 'var(--space-md)', background: 'var(--surface-color)', border: '1px solid var(--border-color)' }}>
                <p className="text-sm">
                    <strong>Patients:</strong> Use your <code>RX-ID</code> (e.g. RX-A1B2C3) as Username and <code>Prescription ID</code> as Password.
                </p>
                <p className="text-sm text-muted" style={{ marginTop: '5px' }}>
                    *(These are on your printed prescription)*
                </p>
            </div>
            <p className="text-center text-muted" style={{ marginTop: 'var(--space-md)' }}>
                Don't have an account? <Link to="/signup" className="text-accent">Sign Up</Link>
            </p>
        </div>
    );
}

export default Login;
