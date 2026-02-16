import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function Navbar({ account, connectWallet, setupNetwork, walletError }) {
    const location = useLocation();
    const { user, logout } = useAuth();

    return (
        <nav style={{
            position: 'sticky', top: 0, zIndex: 50,
            background: 'rgba(15, 23, 42, 0.95)', backdropFilter: 'blur(10px)',
            borderBottom: '1px solid var(--glass-border)',
            padding: 'var(--space-sm) 0'
        }}>
            <div className="page-container flex justify-between items-center">
                {/* Logo Section */}
                <Link to="/" className="flex items-center gap-sm">
                    {/* Assuming logo.png exists in public folder as per previous implementation */}
                    {/* <img src="/logo.png" alt="BlockRx Logo" style={{ height: '32px' }} /> */}
                    <span style={{ fontSize: '1.25rem', fontWeight: '800', background: 'linear-gradient(to right, var(--primary), var(--secondary))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                        BlockRx
                    </span>
                </Link>

                {/* Desktop Navigation */}
                <div className="flex items-center gap-md">
                    {/* Navigation Links - Role Based */}
                    {user && (
                        <div className="flex gap-sm">
                            {user.role === 'doctor' && <Link to="/doctor" className="btn btn-secondary btn-sm">Doctor</Link>}
                            {user.role === 'pharmacy' && <Link to="/pharmacy" className="btn btn-secondary btn-sm">Pharmacy</Link>}
                            {user.role === 'patient' && <Link to="/patient" className="btn btn-secondary btn-sm">My Prescriptions</Link>}
                            {(user.role === 'admin') && <Link to="/admin" className="btn btn-secondary btn-sm">Admin</Link>}

                            {/* Common Links possibly? History? */}
                            {/* <Link to="/history" className="btn btn-secondary btn-sm">History</Link> */}
                        </div>
                    )}

                    <div className="flex gap-sm items-center">
                        {/* Wallet Connect (Always visible logic, or maybe only if logged in? Usually separate. Let's keep it visible) */}
                        <button className="btn btn-secondary btn-sm" onClick={setupNetwork} title="Setup Local Network">
                            ⚙️
                        </button>
                        <button className="btn btn-sm" onClick={connectWallet} title="Connect MetaMask">
                            {account ? `🟢 ${account.slice(0, 6)}...` : '🔗 Connect Wallet'}
                        </button>

                        {/* Auth Buttons */}
                        {user ? (
                            <div className="flex items-center gap-sm" style={{ marginLeft: 'var(--space-md)', borderLeft: '1px solid var(--glass-border)', paddingLeft: 'var(--space-md)' }}>
                                <div className="text-right" style={{ lineHeight: 1 }}>
                                    <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{user.name}</div>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--accent)', textTransform: 'uppercase' }}>{user.role}</div>
                                </div>
                                <button onClick={logout} className="btn btn-secondary btn-sm" style={{ borderColor: 'var(--error)', color: 'var(--error)' }}>Logout</button>
                            </div>
                        ) : (
                            <div className="flex gap-sm" style={{ marginLeft: 'var(--space-md)' }}>
                                <Link to="/signin" className="btn btn-secondary btn-sm">Login</Link>
                                <Link to="/signup" className="btn btn-primary btn-sm">Signup</Link>
                            </div>
                        )}
                    </div>
                </div>
                {walletError && (
                    <div style={{ position: 'absolute', top: '100%', right: '1rem', background: 'rgba(220, 38, 38, 0.9)', color: 'white', padding: '0.4rem 0.8rem', borderRadius: '0 0 6px 6px', fontSize: '0.75rem', maxWidth: '300px', zIndex: 51 }}>
                        ⚠️ {walletError}
                    </div>
                )}
            </div>
        </nav>
    );
}

export default Navbar;
