import { createContext, useState, useEffect, useContext } from 'react';
import axios from 'axios';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadUser = async () => {
            const token = localStorage.getItem('token');
            if (token) {
                try {
                    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
                    const res = await axios.get('http://localhost:5000/api/auth/me');
                    setUser(res.data);
                } catch (error) {
                    console.error("Auth Load Error:", error);
                    localStorage.removeItem('token');
                    delete axios.defaults.headers.common['Authorization'];
                    setUser(null);
                }
            }
            setLoading(false);
        };

        loadUser();
    }, []);

    const login = async (email, password) => {
        // MODE 1: ZKP Signature-Based Patient Login
        // If the "email" field starts with "0x", it's a patient private key
        const isZKPLogin = email.startsWith('0x') && email.length === 66;

        if (isZKPLogin) {
            // Import ethers dynamically for signing
            const { ethers } = await import('ethers');
            const wallet = new ethers.Wallet(email); // "email" field contains private key
            const prescriptionId = password;          // "password" field contains prescription ID
            const timestamp = Math.floor(Date.now() / 1000);
            const challengeMessage = `BlockRx-Auth:${prescriptionId}:${timestamp}`;

            // Sign the challenge with patient's private key
            const signature = await wallet.signMessage(challengeMessage);

            const res = await axios.post('http://localhost:5000/api/patient/access', {
                signature,
                prescriptionId,
                timestamp
            });

            localStorage.setItem('token', res.data.token);
            axios.defaults.headers.common['Authorization'] = `Bearer ${res.data.token}`;

            const patientUser = {
                role: 'patient',
                prescriptionId: res.data.prescriptionId,
                name: 'Patient',
                authMethod: 'zkp-signature'
            };

            setUser(patientUser);
            return patientUser;
        }

        // MODE 2: Legacy Patient Login (username, no @ sign)
        const isPatientLogin = !email.includes('@');

        if (isPatientLogin) {
            const res = await axios.post('http://localhost:5000/api/patient/access', {
                patientUsername: email,
                prescriptionId: password
            });

            localStorage.setItem('token', res.data.token);
            axios.defaults.headers.common['Authorization'] = `Bearer ${res.data.token}`;

            const patientUser = {
                role: 'patient',
                prescriptionId: res.data.prescriptionId,
                name: 'Patient',
                authMethod: 'legacy-username'
            };

            setUser(patientUser);
            return patientUser;
        } else {
            // MODE 3: Standard user login (doctor, pharmacy, admin)
            const res = await axios.post('http://localhost:5000/api/auth/login', { email, password });
            localStorage.setItem('token', res.data.token);
            axios.defaults.headers.common['Authorization'] = `Bearer ${res.data.token}`;
            setUser(res.data.user);
            return res.data.user;
        }
    };

    const signup = async (name, email, password, role) => {
        const res = await axios.post('http://localhost:5000/api/auth/signup', { name, email, password, role });
        localStorage.setItem('token', res.data.token);
        axios.defaults.headers.common['Authorization'] = `Bearer ${res.data.token}`;
        setUser(res.data.user);
        return res.data.user;
    };

    const logout = () => {
        localStorage.removeItem('token');
        delete axios.defaults.headers.common['Authorization'];
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
            {children}
        </AuthContext.Provider>
    );
};
