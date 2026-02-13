/**
 * PDF Encryption Utility
 * 
 * Uses muhammara to add password protection to PDFs.
 * This is needed because pdf-lib does NOT support PDF encryption.
 */

const muhammara = require('muhammara');
const streams = require('memory-streams');

/**
 * Encrypt a PDF buffer with password protection
 * @param {Buffer} pdfBuffer - Unencrypted PDF as buffer
 * @param {string} userPassword - Password required to open PDF
 * @param {string} ownerPassword - Password for full permissions (optional)
 * @returns {Buffer} - Encrypted PDF as buffer
 */
const encryptPDF = (pdfBuffer, userPassword, ownerPassword = null) => {
    if (!pdfBuffer || pdfBuffer.length === 0) {
        throw new Error('PDF encryption failed: Empty PDF buffer');
    }

    if (!userPassword) {
        throw new Error('PDF encryption failed: User password is required');
    }

    try {
        // Create input stream from buffer
        const inputStream = new muhammara.PDFRStreamForBuffer(pdfBuffer);

        // Create output stream
        const outputStream = new streams.WritableStream();

        // Encryption options
        const encryptOptions = {
            userPassword: userPassword,
            ownerPassword: ownerPassword || userPassword + '_owner',
            // userProtectionFlag controls permissions:
            // 4 = no print, 8 = no modify, 16 = no copy, 32 = no annotations
            // 0 = all restricted (most secure)
            userProtectionFlag: 0 // Disallow everything except viewing
        };

        // Recrypt (encrypt) the PDF
        muhammara.recrypt(
            inputStream,
            new muhammara.PDFStreamForResponse(outputStream),
            encryptOptions
        );

        const encryptedBuffer = outputStream.toBuffer();

        console.log(`🔐 PDF encrypted successfully (${encryptedBuffer.length} bytes)`);
        return encryptedBuffer;

    } catch (error) {
        console.error('❌ PDF encryption error:', error.message);
        throw new Error(`PDF encryption failed: ${error.message}`);
    }
};

/**
 * Verify if a PDF buffer is encrypted
 * @param {Buffer} pdfBuffer - PDF buffer to check
 * @returns {boolean} - True if encrypted
 */
const isEncrypted = (pdfBuffer) => {
    const content = pdfBuffer.toString('utf8', 0, Math.min(pdfBuffer.length, 5000));
    return content.includes('/Encrypt');
};

module.exports = { encryptPDF, isEncrypted };
