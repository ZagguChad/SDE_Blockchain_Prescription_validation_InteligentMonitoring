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
import PatientPrescriptionView from './pages/PatientPrescriptionView';
import MfaSettings from './pages/MfaSettings';

function App() {
  const [account, setAccount] = useState(null);
  const [walletError, setWalletError] = useState('');

  // Hardhat local chain ID — always compare lowercase
  const HARDHAT_CHAIN_ID = '0x7a69'; // 31337

  const checkNetwork = async () => {
    if (!window.ethereum) return;
    try {
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      console.log(`🔗 [Wallet] Current chain: ${chainId}`);
      // Normalize both to lowercase for comparison
      if (chainId.toLowerCase() !== HARDHAT_CHAIN_ID) {
        console.log(`🔄 [Wallet] Wrong network, switching to Hardhat (${HARDHAT_CHAIN_ID})...`);
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: HARDHAT_CHAIN_ID }],
          });
          console.log('✅ [Wallet] Network switched successfully');
        } catch (switchError) {
          // 4902 = chain not added to wallet
          if (switchError.code === 4902) {
            console.log('📡 [Wallet] Network not found, adding...');
            await setupNetwork();
          } else {
            console.error('❌ [Wallet] Network switch failed:', switchError);
            setWalletError('Failed to switch network. Please switch to Localhost 8545 manually.');
          }
        }
      }
    } catch (err) {
      console.error('❌ [Wallet] Network check failed:', err);
    }
  };

  const connectWallet = async () => {
    setWalletError('');
    console.log('🔗 [Wallet] Connect button clicked');

    if (!window.ethereum) {
      setWalletError('MetaMask not detected. Please install MetaMask.');
      alert('Please install MetaMask!');
      return;
    }

    try {
      console.log('🔗 [Wallet] Requesting accounts...');
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      console.log(`✅ [Wallet] Connected: ${accounts[0]}`);
      setAccount(accounts[0]);
      await checkNetwork();
    } catch (err) {
      console.error('❌ [Wallet] Connection failed:', err);
      if (err.code === 4001) {
        setWalletError('Connection rejected by user.');
      } else {
        setWalletError(`Connection failed: ${err.message || 'Unknown error'}`);
      }
    }
  };

  const setupNetwork = async () => {
    try {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: HARDHAT_CHAIN_ID,
          chainName: 'Localhost 8545 (Hardhat)',
          nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
          rpcUrls: ['http://127.0.0.1:8545'],
        }]
      });
      console.log('✅ [Wallet] Network added successfully');
    } catch (err) {
      console.error('❌ [Wallet] Error adding network:', err);
      setWalletError('Failed to add Hardhat network to wallet.');
    }
  };

  // Auto-reconnect + event listeners
  useEffect(() => {
    if (!window.ethereum) {
      console.log('⚠️ [Wallet] No ethereum provider detected');
      return;
    }

    // Auto-reconnect: check if already authorized (no popup)
    window.ethereum.request({ method: 'eth_accounts' })
      .then(accounts => {
        if (accounts.length > 0) {
          console.log(`🔄 [Wallet] Auto-reconnected: ${accounts[0]}`);
          setAccount(accounts[0]);
          checkNetwork();
        }
      })
      .catch(err => console.error('⚠️ [Wallet] Auto-reconnect check failed:', err));

    // Listen for account changes (user switches account in MetaMask)
    const handleAccountsChanged = (accounts) => {
      if (accounts.length === 0) {
        console.log('🔌 [Wallet] Disconnected');
        setAccount(null);
        setWalletError('Wallet disconnected.');
      } else {
        console.log(`🔄 [Wallet] Account changed: ${accounts[0]}`);
        setAccount(accounts[0]);
        setWalletError('');
      }
    };

    // Listen for network changes
    const handleChainChanged = (_chainId) => {
      console.log(`🔄 [Wallet] Chain changed to: ${_chainId}`);
      window.location.reload();
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    // Cleanup listeners on unmount
    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener('chainChanged', handleChainChanged);
    };
  }, []);

  return (
    <AuthProvider>
      <Router>
        <Navbar account={account} connectWallet={connectWallet} setupNetwork={setupNetwork} walletError={walletError} />
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
            <Route path="/patient" element={<PatientPrescriptionView />} />
            <Route path="/patient/settings" element={<MfaSettings />} />
          </Route>

        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
