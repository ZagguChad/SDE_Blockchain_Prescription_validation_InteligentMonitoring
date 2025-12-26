# Blockchain-Based Secure Digital Prescription System (BlockRx)

A decentralized healthcare application ensuring authenticity and security in prescription management. Now powered by **Gemini AI** for voice-based prescription issuance.

## 🚀 Features
- **Blockchain Security**: Smart Contracts (Solidity) ensure prescriptions cannot be tampered with.
- **Voice-to-Form AI**: Doctors can dictate prescriptions naturally using the integrated **Gemini 1.5 Flash** assistant.
- **Clinical UI**: Modern, glassmorphism-inspired interface designed for medical professionals.
- **Role-Based Access**: Dedicated dashboards for Doctors (issuing) and Pharmacies (dispensing).

## 🛠️ Tech Stack
- **Frontend**: React, Vite, Ethers.js
- **Backend**: Node.js, Express, MongoDB
- **AI/NLP**: Google Gemini API, Web Speech API
- **Blockchain**: Hardhat (Localhost), Solidity

## 📦 Installation

### 1. Prerequisites
- Node.js (v16+)
- Python (v3.8+)
- MetaMask Browser Extension

### 2. Setup Project
```bash
# Clone the repository
git clone https://github.com/ZagguChad/SDE_Blockchain_Prescription_validation_InteligentMonitoring.git
cd SDE_Blockchain_Prescription_validation_InteligentMonitoring

# Install Dependencies
cd blockchain && npm install
cd ../server && npm install
cd ../client && npm install
```

### 3. Configure Environment
**Backend (`server/.env`)**
Create a `.env` file in the `server` folder:
```ini
PORT=5000
MONGO_URI=mongodb://localhost:27017/blockchain-prescription
# Your Google Gemini API Key
GEMINI_API_KEY=YOUR_API_KEY_HERE 
# Local Blockchain Config (Hardhat)
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
RPC_URL=http://127.0.0.1:8545
CONTRACT_ADDRESS=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
```

### 4. Start Services

**Terminal 1: Blockchain**
```bash
cd blockchain
npx hardhat node
```

**Terminal 2: Deploy Contract (If needed)**
*(The address above is pre-configured, but if you restart the node, re-deploy)*
```bash
cd blockchain
npx hardhat run scripts/deploy.js --network localhost
# Copy the new address to server/.env and client dashboards if it changes
```

**Terminal 3: Backend**
```bash
cd server
npm start
```

**Terminal 4: Frontend**
```bash
cd client
npm run dev
```

## 🎮 Usage
1.  Open [http://localhost:5174](http://localhost:5174).
2.  **Doctor**: 
    - Click the Microphone.
    - Speak: *"Patient John, Age 30, Medicine Aspirin, Quantity 10"*.
    - Click **"✨ AI Fill"** to populate the form.
    - Issue Prescription.
3.  **Pharmacy**:
    - Enter the Prescription ID.
    - Verify and Dispense.

## 🦊 MetaMask Setup (Localhost)
If you see "Gas Error":
1.  Import Account in MetaMask using the Private Key: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`.
2.  Network: `Localhost 8545`.
