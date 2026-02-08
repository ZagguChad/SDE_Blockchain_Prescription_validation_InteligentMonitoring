import { Link } from 'react-router-dom';

function Landing() {
    return (
        <div className="page-container animate-fade" style={{ marginTop: 'var(--space-2xl)', textAlign: 'center' }}>
            <h1>Secure Digital Prescriptions</h1>
            <p className="text-muted" style={{ fontSize: '1.25rem', maxWidth: '600px', margin: 'var(--space-md) auto' }}>
                Blockchain-powered authenticity for modern healthcare. Issue and dispense prescriptions with confidence.
            </p>

            <div className="grid-layout" style={{ maxWidth: '800px', margin: 'var(--space-2xl) auto', justifyContent: 'center' }}>
                {/* We can show roles info or just generic "Get Started" */}
                <Link to="/signin" className="card col-span-12" style={{ textDecoration: 'none', alignItems: 'center', textAlign: 'center', padding: '3rem' }}>
                    <h2 style={{ color: 'var(--primary)', marginBottom: '1rem' }}>Get Started</h2>
                    <span className="btn btn-primary">Sign In / Sign Up</span>
                </Link>

                <div className="card col-span-6" style={{ textDecoration: 'none', alignItems: 'flex-start' }}>
                    <div style={{ fontSize: '3rem', marginBottom: 'var(--space-md)' }}>👨‍⚕️</div>
                    <h2>Doctor</h2>
                    <p className="text-muted">Issue tamper-proof prescriptions directly to the blockchain.</p>
                </div>
                <div className="card col-span-6" style={{ textDecoration: 'none', alignItems: 'flex-start' }}>
                    <div style={{ fontSize: '3rem', marginBottom: 'var(--space-md)' }}>💊</div>
                    <h2>Pharmacy</h2>
                    <p className="text-muted">Verify authenticity and dispense medicine securely.</p>
                </div>
            </div>
        </div>
    );
}

export default Landing;
