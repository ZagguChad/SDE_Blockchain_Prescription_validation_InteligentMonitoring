import { useState } from 'react';

/**
 * TOTP Setup Component
 * Shows QR code, manual entry key, and backup codes.
 * Handles initial verification to complete setup.
 */
function TotpSetup({ qrCodeDataUrl, manualEntryKey, backupCodes, onVerify, onCancel, loading, error }) {
    const [totpCode, setTotpCode] = useState('');
    const [showManual, setShowManual] = useState(false);
    const [showBackupCodes, setShowBackupCodes] = useState(false);
    const [copiedKey, setCopiedKey] = useState(false);

    const handleCopyKey = () => {
        navigator.clipboard.writeText(manualEntryKey);
        setCopiedKey(true);
        setTimeout(() => setCopiedKey(false), 2000);
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (totpCode.length === 6) {
            onVerify(totpCode);
        }
    };

    return (
        <div className="totp-setup-container">
            <div className="totp-setup-header">
                <div className="totp-icon">📱</div>
                <h3>Set Up Google Authenticator</h3>
                <p className="text-muted">Scan the QR code with your authenticator app</p>
            </div>

            {/* QR Code */}
            <div className="totp-qr-section">
                {qrCodeDataUrl && (
                    <img
                        src={qrCodeDataUrl}
                        alt="Scan this QR code with Google Authenticator"
                        className="totp-qr-image"
                    />
                )}
            </div>

            {/* Manual Entry */}
            <div className="totp-manual-section">
                <button
                    onClick={() => setShowManual(!showManual)}
                    className="btn-link text-sm"
                >
                    {showManual ? 'Hide' : "Can't scan? Enter code manually"}
                </button>
                {showManual && (
                    <div className="totp-manual-key">
                        <code>{manualEntryKey}</code>
                        <button onClick={handleCopyKey} className="btn btn-sm">
                            {copiedKey ? '✓ Copied' : 'Copy'}
                        </button>
                    </div>
                )}
            </div>

            {/* Verification */}
            <form onSubmit={handleSubmit} className="totp-verify-form">
                <label className="label">Enter the 6-digit code from your app:</label>
                <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={totpCode}
                    onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    className="input-field totp-code-input"
                    placeholder="000000"
                    disabled={loading}
                />
                {error && <p className="otp-error">{error}</p>}
                <div className="totp-verify-actions">
                    <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={totpCode.length !== 6 || loading}
                    >
                        {loading ? 'Verifying...' : 'Activate'}
                    </button>
                    <button type="button" onClick={onCancel} className="btn btn-outline" disabled={loading}>
                        Cancel
                    </button>
                </div>
            </form>

            {/* Backup Codes */}
            {backupCodes && backupCodes.length > 0 && (
                <div className="totp-backup-section">
                    <button
                        onClick={() => setShowBackupCodes(!showBackupCodes)}
                        className="btn-link text-sm"
                    >
                        {showBackupCodes ? 'Hide backup codes' : '🔑 View backup recovery codes'}
                    </button>
                    {showBackupCodes && (
                        <div className="totp-backup-codes">
                            <p className="text-sm text-muted" style={{ marginBottom: '10px' }}>
                                <strong>⚠️ Save these codes securely.</strong> Each code can be used once if you lose access to your authenticator.
                            </p>
                            <div className="backup-codes-grid">
                                {backupCodes.map((code, i) => (
                                    <span key={i} className="backup-code">{code}</span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default TotpSetup;
