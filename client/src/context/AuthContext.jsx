import { createContext, useState, useEffect, useContext } from 'react';
import axios from 'axios';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

const API_BASE = 'http://localhost:5000';

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    // MFA state
    const [mfaPending, setMfaPending] = useState(false);
    const [mfaToken, setMfaToken] = useState(null);
    const [mfaContext, setMfaContext] = useState(null); // { prescriptionId, authMethod, maskedEmail, mfaRequired }

    useEffect(() => {
        // Global 401 interceptor: auto-clear auth on expired/invalid tokens
        const interceptorId = axios.interceptors.response.use(
            (response) => response,
            (error) => {
                if (error.response?.status === 401) {
                    const code = error.response?.data?.code;
                    if (code === 'TOKEN_EXPIRED' || code === 'TOKEN_INVALID') {
                        console.warn(`🔒 Auth interceptor: ${code} — clearing session`);
                        localStorage.removeItem('token');
                        localStorage.removeItem('mfaToken');
                        delete axios.defaults.headers.common['Authorization'];
                        setUser(null);
                        setMfaPending(false);
                        setMfaToken(null);
                        setMfaContext(null);
                    }
                }
                return Promise.reject(error);
            }
        );

        const loadUser = async () => {
            const token = localStorage.getItem('token');
            if (token) {
                try {
                    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
                    const res = await axios.get(`${API_BASE}/api/auth/me`);
                    setUser(res.data);
                } catch (error) {
                    // /api/auth/me failed — recover user from JWT payload
                    try {
                        const decoded = JSON.parse(atob(token.split('.')[1]));

                        // Check token expiry
                        if (decoded.exp && decoded.exp * 1000 < Date.now()) {
                            throw new Error('Token expired');
                        }

                        if (decoded.type === 'patient') {
                            // Patient token (issued by /api/patient/access)
                            setUser({
                                role: 'patient',
                                prescriptionId: decoded.prescriptionId,
                                name: 'Patient',
                                authMethod: decoded.authMethod || 'unknown'
                            });
                        } else if (decoded.role && ['doctor', 'pharmacy', 'admin'].includes(decoded.role)) {
                            // Standard user token (doctor/pharmacy/admin)
                            // Re-attempt /api/auth/me with fresh headers
                            try {
                                axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
                                const retryRes = await axios.get(`${API_BASE}/api/auth/me`);
                                setUser(retryRes.data);
                            } catch {
                                // Fallback: recover from JWT payload directly
                                setUser({
                                    id: decoded.id,
                                    role: decoded.role,
                                    name: 'User'
                                });
                            }
                        } else {
                            throw new Error('Unknown token format');
                        }
                    } catch (decodeErr) {
                        console.error("Auth Load Error — clearing session:", decodeErr.message);
                        localStorage.removeItem('token');
                        delete axios.defaults.headers.common['Authorization'];
                        setUser(null);
                    }
                }
            }
            setLoading(false);
        };

        loadUser();

        // Cleanup interceptor on unmount
        return () => axios.interceptors.response.eject(interceptorId);
    }, []);

    const login = async (email, password) => {
        // Clear any stale MFA tokens from previous sessions
        localStorage.removeItem('mfaToken');
        setMfaToken(null);
        setMfaPending(false);
        setMfaContext(null);

        // Patient Login: username (no @ sign) + prescriptionId
        const isPatientLogin = !email.includes('@');

        if (isPatientLogin) {
            const res = await axios.post(`${API_BASE}/api/patient/access`, {
                patientUsername: email,
                prescriptionId: password
            });

            // Check if MFA is required
            if (res.data.pendingMfa) {
                const tempToken = res.data.token;
                setMfaToken(tempToken);
                setMfaPending(true);
                setMfaContext({
                    prescriptionId: res.data.prescriptionId,
                    authMethod: res.data.authMethod,
                    mfaRequired: res.data.mfaRequired || ['emailOtp']
                });

                // Auto-request OTP
                await requestOtp(tempToken);

                return { role: 'patient', pendingMfa: true };
            }

            localStorage.setItem('token', res.data.token);
            axios.defaults.headers.common['Authorization'] = `Bearer ${res.data.token}`;
            const patientUser = {
                role: 'patient',
                prescriptionId: res.data.prescriptionId,
                name: 'Patient',
                authMethod: 'username'
            };
            setUser(patientUser);
            return patientUser;
        } else {
            // Standard user login (doctor, pharmacy, admin)
            const res = await axios.post(`${API_BASE}/api/auth/login`, { email, password });
            localStorage.setItem('token', res.data.token);
            axios.defaults.headers.common['Authorization'] = `Bearer ${res.data.token}`;
            setUser(res.data.user);
            return res.data.user;
        }
    };

    // Request OTP email
    const requestOtp = async (token) => {
        const t = token || mfaToken;
        const res = await axios.post(`${API_BASE}/api/mfa/request-otp`, {}, {
            headers: { Authorization: `Bearer ${t}` }
        });
        if (res.data.maskedEmail) {
            setMfaContext(prev => ({ ...prev, maskedEmail: res.data.maskedEmail }));
        }
        return res.data;
    };

    // Verify OTP
    const verifyOtp = async (otp) => {
        const res = await axios.post(`${API_BASE}/api/mfa/verify-otp`, { otp }, {
            headers: { Authorization: `Bearer ${mfaToken}` }
        });

        // Check if TOTP is also needed
        if (res.data.pendingTotp) {
            setMfaToken(res.data.token);
            setMfaContext(prev => ({
                ...prev,
                pendingTotp: true,
                mfaRequired: ['totp']
            }));
            return { pendingTotp: true };
        }

        // MFA complete — set full auth
        localStorage.setItem('token', res.data.token);
        axios.defaults.headers.common['Authorization'] = `Bearer ${res.data.token}`;

        const patientUser = {
            role: 'patient',
            prescriptionId: res.data.prescriptionId,
            name: 'Patient',
            authMethod: res.data.authMethod || mfaContext?.authMethod || 'unknown'
        };

        setUser(patientUser);
        setMfaPending(false);
        setMfaToken(null);
        setMfaContext(null);

        return patientUser;
    };

    // Verify TOTP
    const verifyTotp = async (totpCode, backupCode) => {
        const body = backupCode ? { backupCode } : { token: totpCode };
        const res = await axios.post(`${API_BASE}/api/mfa/verify-totp`, body, {
            headers: { Authorization: `Bearer ${mfaToken}` }
        });

        // MFA complete
        localStorage.setItem('token', res.data.token);
        axios.defaults.headers.common['Authorization'] = `Bearer ${res.data.token}`;

        if (res.data.mfaToken) {
            localStorage.setItem('mfaToken', res.data.mfaToken);
        }

        const patientUser = {
            role: 'patient',
            prescriptionId: res.data.prescriptionId,
            name: 'Patient',
            authMethod: res.data.authMethod || mfaContext?.authMethod || 'unknown'
        };

        setUser(patientUser);
        setMfaPending(false);
        setMfaToken(null);
        setMfaContext(null);

        return patientUser;
    };

    // Cancel MFA flow
    const cancelMfa = () => {
        setMfaPending(false);
        setMfaToken(null);
        setMfaContext(null);
    };

    const signup = async (name, email, password, role) => {
        const res = await axios.post(`${API_BASE}/api/auth/signup`, { name, email, password, role });
        localStorage.setItem('token', res.data.token);
        axios.defaults.headers.common['Authorization'] = `Bearer ${res.data.token}`;
        setUser(res.data.user);
        return res.data.user;
    };

    const logout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('mfaToken');
        delete axios.defaults.headers.common['Authorization'];
        setUser(null);
        setMfaPending(false);
        setMfaToken(null);
        setMfaContext(null);
    };

    return (
        <AuthContext.Provider value={{
            user, loading, login, signup, logout,
            // MFA exports
            mfaPending, mfaContext, mfaToken,
            requestOtp, verifyOtp, verifyTotp, cancelMfa
        }}>
            {children}
        </AuthContext.Provider>
    );
};
