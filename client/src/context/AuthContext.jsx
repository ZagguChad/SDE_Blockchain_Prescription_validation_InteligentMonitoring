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
        // Detect if this is a patient login attempt
        // Patient credentials: username format (no @), password is prescription ID
        const isPatientLogin = !email.includes('@');

        if (isPatientLogin) {
            // Patient login via prescription-gated access
            const res = await axios.post('http://localhost:5000/api/patient/access', {
                patientUsername: email, // Input field labeled "email" but contains username for patients
                prescriptionId: password
            });

            localStorage.setItem('token', res.data.token);
            axios.defaults.headers.common['Authorization'] = `Bearer ${res.data.token}`;

            // Create a patient user object for consistency with app routing
            const patientUser = {
                role: 'patient',
                prescriptionId: res.data.prescriptionId,
                name: 'Patient' // Generic name since we don't need it for routing
            };

            setUser(patientUser);
            return patientUser;
        } else {
            // Standard user login (doctor, pharmacy, admin)
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
