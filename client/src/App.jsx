import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Navbar from './components/Navbar';

// Pages
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import DoctorDashboard from './pages/DoctorDashboard';
import PharmacyDashboard from './pages/PharmacyDashboard';
import MedicineHistory from './pages/MedicineHistory';
import AdminDashboard from './pages/AdminDashboard';
import PatientPrescriptionView from './pages/PatientPrescriptionView'; // Import Patient View

function App() {
  const [account, setAccount] = useState(null);

  const checkNetwork = async () => {
    if (!window.ethereum) return;
    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    // 0x7A69 is 31337 (Localhost Hardhat default)
    if (chainId !== '0x7a69') {
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x7A69' }],
        });
      } catch (switchError) {
        // This error code means the chain has not been added to MetaMask.
        if (switchError.code === 4902) {
          setupNetwork();
        }
      }
    }
  };

  const connectWallet = async () => {
    if (window.ethereum) {
      try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        setAccount(accounts[0]);
        await checkNetwork();
      } catch (err) { console.error(err); }
    } else {
      alert("Please install MetaMask!");
    }
  };

  const setupNetwork = async () => {
    try {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0x7A69', // 31337
          chainName: 'Localhost 8545',
          nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
          rpcUrls: ['http://127.0.0.1:8545'],
        }]
      });
    } catch (err) {
      console.error("Error adding network: ", err);
    }
  };

  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.on('chainChanged', () => {
        window.location.reload();
      });
      // Auto connect if authorized?
      // window.ethereum.request({ method: 'eth_accounts' }).then(accs => { if(accs.length) setAccount(accs[0]) });
    }
  }, []);

  return (
    <AuthProvider>
      <Router>
        <Navbar account={account} connectWallet={connectWallet} setupNetwork={setupNetwork} />
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<Landing />} />
          <Route path="/signin" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/history" element={<MedicineHistory />} /> {/* Analytics public? or move to admin */}

          {/* Protected Routes */}
          <Route element={<ProtectedRoute allowedRoles={['doctor']} />}>
            <Route path="/doctor/*" element={<DoctorDashboard account={account} />} />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['pharmacy']} />}>
            <Route path="/pharmacy/*" element={<PharmacyDashboard account={account} />} />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
            {/* AdminDashboard was imported. Let's make sure it exists or just use MedicineHistory as placeholder if missing */}
            <Route path="/admin/*" element={<AdminDashboard />} />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['patient']} />}>
            {/* Patient Dashboard - Restricted to Single Prescription View */}
            <Route path="/patient/*" element={<PatientPrescriptionView />} />
          </Route>

        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
