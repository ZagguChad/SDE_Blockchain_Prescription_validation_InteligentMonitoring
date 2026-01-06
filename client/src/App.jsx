import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import './App.css';
import DoctorDashboard from './pages/DoctorDashboard';
import PharmacyDashboard from './pages/PharmacyDashboard';
import MedicineHistory from './pages/MedicineHistory';

function Landing() {
  return (
    <div className="container center-text animate-fade" style={{ marginTop: '5rem' }}>
      <h1>Secure Digital Prescriptions</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '1.25rem', maxWidth: '600px', margin: '1rem auto' }}>
        Blockchain-powered authenticity for modern healthcare. Issue and dispense prescriptions with confidence.
      </p>

      <div style={{ display: 'flex', gap: '2rem', justifyContent: 'center', marginTop: '4rem', flexWrap: 'wrap' }}>
        <Link to="/doctor" className="card" style={{ textDecoration: 'none', width: '250px', textAlign: 'left' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>👨‍⚕️</div>
          <h2>Doctor</h2>
          <p style={{ color: 'var(--text-muted)' }}>Issue tamper-proof prescriptions directly to the blockchain.</p>
        </Link>
        <Link to="/pharmacy" className="card" style={{ textDecoration: 'none', width: '250px', textAlign: 'left' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>💊</div>
          <h2>Pharmacy</h2>
          <p style={{ color: 'var(--text-muted)' }}>Verify authenticity and dispense medicine securely.</p>
        </Link>
      </div>
    </div>
  );
}

function Navbar({ account, connectWallet, setupNetwork }) {
  const location = useLocation();

  return (
    <nav style={{
      position: 'sticky', top: 0, zIndex: 50,
      background: 'rgba(15, 23, 42, 0.8)', backdropFilter: 'blur(10px)',
      borderBottom: '1px solid var(--glass-border)',
      padding: '1rem 0'
    }}>
      <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2rem' }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none' }}>
          <img src="/logo.png" alt="BlockRx Logo" style={{ height: '40px' }} />
          <span style={{ fontSize: '1.5rem', fontWeight: '800', background: 'linear-gradient(to right, var(--primary), var(--secondary))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            BlockRx
          </span>
        </Link>

        <div style={{ display: 'flex', gap: '1rem' }}>
          {/* Only show nav links if not on landing */}
          {location.pathname !== '/' && (
            <>
              <Link to="/doctor" className="btn btn-secondary">Doctor</Link>
              <Link to="/pharmacy" className="btn btn-secondary">Pharmacy</Link>
              <Link to="/history" className="btn btn-secondary">History</Link>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: '1rem' }}>
          <button className="btn btn-secondary" onClick={setupNetwork} title="Setup Local Network">
            ⚙️ Setup
          </button>
          <button className="btn" onClick={connectWallet}>
            {account ? `🟢 ${account.slice(0, 6)}...` : 'Connect Wallet'}
          </button>
        </div>
      </div>
    </nav>
  );
}

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
    }
  }, []);

  return (
    <Router>
      <Navbar account={account} connectWallet={connectWallet} setupNetwork={setupNetwork} />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/doctor" element={<DoctorDashboard account={account} />} />
        <Route path="/pharmacy" element={<PharmacyDashboard account={account} />} />
        <Route path="/history" element={<MedicineHistory />} />
      </Routes>
    </Router>
  );
}

export default App;
