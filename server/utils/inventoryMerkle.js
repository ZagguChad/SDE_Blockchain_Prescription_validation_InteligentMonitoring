/**
 * Inventory Merkle Root — ZKP Phase 3 + Phase 4 (Root Authority)
 * 
 * ALL snapshot construction delegated to canonicalSnapshot.js.
 * This module ONLY handles Merkle tree math + blockchain I/O.
 * 
 * Phase 4 additions:
 *   - verifyRootOrAbort(): Pre-deduction tamper detection
 *   - anchorInventoryRoot(): Now THROWS on failure (not fire-and-forget)
 *   - logRootDiff(): Forensic logging on mismatch
 * 
 * Tree: binary Merkle with keccak256 sorted pairing.
 * Leaf: deterministicHash(canonicalBatchSnapshot) per ACTIVE batch.
 */

const { ethers } = require('ethers');
const { buildInventorySnapshot, buildBatchSnapshot, deterministicHash } = require('./canonicalSnapshot');

/**
 * Compute a deterministic leaf hash for a single inventory batch.
 * @param {Object} batch — Raw Mongoose lean document
 * @returns {string} bytes32 leaf hash
 */
function computeBatchLeaf(batch) {
    const canonical = buildBatchSnapshot(batch);
    return deterministicHash(canonical);
}

/**
 * Build a binary Merkle tree from leaf hashes and return the root.
 * @param {string[]} leaves — Array of bytes32 leaf hashes
 * @returns {string} bytes32 Merkle root (or ZeroHash if empty)
 */
function buildMerkleRoot(leaves) {
    if (leaves.length === 0) return ethers.ZeroHash;
    if (leaves.length === 1) return leaves[0];

    let level = [...leaves];
    while (level.length > 1) {
        const nextLevel = [];
        for (let i = 0; i < level.length; i += 2) {
            if (i + 1 < level.length) {
                // Sort pair for determinism (smaller hash first)
                const [a, b] = [level[i], level[i + 1]].sort();
                nextLevel.push(ethers.keccak256(ethers.concat([a, b])));
            } else {
                // Odd leaf — promote to next level
                nextLevel.push(level[i]);
            }
        }
        level = nextLevel;
    }
    return level[0];
}

/**
 * Compute the current inventory Merkle root from ACTIVE batches in DB.
 * Uses canonicalSnapshot.buildInventorySnapshot() as single source of truth.
 * @returns {Promise<{root: string, batchCount: number, leaves: string[]}>}
 */
async function computeInventoryRoot() {
    const { snapshot, batchCount } = await buildInventorySnapshot();
    const leaves = snapshot.map(s => deterministicHash(s));
    const root = buildMerkleRoot(leaves);
    return { root, batchCount, leaves };
}

/**
 * Get a contract connection for inventory root operations.
 * @param {boolean} needsSigner — If true, returns a signer-connected contract
 * @returns {{ provider, contract }}
 */
function getInventoryContract(needsSigner = false) {
    const contractInfo = require('../contractInfo.json');
    const provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC || 'http://127.0.0.1:8545');

    if (needsSigner) {
        const deployerKey = process.env.DEPLOYER_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
        const wallet = new ethers.Wallet(deployerKey, provider);
        const contract = new ethers.Contract(contractInfo.address, contractInfo.abi, wallet);
        return { provider, contract };
    }

    const contract = new ethers.Contract(contractInfo.address, contractInfo.abi, provider);
    return { provider, contract };
}

/**
 * Fetch the on-chain inventory root.
 * @returns {Promise<string>} bytes32 on-chain root
 * @throws {Error} If blockchain is unreachable
 */
async function fetchOnChainRoot() {
    const { contract } = getInventoryContract(false);
    return await contract.getInventoryRoot();
}

/**
 * Log a detailed root diff for forensic analysis.
 * @param {string} computedRoot — Root computed from DB
 * @param {string} onChainRoot — Root from blockchain
 * @param {number} batchCount — Number of active batches
 */
function logRootDiff(computedRoot, onChainRoot, batchCount) {
    console.error('🔴 [INVENTORY TAMPER] Root mismatch detected!');
    console.error(`   Computed (DB):  ${computedRoot}`);
    console.error(`   On-chain:       ${onChainRoot}`);
    console.error(`   Active batches: ${batchCount}`);
    console.error(`   Timestamp:      ${new Date().toISOString()}`);
    console.error('   ⚠️ Inventory may have been tampered with outside the application.');
}

/**
 * Phase 4: Pre-deduction tamper detection.
 * Computes current inventory root from DB and compares to on-chain root.
 * THROWS if roots don't match — caller must catch and abort.
 * 
 * @returns {Promise<{root: string, batchCount: number}>} Current root if valid
 * @throws {Error} INVENTORY_TAMPERED if roots mismatch
 * @throws {Error} CHAIN_UNREACHABLE if blockchain unavailable
 */
async function verifyRootOrAbort() {
    const { root, batchCount } = await computeInventoryRoot();

    let onChainRoot;
    try {
        onChainRoot = await fetchOnChainRoot();
    } catch (err) {
        const error = new Error(`Blockchain unreachable — cannot verify inventory integrity: ${err.message}`);
        error.code = 'CHAIN_UNREACHABLE';
        throw error;
    }

    // ZeroHash means no root has been anchored yet — first-time setup, allow
    if (onChainRoot !== ethers.ZeroHash && root !== onChainRoot) {
        logRootDiff(root, onChainRoot, batchCount);
        const error = new Error('Inventory integrity check failed — on-chain root does not match current inventory.');
        error.code = 'INVENTORY_TAMPERED';
        error.details = { computedRoot: root, onChainRoot, batchCount };
        throw error;
    }

    console.log(`✅ [ROOT CHECK] Inventory root verified: ${root.substring(0, 10)}... (${batchCount} batches)`);
    return { root, batchCount };
}

/**
 * Phase 4: Compute and anchor the inventory Merkle root on-chain.
 * THROWS on failure — callers MUST handle and rollback.
 * 
 * @returns {Promise<{root: string, txHash: string}>}
 * @throws {Error} If anchoring fails (RPC error, tx revert, etc.)
 */
async function anchorInventoryRoot() {
    const { root, batchCount } = await computeInventoryRoot();

    const { contract } = getInventoryContract(true);

    const tx = await contract.updateInventoryRoot(root);
    const receipt = await tx.wait();

    console.log(`🌲 Inventory root anchored: ${root.substring(0, 10)}... (${batchCount} ACTIVE batches, tx: ${receipt.hash})`);
    return { root, txHash: receipt.hash };
}

/**
 * Verify current inventory against on-chain root (non-throwing version).
 * Used for read-only audit checks.
 * @returns {Promise<{valid: boolean, currentRoot: string, onChainRoot: string, batchCount: number}>}
 */
async function verifyInventoryRoot() {
    const { root, batchCount } = await computeInventoryRoot();

    try {
        const onChainRoot = await fetchOnChainRoot();
        const valid = root === onChainRoot || onChainRoot === ethers.ZeroHash;

        if (!valid) {
            logRootDiff(root, onChainRoot, batchCount);
        }

        return { valid, currentRoot: root, onChainRoot, batchCount };
    } catch (err) {
        console.warn(`⚠️ Inventory root verification failed: ${err.message}`);
        return { valid: false, currentRoot: root, onChainRoot: null, batchCount, error: err.message };
    }
}

module.exports = {
    computeBatchLeaf,
    buildMerkleRoot,
    computeInventoryRoot,
    anchorInventoryRoot,
    verifyInventoryRoot,
    verifyRootOrAbort,
    fetchOnChainRoot,
    logRootDiff,
};
