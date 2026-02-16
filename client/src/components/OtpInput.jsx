import { useState, useRef, useEffect } from 'react';

/**
 * OTP Input Component
 * 6-digit code input with auto-focus, countdown timer, and resend functionality.
 */
function OtpInput({ onVerify, onResend, maskedEmail, loading, error }) {
    const [digits, setDigits] = useState(['', '', '', '', '', '']);
    const [resendTimer, setResendTimer] = useState(60);
    const inputRefs = useRef([]);

    // Countdown timer for resend
    useEffect(() => {
        if (resendTimer <= 0) return;
        const interval = setInterval(() => {
            setResendTimer(prev => prev - 1);
        }, 1000);
        return () => clearInterval(interval);
    }, [resendTimer]);

    // Auto-focus first input on mount
    useEffect(() => {
        inputRefs.current[0]?.focus();
    }, []);

    const handleChange = (index, value) => {
        // Only allow digits
        const digit = value.replace(/\D/g, '').slice(-1);
        const newDigits = [...digits];
        newDigits[index] = digit;
        setDigits(newDigits);

        // Auto-advance to next input
        if (digit && index < 5) {
            inputRefs.current[index + 1]?.focus();
        }

        // Auto-submit when all digits filled
        if (digit && index === 5) {
            const code = newDigits.join('');
            if (code.length === 6) {
                onVerify(code);
            }
        }
    };

    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !digits[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
    };

    const handlePaste = (e) => {
        e.preventDefault();
        const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
        if (pasted.length > 0) {
            const newDigits = [...digits];
            for (let i = 0; i < pasted.length && i < 6; i++) {
                newDigits[i] = pasted[i];
            }
            setDigits(newDigits);
            if (pasted.length === 6) {
                onVerify(pasted);
            } else {
                inputRefs.current[Math.min(pasted.length, 5)]?.focus();
            }
        }
    };

    const handleResend = () => {
        setResendTimer(60);
        setDigits(['', '', '', '', '', '']);
        onResend();
        inputRefs.current[0]?.focus();
    };

    return (
        <div className="otp-container">
            <div className="otp-icon">🔐</div>
            <h3 className="otp-title">Email Verification</h3>
            <p className="otp-subtitle">
                We sent a 6-digit code to <strong>{maskedEmail}</strong>
            </p>

            <div className="otp-inputs" onPaste={handlePaste}>
                {digits.map((digit, i) => (
                    <input
                        key={i}
                        ref={el => inputRefs.current[i] = el}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={e => handleChange(i, e.target.value)}
                        onKeyDown={e => handleKeyDown(i, e)}
                        className={`otp-digit ${digit ? 'filled' : ''} ${error ? 'error' : ''}`}
                        disabled={loading}
                        autoComplete="one-time-code"
                    />
                ))}
            </div>

            {error && <p className="otp-error">{error}</p>}

            <div className="otp-actions">
                {loading ? (
                    <p className="otp-loading">Verifying...</p>
                ) : (
                    <button
                        onClick={() => onVerify(digits.join(''))}
                        className="btn btn-primary otp-submit"
                        disabled={digits.some(d => !d)}
                    >
                        Verify Code
                    </button>
                )}
            </div>

            <div className="otp-resend">
                {resendTimer > 0 ? (
                    <p className="text-muted text-sm">
                        Resend code in <strong>{resendTimer}s</strong>
                    </p>
                ) : (
                    <button onClick={handleResend} className="btn-link" disabled={loading}>
                        Didn't receive the code? Resend
                    </button>
                )}
            </div>

            <p className="otp-expiry text-muted text-sm">Code expires in 5 minutes</p>
        </div>
    );
}

export default OtpInput;
