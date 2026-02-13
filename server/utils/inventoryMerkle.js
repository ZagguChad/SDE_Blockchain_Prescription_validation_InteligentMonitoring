/**
 * Inventory Merkle Root — ZKP Phase 3 (Stabilized)
 * 
 * ALL snapshot construction delegated to canonicalSnapshot.js.
 * This module ONLY handles Merkle tree math + blockchain I/O.
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
 * Compute and anchor the inventory Merkle root on-chain.
 * MUST be called AFTER DB writes have committed.
 * @returns {Promise<{root: string, txHash: string|null}>}
 */
async function anchorInventoryRoot() {
    const { root, batchCount } = await computeInventoryRoot();

    try {
        const contractInfo = require('../contractInfo.json');
        const provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC || 'http://127.0.0.1:8545');
        const deployerKey = process.env.DEPLOYER_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
        const wallet = new ethers.Wallet(deployerKey, provider);
        const contract = new ethers.Contract(contractInfo.address, contractInfo.abi, wallet);

        const tx = await contract.updateInventoryRoot(root);
        const receipt = await tx.wait();

        console.log(`🌲 Inventory root anchored: ${root.substring(0, 10)}... (${batchCount} ACTIVE batches, tx: ${receipt.hash})`);
        return { root, txHash: receipt.hash };
    } catch (err) {
        console.warn(`⚠️ Inventory root anchoring failed: ${err.message}`);
        return { root, txHash: null };
    }
}

/**
 * Verify current inventory against on-chain root.
 * @returns {Promise<{valid: boolean, currentRoot: string, onChainRoot: string, batchCount: number}>}
 */
async function verifyInventoryRoot() {
    const { root, batchCount } = await computeInventoryRoot();

    try {
        const contractInfo = require('../contractInfo.json');
        const provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC || 'http://127.0.0.1:8545');
        const contract = new ethers.Contract(contractInfo.address, contractInfo.abi, provider);

        const onChainRoot = await contract.getInventoryRoot();
        const valid = root === onChainRoot;

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
    verifyInventoryRoot
};
