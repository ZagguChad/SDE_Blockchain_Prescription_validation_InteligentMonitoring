/**
 * Patient Cryptographic Identity Module
 * 
 * Phase 5: Private key NEVER touches the server.
 * Keypair is generated client-side (DoctorDashboard).
 * Server only stores patient address + commitment hash.
 * 
 * This module provides:
 * - Commitment creation: keccak256(address || DOB)
 * - Signature verification with address recovery
 * - Challenge message construction with replay protection
 */

const { ethers } = require('ethers');


/**
 * Create a patient commitment hash.
 * commitment = keccak256(abi.encodePacked(publicKey, dobString))
 * 
 * This commitment is stored on-chain and in the DB.
 * Only someone who knows the public key AND DOB can reproduce it.
 * 
 * @param {string} publicKey - 0x-prefixed hex public key
 * @param {string|Date} dob - Patient date of birth
 * @returns {string} - 0x-prefixed bytes32 commitment hash
 */
function createPatientCommitment(publicKey, dob) {
    // Normalize DOB to DDMMYYYY string for deterministic hashing
    const dobDate = new Date(dob);
    const dd = String(dobDate.getDate()).padStart(2, '0');
    const mm = String(dobDate.getMonth() + 1).padStart(2, '0');
    const yyyy = String(dobDate.getFullYear());
    const dobString = `${dd}${mm}${yyyy}`;

    // Pack and hash: keccak256(publicKey || dobString)
    return ethers.keccak256(
        ethers.solidityPacked(
            ['bytes', 'string'],
            [publicKey, dobString]
        )
    );
}

/**
 * Create a challenge message for patient signature authentication.
 * The message includes the prescription ID and a timestamp for replay protection.
 * 
 * @param {string} prescriptionId - Prescription blockchain ID
 * @param {number} timestamp - Unix timestamp (seconds)
 * @returns {string} - Challenge message string
 */
function createChallengeMessage(prescriptionId, timestamp) {
    return `BlockRx-Auth:${prescriptionId}:${timestamp}`;
}

/**
 * Verify a patient's ECDSA signature and recover their public key.
 * 
 * @param {string} message - The original challenge message
 * @param {string} signature - 0x-prefixed hex signature (65 bytes)
 * @returns {{ valid: boolean, recoveredAddress: string|null, error?: string }}
 */
function verifyPatientSignature(message, signature) {
    try {
        // Recover the address that signed this message
        // ethers.verifyMessage uses EIP-191 personal_sign prefix
        const recoveredAddress = ethers.verifyMessage(message, signature);

        return {
            valid: true,
            recoveredAddress
        };
    } catch (err) {
        return {
            valid: false,
            recoveredAddress: null,
            error: err.message
        };
    }
}

/**
 * Verify that a recovered address matches the stored patient commitment.
 * 
 * Recomputes: expectedCommitment = keccak256(recoveredPubKey || DOB)
 * But since we can only recover ADDRESS from ECDSA (not full pubKey),
 * we use a simpler commitment: keccak256(address || DOB)
 * 
 * This is adjusted from the plan — using address instead of full pubKey
 * because ethers.verifyMessage only recovers address, not public key.
 * Security is equivalent: address = keccak256(pubKey)[12:]
 * 
 * @param {string} recoveredAddress - Address recovered from signature
 * @param {string|Date} dob - Patient date of birth
 * @param {string} storedCommitment - Previously stored commitment hash
 * @returns {boolean}
 */
function verifyCommitmentMatch(recoveredAddress, dob, storedCommitment) {
    // Recompute the commitment with the recovered address
    const dobDate = new Date(dob);
    const dd = String(dobDate.getDate()).padStart(2, '0');
    const mm = String(dobDate.getMonth() + 1).padStart(2, '0');
    const yyyy = String(dobDate.getFullYear());
    const dobString = `${dd}${mm}${yyyy}`;

    const recomputed = ethers.keccak256(
        ethers.solidityPacked(
            ['address', 'string'],
            [recoveredAddress, dobString]
        )
    );

    return recomputed === storedCommitment;
}

/**
 * Create a commitment using patient address (not full pubKey).
 * This is the actual commitment stored on-chain and in DB.
 * 
 * commitment = keccak256(abi.encodePacked(patientAddress, dobString))
 * 
 * @param {string} address - 0x-prefixed patient address
 * @param {string|Date} dob - Patient date of birth
 * @returns {string} - 0x-prefixed bytes32 commitment hash
 */
function createAddressCommitment(address, dob) {
    const dobDate = new Date(dob);
    const dd = String(dobDate.getDate()).padStart(2, '0');
    const mm = String(dobDate.getMonth() + 1).padStart(2, '0');
    const yyyy = String(dobDate.getFullYear());
    const dobString = `${dd}${mm}${yyyy}`;

    return ethers.keccak256(
        ethers.solidityPacked(
            ['address', 'string'],
            [address, dobString]
        )
    );
}

// Replay protection window (seconds)
const CHALLENGE_WINDOW_SECONDS = 300; // 5 minutes

/**
 * Validate that a challenge timestamp is within the replay protection window.
 * 
 * @param {number} challengeTimestamp - Timestamp from the challenge (seconds)
 * @returns {{ valid: boolean, error?: string }}
 */
function validateChallengeTimestamp(challengeTimestamp) {
    const now = Math.floor(Date.now() / 1000);
    const diff = Math.abs(now - challengeTimestamp);

    if (diff > CHALLENGE_WINDOW_SECONDS) {
        return {
            valid: false,
            error: `Challenge expired. Window: ${CHALLENGE_WINDOW_SECONDS}s, Actual: ${diff}s`
        };
    }

    return { valid: true };
}

module.exports = {
    createPatientCommitment,
    createAddressCommitment,
    createChallengeMessage,
    verifyPatientSignature,
    verifyCommitmentMatch,
    validateChallengeTimestamp,
    CHALLENGE_WINDOW_SECONDS
};
