@echo off
title BlockRx Launcher
echo ==========================================================
echo   Blockchain-Based Secure Digital Prescription System
echo   Launcher Script
echo ==========================================================

:: Function to check if a directory exists
if not exist "blockchain" (
    echo [ERROR] 'blockchain' directory not found. Please run this script from the project root.
    pause
    exit /b
)

:: 1. Start Local Blockchain
echo.
echo [1/4] Starting Local Hardhat Blockchain Node...
start "BlockRx - Blockchain Node" cmd /k "cd blockchain && npx hardhat node"

:: Wait for node to spin up (10 seconds)
echo       Waiting for blockchain to initialize...
timeout /t 10 /nobreak >nul

:: 2. Deploy Smart Contract
echo.
echo [2/4] Deploying Smart Contract to Localhost...
cd blockchain
call npx hardhat run scripts/deploy.js --network localhost
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Contract deployment failed!
    pause
    exit /b
)
cd ..

:: 3. Start Backend Server
echo.
echo [3/4] Starting Backend Server...
start "BlockRx - Backend API" cmd /k "cd server && npm start"

:: 4. Start Frontend Application
echo.
echo [4/4] Starting Frontend Client...
start "BlockRx - Frontend" cmd /k "cd client && npm run dev"

echo.
echo ==========================================================
echo   All systems go! 
echo   - Blockchain running on port 8545
echo   - Backend running on port 5000
echo   - Frontend launching...
echo ==========================================================
echo.
pause
