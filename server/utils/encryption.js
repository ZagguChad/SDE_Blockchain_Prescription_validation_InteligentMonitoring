const crypto = require('crypto');

// Use a fixed key for development/demo purposes. 
// In production, this should be in an environment variable.
const ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = crypto.createHash('sha256').update(String('MY_SECRET_KEY_12345')).digest('base64').substr(0, 32);
const IV_LENGTH = 16; // For AES, this is always 16

function encrypt(text) {
    if (!text) return text;
    let iv = crypto.randomBytes(IV_LENGTH);
    let cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(String(text)); // Ensure text is string
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
    if (!text) return text;
    try {
        let textParts = text.split(':');
        if (textParts.length !== 2) return text; // Attempt to handle unencrypted legacy data

        let iv = Buffer.from(textParts.shift(), 'hex');
        let encryptedText = Buffer.from(textParts.join(':'), 'hex');
        let decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (e) {
        // Fallback for legacy data or if decryption fails
        return text;
    }
}

module.exports = { encrypt, decrypt };
