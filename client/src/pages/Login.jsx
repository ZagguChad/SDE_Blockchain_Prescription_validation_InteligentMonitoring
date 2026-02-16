import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import OtpInput from '../components/OtpInput';

function Login() {
    const [formData, setFormData] = useState({ email: '', password: '' });
    const [error, setError] = useState('');
    const [step, setStep] = useState('credentials'); // 'credentials' | 'otp' | 'totp'
    const [loading, setLoading] = useState(false);
    const [otpError, setOtpError] = useState('');
    const [totpCode, setTotpCode] = useState('');
    const [useBackupCode, setUseBackupCode] = useState(false);
    const [backupCode, setBackupCode] = useState('');

    const { login, mfaPending, mfaContext, verifyOtp, verifyTotp, requestOtp, cancelMfa } = useAuth();
    const navigate = useNavigate();

    const rolePaths = {
        doctor: '/doctor',
        pharmacy: '/pharmacy',
        patient: '/patient',
        admin: '/admin'
    };

    // Step 1: Credentials
    const handleCredentialSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const result = await login(formData.email, formData.password);

            if (result.pendingMfa) {
                // Move to OTP step
                setStep('otp');
            } else {
                const path = rolePaths[result.role] || '/';
                navigate(path);
            }
        } catch (err) {
            if (!err.response) {
                setError('Network error — cannot reach server. Is the backend running?');
            } else if (err.response.status === 429) {
                setError(err.response.data?.message || 'Too many attempts. Please wait and try again.');
            } else {
                setError(err.response?.data?.message || 'Login failed');
            }
        } finally {
            setLoading(false);
        }
    };

    // Step 2: OTP Verification
    const handleOtpVerify = async (otp) => {
        setOtpError('');
        setLoading(true);
        try {
            const result = await verifyOtp(otp);

            if (result.pendingTotp) {
                setStep('totp');
            } else {
                navigate('/patient');
            }
        } catch (err) {
            if (!err.response) {
                setOtpError('Network error — please check your connection.');
            } else {
                setOtpError(err.response?.data?.message || 'Verification failed');
            }
        } finally {
            setLoading(false);
        }
    };

    // Resend OTP
    const handleResendOtp = async () => {
        setOtpError('');
        try {
            await requestOtp();
        } catch (err) {
            setOtpError(err.response?.data?.message || 'Failed to resend code');
        }
    };

    // Step 3: TOTP Verification
    const handleTotpVerify = async (e) => {
        e.preventDefault();
        setOtpError('');
        setLoading(true);
        try {
            const result = useBackupCode
                ? await verifyTotp(null, backupCode)
                : await verifyTotp(totpCode);

            navigate('/patient');
        } catch (err) {
            setOtpError(err.response?.data?.message || 'Verification failed');
        } finally {
            setLoading(false);
        }
    };

    // Back to credentials
    const handleBack = () => {
        cancelMfa();
        setStep('credentials');
        setError('');
        setOtpError('');
    };

    return (
        <div className="page-container" style={{ marginTop: 'var(--space-2xl)', maxWidth: '440px', margin: 'var(--space-2xl) auto' }}>

            {/* Progress indicator */}
            {step !== 'credentials' && (
                <div className="mfa-progress">
                    <div className={`mfa-step ${step === 'credentials' ? 'active' : 'done'}`}>
                        <span className="step-dot">✓</span>
                        <span className="step-label">Credentials</span>
                    </div>
                    <div className="step-connector done"></div>
                    <div className={`mfa-step ${step === 'otp' ? 'active' : step === 'totp' ? 'done' : ''}`}>
                        <span className="step-dot">{step === 'otp' ? '2' : '✓'}</span>
                        <span className="step-label">Email OTP</span>
                    </div>
                    {mfaContext?.pendingTotp && (
                        <>
                            <div className={`step-connector ${step === 'totp' ? 'active' : ''}`}></div>
                            <div className={`mfa-step ${step === 'totp' ? 'active' : ''}`}>
                                <span className="step-dot">3</span>
                                <span className="step-label">Authenticator</span>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* ===== STEP 1: Credentials ===== */}
            {step === 'credentials' && (
                <>
                    <h2 className="text-center">Sign In</h2>
                    {error && <div className="badge badge-error" style={{ width: '100%', marginBottom: 'var(--space-md)', justifyContent: 'center' }}>{error}</div>}
                    <form onSubmit={handleCredentialSubmit} className="card animate-fade">
                        <div className="input-group">
                            <label className="label">Email / Username</label>
                            <input
                                type="text"
                                required
                                className="input-field"
                                value={formData.email}
                                placeholder="doctor@example.com OR patient-username"
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
                        <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
                            {loading ? 'Signing in...' : 'Login'}
                        </button>
                    </form>
                    <div className="card" style={{ marginTop: 'var(--space-md)', background: 'var(--surface-color)', border: '1px solid var(--border-color)' }}>
                        <p className="text-sm">
                            <strong>Patients:</strong> Enter the <strong>username</strong> from your prescription email/PDF (e.g. john-doe-A1B2C3) and your <strong>Prescription ID</strong> as the password.
                        </p>
                    </div>
                    <p className="text-center text-muted" style={{ marginTop: 'var(--space-md)' }}>
                        Don't have an account? <Link to="/signup" className="text-accent">Sign Up</Link>
                    </p>
                </>
            )}

            {/* ===== STEP 2: Email OTP ===== */}
            {step === 'otp' && (
                <div className="card animate-fade">
                    <OtpInput
                        onVerify={handleOtpVerify}
                        onResend={handleResendOtp}
                        maskedEmail={mfaContext?.maskedEmail || 'your email'}
                        loading={loading}
                        error={otpError}
                    />
                    <div className="text-center" style={{ marginTop: 'var(--space-md)' }}>
                        <button onClick={handleBack} className="btn-link text-sm">
                            ← Back to login
                        </button>
                    </div>
                </div>
            )}

            {/* ===== STEP 3: TOTP ===== */}
            {step === 'totp' && (
                <div className="card animate-fade">
                    <div className="otp-container">
                        <div className="otp-icon">📱</div>
                        <h3 className="otp-title">Authenticator Code</h3>
                        <p className="otp-subtitle">Enter the 6-digit code from Google Authenticator</p>

                        <form onSubmit={handleTotpVerify}>
                            {!useBackupCode ? (
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={6}
                                    value={totpCode}
                                    onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
                                    className="input-field totp-code-input"
                                    placeholder="000000"
                                    disabled={loading}
                                    autoFocus
                                    style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '4px' }}
                                />
                            ) : (
                                <input
                                    type="text"
                                    value={backupCode}
                                    onChange={e => setBackupCode(e.target.value)}
                                    className="input-field"
                                    placeholder="XXXX-XXXX"
                                    disabled={loading}
                                    autoFocus
                                    style={{ textAlign: 'center' }}
                                />
                            )}

                            {otpError && <p className="otp-error">{otpError}</p>}

                            <button
                                type="submit"
                                className="btn btn-primary"
                                style={{ width: '100%', marginTop: 'var(--space-md)' }}
                                disabled={(useBackupCode ? !backupCode : totpCode.length !== 6) || loading}
                            >
                                {loading ? 'Verifying...' : 'Verify'}
                            </button>
                        </form>

                        <div style={{ marginTop: 'var(--space-md)' }}>
                            <button
                                onClick={() => { setUseBackupCode(!useBackupCode); setOtpError(''); }}
                                className="btn-link text-sm"
                            >
                                {useBackupCode ? 'Use authenticator code instead' : 'Use backup code instead'}
                            </button>
                        </div>

                        <div className="text-center" style={{ marginTop: 'var(--space-sm)' }}>
                            <button onClick={handleBack} className="btn-link text-sm">
                                ← Back to login
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Login;
