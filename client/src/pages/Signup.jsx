import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function Signup() {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: '',
        role: 'doctor' // Default
    });
    const [error, setError] = useState('');
    const { signup } = useAuth();
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
            const user = await signup(formData.name, formData.email, formData.password, formData.role);
            const path = rolePaths[user.role] || '/';
            navigate(path);
        } catch (err) {
            setError(err.response?.data?.message || 'Signup failed');
        }
    };

    return (
        <div className="page-container" style={{ marginTop: 'var(--space-2xl)', maxWidth: '400px', margin: 'var(--space-2xl) auto' }}>
            <h2 className="text-center">Sign Up</h2>
            {error && <div className="badge badge-error" style={{ width: '100%', marginBottom: 'var(--space-md)', justifyContent: 'center' }}>{error}</div>}
            <form onSubmit={handleSubmit} className="card animate-fade">
                <div className="input-group">
                    <label className="label">Name</label>
                    <input
                        type="text"
                        required
                        className="input-field"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    />
                </div>
                <div className="input-group">
                    <label className="label">Email</label>
                    <input
                        type="email"
                        required
                        className="input-field"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    />
                </div>
                <div className="input-group">
                    <label className="label">Password</label>
                    <input
                        type="password"
                        required
                        className="input-field"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    />
                </div>
                <div className="input-group">
                    <label className="label">Role</label>
                    <select
                        className="input-field"
                        style={{ cursor: 'pointer' }}
                        value={formData.role}
                        onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    >
                        <option value="doctor">Doctor</option>
                        <option value="pharmacy">Pharmacy</option>
                        {/* Patient Signup Disabled - Prescription Driven Access Only */}
                    </select>
                    <small className="text-muted" style={{ display: 'block', marginTop: '5px' }}>
                        * <strong>Patients:</strong> Do not sign up here. Use your Prescription ID to login directly.
                    </small>
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Sign Up</button>
            </form>
            <p className="text-center text-muted" style={{ marginTop: 'var(--space-md)' }}>
                Already have an account? <Link to="/signin" className="text-accent">Sign In</Link>
            </p>
        </div>
    );
}

export default Signup;
