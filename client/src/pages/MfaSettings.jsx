import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import TotpSetup from '../components/TotpSetup';
import axios from 'axios';

const API_BASE = 'http://localhost:5000';

function MfaSettings() {
    const { user, logout } = useAuth();
    const [mfaStatus, setMfaStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showTotpSetup, setShowTotpSetup] = useState(false);
    const [totpSetupData, setTotpSetupData] = useState(null);
    const [setupLoading, setSetupLoading] = useState(false);
    const [setupError, setSetupError] = useState('');
    const [disableCode, setDisableCode] = useState('');
    const [showDisable, setShowDisable] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');

    useEffect(() => {
        fetchMfaStatus();
    }, []);

    const fetchMfaStatus = async () => {
        try {
            const res = await axios.get(`${API_BASE}/api/mfa/status`);
            setMfaStatus(res.data.mfaStatus);
        } catch (err) {
            setError('Failed to load MFA settings.');
        } finally {
            setLoading(false);
        }
    };

    const handleEnableTotp = async () => {
        setSetupLoading(true);
        setSetupError('');
        try {
            const res = await axios.post(`${API_BASE}/api/mfa/enable-totp`);
            setTotpSetupData(res.data);
            setShowTotpSetup(true);
        } catch (err) {
            setSetupError(err.response?.data?.message || 'Failed to start TOTP setup.');
        } finally {
            setSetupLoading(false);
        }
    };

    const handleVerifyTotpSetup = async (code) => {
        setSetupLoading(true);
        setSetupError('');
        try {
            await axios.post(`${API_BASE}/api/mfa/verify-totp`, { token: code });
            setShowTotpSetup(false);
            setTotpSetupData(null);
            setSuccessMessage('Google Authenticator activated successfully! 🎉');
            fetchMfaStatus();
            setTimeout(() => setSuccessMessage(''), 5000);
        } catch (err) {
            setSetupError(err.response?.data?.message || 'Invalid code.');
        } finally {
            setSetupLoading(false);
        }
    };

    const handleDisableTotp = async (e) => {
        e.preventDefault();
        setSetupLoading(true);
        setSetupError('');
        try {
            await axios.post(`${API_BASE}/api/mfa/disable-totp`, { token: disableCode });
            setShowDisable(false);
            setDisableCode('');
            setSuccessMessage('Google Authenticator has been disabled.');
            fetchMfaStatus();
            setTimeout(() => setSuccessMessage(''), 5000);
        } catch (err) {
            setSetupError(err.response?.data?.message || 'Invalid code.');
        } finally {
            setSetupLoading(false);
        }
    };

    if (loading) return <div className="page-container text-center">Loading security settings...</div>;
    if (error) return <div className="page-container text-center text-error">{error}</div>;

    return (
        <div className="page-container" style={{ maxWidth: '600px', margin: '0 auto' }}>
            <div className="header-row">
                <h2>🔐 Security Settings</h2>
                <button onClick={() => window.history.back()} className="btn btn-outline">← Back</button>
            </div>

            {successMessage && (
                <div className="badge badge-success" style={{ width: '100%', marginBottom: 'var(--space-md)', justifyContent: 'center' }}>
                    {successMessage}
                </div>
            )}

            {/* Current MFA Level */}
            <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
                <h3 style={{ marginBottom: 'var(--space-sm)' }}>Security Level</h3>
                <div className="mfa-level-indicator">
                    <div className={`level-bar level-${mfaStatus?.mfaLevel || 'low'}`}>
                        <span className="level-text">{(mfaStatus?.mfaLevel || 'low').toUpperCase()}</span>
                    </div>
                    <p className="text-sm text-muted" style={{ marginTop: '8px' }}>
                        {mfaStatus?.mfaLevel === 'high' && 'Maximum protection: Email OTP + Authenticator + Blockchain'}
                        {mfaStatus?.mfaLevel === 'medium' && 'Enhanced protection: Email OTP + Authenticator'}
                        {(!mfaStatus?.mfaLevel || mfaStatus?.mfaLevel === 'low') && 'Standard protection: Email OTP verification'}
                    </p>
                </div>
            </div>

            {/* Email OTP - Always enabled */}
            <div className="card mfa-setting-card" style={{ marginBottom: 'var(--space-md)' }}>
                <div className="mfa-setting-row">
                    <div>
                        <h4>📧 Email OTP</h4>
                        <p className="text-sm text-muted">Verification code sent to your email on each login</p>
                    </div>
                    <span className="badge badge-active">Always Active</span>
                </div>
            </div>

            {/* Google Authenticator */}
            <div className="card mfa-setting-card" style={{ marginBottom: 'var(--space-md)' }}>
                <div className="mfa-setting-row">
                    <div>
                        <h4>📱 Google Authenticator</h4>
                        <p className="text-sm text-muted">
                            Time-based codes from your authenticator app
                            {mfaStatus?.totpEnabled && mfaStatus?.backupCodesRemaining > 0 && (
                                <span style={{ display: 'block', marginTop: '4px' }}>
                                    🔑 {mfaStatus.backupCodesRemaining} backup codes remaining
                                </span>
                            )}
                        </p>
                    </div>
                    <div>
                        {mfaStatus?.totpEnabled ? (
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <span className="badge badge-active">Active</span>
                                <button
                                    onClick={() => setShowDisable(!showDisable)}
                                    className="btn btn-sm btn-outline-danger"
                                >
                                    Disable
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={handleEnableTotp}
                                className="btn btn-sm btn-primary"
                                disabled={setupLoading}
                            >
                                {setupLoading ? 'Setting up...' : 'Enable'}
                            </button>
                        )}
                    </div>
                </div>

                {/* Disable TOTP form */}
                {showDisable && (
                    <form onSubmit={handleDisableTotp} style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)', borderTop: '1px solid var(--border-color)' }}>
                        <p className="text-sm" style={{ marginBottom: '8px' }}>Enter your current authenticator code to disable:</p>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <input
                                type="text"
                                inputMode="numeric"
                                maxLength={6}
                                value={disableCode}
                                onChange={e => setDisableCode(e.target.value.replace(/\D/g, ''))}
                                className="input-field"
                                placeholder="000000"
                                style={{ flex: 1 }}
                            />
                            <button type="submit" className="btn btn-sm btn-outline-danger" disabled={disableCode.length !== 6 || setupLoading}>
                                Confirm
                            </button>
                        </div>
                        {setupError && <p className="otp-error" style={{ marginTop: '8px' }}>{setupError}</p>}
                    </form>
                )}
            </div>

            {/* Blockchain Identity */}
            <div className="card mfa-setting-card">
                <div className="mfa-setting-row">
                    <div>
                        <h4>⛓️ Blockchain Signature</h4>
                        <p className="text-sm text-muted">Wallet-based verification for high-risk operations</p>
                    </div>
                    <span className={`badge ${mfaStatus?.hasBlockchainIdentity ? 'badge-active' : 'badge-inactive'}`}>
                        {mfaStatus?.hasBlockchainIdentity ? 'Linked' : 'Not Linked'}
                    </span>
                </div>
                {!mfaStatus?.hasBlockchainIdentity && (
                    <p className="text-sm text-muted" style={{ marginTop: '8px' }}>
                        Blockchain identity is linked during prescription creation with a new-style auth key.
                    </p>
                )}
            </div>

            {/* TOTP Setup Modal */}
            {showTotpSetup && totpSetupData && (
                <div className="modal-overlay" onClick={() => setShowTotpSetup(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '450px' }}>
                        <TotpSetup
                            qrCodeDataUrl={totpSetupData.qrCodeDataUrl}
                            manualEntryKey={totpSetupData.manualEntryKey}
                            backupCodes={totpSetupData.backupCodes}
                            onVerify={handleVerifyTotpSetup}
                            onCancel={() => setShowTotpSetup(false)}
                            loading={setupLoading}
                            error={setupError}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

export default MfaSettings;
