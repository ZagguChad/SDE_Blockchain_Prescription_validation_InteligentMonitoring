# BlockRx - Blockchain-Based Secure Digital Prescription System 🏥💊

BlockRx is a decentralized healthcare application designed to ensure authenticity, security, and traceability in prescription management. It leverages blockchain technology to prevent prescription tampering and fraud while providing a seamless experience for doctors, patients, and pharmacies.

> 🔒 **Security First**: Prescriptions are stored immutably on the blockchain and delivered to patients as **password-protected PDFs**.

![BlockRx Dashboard](client/public/logo.png)

## 🚀 Key Features

### 👨‍⚕️ For Doctors
- **Secure Issuance**: Generate prescriptions that are hashed and stored on the Ethereum blockchain.
- **Smart Form**: Quick entry for medicines, diagnosis, and patient details.
- **Fraud Prevention**: Automatic checks for high-volume issuance and duplicate prescriptions.

### 👤 For Patients
- **Privacy & Access**: Receive prescriptions directly via email as **Encrypted PDFs**.
- **Secure PDF**: Open PDFs only with your unique password (Username + DOB).
- **Transparency**: Verify the authenticity of your prescription on the blockchain.

### 🏥 For Pharmacies
- **Verification**: Scan or input Prescription ID to verify authenticity instantly.
- **Dispensing Logic**: Smart contract checks ensure prescriptions cannot be reused or dispensed twice.
- **Inventory Management**: Real-time stock tracking and integration with dispensing flow.

## 🛠️ Tech Stack

- **Frontend**: React (Vite), TailwindCSS, Ethers.js
- **Backend**: Node.js, Express, MongoDB
- **Blockchain**: Hardhat, Solidity (Smart Contracts)
- **PDF & Security**: `pdf-lib`, `muhammara` (Encryption), `nodemailer`

## 📦 Installation & Setup

### Prerequisites
- Node.js (v16+)
- MongoDB (Running locally or Atlas URI)
- MetaMask Browser Extension

### 1. Clone Repository
```bash
git clone https://github.com/ZagguChad/SDE_Blockchain_Prescription_validation_InteligentMonitoring.git
cd SDE_Blockchain_Prescription_validation_InteligentMonitoring
```

### 2. Install Dependencies
```bash
# Install Blockchain dependencies
cd blockchain
npm install

# Install Server dependencies
cd ../server
npm install

# Install Client dependencies
cd ../client
npm install
```

### 3. Environment Configuration
Create a `.env` file in the `server` directory:

```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/blockchain-prescription

# Email Configuration (for sending PDFs)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Blockchain Config
PRIVATE_KEY=your_private_key_here
RPC_URL=http://127.0.0.1:8545
CONTRACT_ADDRESS=your_contract_address_here
```

### 4. Start the Application

**Step 1: Start Blockchain Node**
```bash
cd blockchain
npx hardhat node
```

**Step 2: Deploy Smart Contract**
```bash
cd blockchain
npx hardhat run scripts/deploy.js --network localhost
# Copy the deployed address to your server .env and client config
```

**Step 3: Start Backend Server**
```bash
cd server
npm run dev
```

**Step 4: Start Frontend**
```bash
cd client
npm run dev
```

## 📖 Usage Guide

1.  **Doctor Login**: Access the dashboard to issue new prescriptions.
2.  **Issue Prescription**: Fill in patient details (Name, Age, Email, Medicines).
    - *Note*: Ensure accurate email for PDF delivery.
3.  **Patient Receives Email**: The patient gets an email with a password-protected PDF.
    - **Password Format**: `USERNAME_DDMMYYYY` (e.g., `JOHN_DOE_1234_01011990`).
4.  **Pharmacy Dispense**: Pharmacy logs in, enters the Prescription ID, and dispenses medicine. The blockchain updates the status to 'DISPENSED'.

## 🔒 Security Measures

- **PDF Encryption**: Uses AES-256 encryption via `muhammara` library.
- **Smart Contracts**: Immutable state management for prescription status (ACTIVE -> DISPENSED).
- **Role-Based Access**: Strict separation of concerns between Doctor and Pharmacy roles.

---

*Built with ❤️ for a safer healthcare ecosystem.*
