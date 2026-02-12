const { generatePatientUsername, normalizeUsername } = require('./utils/username');
const mongoose = require('mongoose');

// Mock User Model for testing
const mockUsers = [];
const User = {
    findOne: async (query) => {
        if (query.username) {
            return mockUsers.find(u => u.username === query.username) || null;
        }
        return null;
    },
    create: async (data) => {
        mockUsers.push(data);
        return data;
    }
};

async function testUsernameGeneration() {
    console.log("--- Testing Username Generation ---");
    const cases = [
        { name: "John Doe", id: "0x123456789", expected: "john-doe-123456" },
        { name: "  Jane   Smith  ", id: "ABCDEF123", expected: "jane-smith-ABCDEF" },
        { name: "Dr. House", id: "555555555", expected: "dr.-house-555555" }
    ];

    cases.forEach(({ name, id, expected }) => {
        const result = generatePatientUsername(name, id);
        if (result === expected) {
            console.log(`✅ Passed: ${name} -> ${result}`);
        } else {
            console.error(`❌ Failed: ${name} -> Expected ${expected}, got ${result}`);
        }
    });
}

async function testLoginNormalization() {
    console.log("\n--- Testing Login Normalization Logic ---");

    // Setup Mock User
    const storedUsername = "john-doe-123456";
    await User.create({ username: storedUsername, name: "John Doe" });

    const loginAttempts = [
        { input: "john-doe-123456", expected: true, desc: "Exact Match" }, // Should Pass
        { input: "John Doe-123456", expected: false, desc: "Space in Input (Strict Mode)" }, // Should Fail in strict mode
        { input: "JOHN-DOE-123456", expected: true, desc: "All Caps (Case Insensitive)" }, // Should Pass (we lowercase)
        { input: "john-doe-123456  ", expected: true, desc: "Trailing Space" }, // Should Pass (we trim)
        { input: "john-doe-999999", expected: false, desc: "Wrong ID" }
    ];

    for (const { input, expected, desc } of loginAttempts) {
        let user = await User.findOne({ username: input });

        if (!user) {
            // Strict Mode: Only try simple normalization (trim + lowercase)
            const normalizedInput = input.trim().toLowerCase();
            if (normalizedInput !== input) {
                user = await User.findOne({ username: normalizedInput });
            }
        }

        const success = !!user;
        if (success === expected) {
            console.log(`✅ Passed: ${desc} ("${input}") -> User Found: ${success}`);
        } else {
            console.error(`❌ Failed: ${desc} ("${input}") -> Expected ${expected}, got ${success}`);
        }
    }
}

async function runTests() {
    await testUsernameGeneration();
    await testLoginNormalization();
}

runTests();
