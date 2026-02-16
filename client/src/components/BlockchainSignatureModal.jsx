import { useState } from 'react';

/**
 * Blockchain Signature Modal
 * Prompts patient to sign a challenge using their wallet for high-risk operations.
 */
function BlockchainSignatureModal({ challengeMessage, nonce, onSign, onCancel, loading, error }) {
    const [signing, setSigning] = useState(false);

    const handleSign = async () => {
        setSigning(true);
        try {
            if (!window.ethereum) {
                throw new Error('MetaMask not detected. Please install MetaMask.');
            }
            const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
            const account = accounts[0];

            // Sign the challenge message using personal_sign
            const signature = await window.ethereum.request({
                method: 'personal_sign',
                params: [challengeMessage, account]
            });

            onSign(signature, nonce);
        } catch (err) {
            console.error('Signing error:', err);
            // Don't throw, let parent handle via error prop
        } finally {
            setSigning(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal-content blockchain-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <span className="modal-icon">⛓️</span>
                    <h3>Blockchain Verification</h3>
                </div>

                <div className="modal-body">
                    <p>This operation requires blockchain identity verification.</p>
                    <p className="text-sm text-muted">
                        Sign the challenge with your wallet to prove ownership.
                    </p>

                    <div className="challenge-preview">
                        <label className="label text-sm">Challenge Message:</label>
                        <code className="challenge-code">{challengeMessage}</code>
                    </div>

                    {error && <p className="otp-error">{error}</p>}
                </div>

                <div className="modal-actions">
                    <button
                        onClick={handleSign}
                        className="btn btn-primary"
                        disabled={signing || loading}
                    >
                        {signing ? '🔄 Signing...' : '✍️ Sign with Wallet'}
                    </button>
                    <button onClick={onCancel} className="btn btn-outline" disabled={signing}>
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}

export default BlockchainSignatureModal;
