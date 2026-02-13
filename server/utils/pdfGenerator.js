/**
 * PDF Generator with Password Protection
 * 
 * Generates password-protected prescription PDFs using pdf-lib
 */

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

/**
 * Generate password-protected prescription PDF
 * @param {Object} prescriptionData - Prescription details
 * @param {string} password - PDF password
 * @returns {Promise<Buffer>} - PDF as buffer
 */
const generateProtectedPDF = async (prescriptionData, password) => {
    const {
        prescriptionId,
        patientName,
        patientAge,
        patientDOB,
        patientUsername,
        medicines,
        notes,
        diagnosis,
        expiryDate,
        doctorAddress,
        patientPrivateKey  // ZKP Phase 1: embedded for self-sovereign auth
    } = prescriptionData;

    // Create a new PDF document
    const pdfDoc = await PDFDocument.create();

    // Embed fonts
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Add a page
    const page = pdfDoc.addPage([595, 842]); // A4 size
    const { width, height } = page.getSize();

    let yPosition = height - 50;

    // Header
    page.drawText('MEDICAL PRESCRIPTION', {
        x: 50,
        y: yPosition,
        size: 24,
        font: helveticaBold,
        color: rgb(0.4, 0.49, 0.92) // Primary blue color
    });

    yPosition -= 10;
    page.drawLine({
        start: { x: 50, y: yPosition },
        end: { x: width - 50, y: yPosition },
        thickness: 2,
        color: rgb(0.4, 0.49, 0.92)
    });

    yPosition -= 30;

    // Prescription ID
    page.drawText(`Prescription ID: ${prescriptionId}`, {
        x: 50,
        y: yPosition,
        size: 12,
        font: helveticaBold,
        color: rgb(0, 0, 0)
    });

    yPosition -= 20;
    page.drawText(`Issued: ${new Date().toLocaleDateString('en-GB')}`, {
        x: 50,
        y: yPosition,
        size: 10,
        font: helvetica,
        color: rgb(0.3, 0.3, 0.3)
    });

    if (expiryDate) {
        page.drawText(`Valid Until: ${new Date(expiryDate).toLocaleDateString('en-GB')}`, {
            x: 300,
            y: yPosition,
            size: 10,
            font: helvetica,
            color: rgb(0.3, 0.3, 0.3)
        });
    }

    yPosition -= 30;

    // Patient Details Section
    page.drawText('PATIENT DETAILS', {
        x: 50,
        y: yPosition,
        size: 14,
        font: helveticaBold,
        color: rgb(0, 0, 0)
    });

    yPosition -= 20;
    page.drawText(`Name: ${patientName}`, {
        x: 70,
        y: yPosition,
        size: 11,
        font: helvetica,
        color: rgb(0, 0, 0)
    });

    yPosition -= 18;
    page.drawText(`Age: ${patientAge} years`, {
        x: 70,
        y: yPosition,
        size: 11,
        font: helvetica,
        color: rgb(0, 0, 0)
    });

    if (patientDOB) {
        yPosition -= 18;
        page.drawText(`Date of Birth: ${new Date(patientDOB).toLocaleDateString('en-GB')}`, {
            x: 70,
            y: yPosition,
            size: 11,
            font: helvetica,
            color: rgb(0, 0, 0)
        });
    }

    yPosition -= 25;

    // Login Credentials Box
    page.drawRectangle({
        x: 50,
        y: yPosition - 35,
        width: width - 100,
        height: 45,
        borderColor: rgb(0.4, 0.49, 0.92),
        borderWidth: 2,
        color: rgb(0.95, 0.97, 1)
    });

    page.drawText('ONLINE ACCESS CREDENTIALS', {
        x: 60,
        y: yPosition - 15,
        size: 10,
        font: helveticaBold,
        color: rgb(0.4, 0.49, 0.92)
    });

    page.drawText(`Username: ${patientUsername}`, {
        x: 60,
        y: yPosition - 30,
        size: 10,
        font: helvetica,
        color: rgb(0, 0, 0)
    });

    page.drawText(`Password: ${prescriptionId}`, {
        x: 300,
        y: yPosition - 30,
        size: 10,
        font: helvetica,
        color: rgb(0, 0, 0)
    });

    yPosition -= 55;

    // ZKP Phase 1: Secure Authentication Key (only for new prescriptions)
    if (patientPrivateKey) {
        page.drawRectangle({
            x: 50,
            y: yPosition - 65,
            width: width - 100,
            height: 75,
            borderColor: rgb(0.85, 0.15, 0.15),
            borderWidth: 2,
            color: rgb(1, 0.95, 0.95)
        });

        page.drawText('SECURE AUTHENTICATION KEY', {
            x: 60,
            y: yPosition - 15,
            size: 10,
            font: helveticaBold,
            color: rgb(0.85, 0.15, 0.15)
        });

        page.drawText('DO NOT SHARE — This key proves your prescription ownership', {
            x: 60,
            y: yPosition - 28,
            size: 8,
            font: helvetica,
            color: rgb(0.6, 0.1, 0.1)
        });

        // Split long key across two lines
        const keyPart1 = patientPrivateKey.substring(0, 34);
        const keyPart2 = patientPrivateKey.substring(34);

        page.drawText(keyPart1, {
            x: 60,
            y: yPosition - 43,
            size: 8,
            font: helvetica,
            color: rgb(0, 0, 0)
        });

        page.drawText(keyPart2, {
            x: 60,
            y: yPosition - 55,
            size: 8,
            font: helvetica,
            color: rgb(0, 0, 0)
        });

        yPosition -= 80;
    }

    // Diagnosis
    if (diagnosis) {
        page.drawText('DIAGNOSIS', {
            x: 50,
            y: yPosition,
            size: 14,
            font: helveticaBold,
            color: rgb(0, 0, 0)
        });

        yPosition -= 18;
        page.drawText(diagnosis, {
            x: 70,
            y: yPosition,
            size: 11,
            font: helvetica,
            color: rgb(0, 0, 0)
        });

        yPosition -= 25;
    }

    // Medicines Section
    page.drawText('PRESCRIBED MEDICINES', {
        x: 50,
        y: yPosition,
        size: 14,
        font: helveticaBold,
        color: rgb(0, 0, 0)
    });

    yPosition -= 20;

    medicines.forEach((med, index) => {
        const medText = `${index + 1}. ${med.name} - ${med.dosage || 'As directed'} (Qty: ${med.quantity})`;
        page.drawText(medText, {
            x: 70,
            y: yPosition,
            size: 11,
            font: helvetica,
            color: rgb(0, 0, 0)
        });

        yPosition -= 18;

        if (med.instructions) {
            page.drawText(`   Instructions: ${med.instructions}`, {
                x: 70,
                y: yPosition,
                size: 9,
                font: helvetica,
                color: rgb(0.4, 0.4, 0.4)
            });
            yPosition -= 18;
        }
    });

    yPosition -= 10;

    // Doctor's Notes
    if (notes) {
        page.drawText('DOCTOR\'S NOTES', {
            x: 50,
            y: yPosition,
            size: 14,
            font: helveticaBold,
            color: rgb(0, 0, 0)
        });

        yPosition -= 18;

        // Word wrap for notes
        const maxWidth = width - 140;
        const words = notes.split(' ');
        let line = '';

        words.forEach(word => {
            const testLine = line + word + ' ';
            const testWidth = helvetica.widthOfTextAtSize(testLine, 10);

            if (testWidth > maxWidth && line !== '') {
                page.drawText(line, {
                    x: 70,
                    y: yPosition,
                    size: 10,
                    font: helvetica,
                    color: rgb(0, 0, 0)
                });
                line = word + ' ';
                yPosition -= 15;
            } else {
                line = testLine;
            }
        });

        if (line) {
            page.drawText(line, {
                x: 70,
                y: yPosition,
                size: 10,
                font: helvetica,
                color: rgb(0, 0, 0)
            });
            yPosition -= 25;
        }
    }

    // Footer
    const footerY = 50;
    page.drawLine({
        start: { x: 50, y: footerY + 30 },
        end: { x: width - 50, y: footerY + 30 },
        thickness: 1,
        color: rgb(0.7, 0.7, 0.7)
    });

    page.drawText('BlockRx - Blockchain-Based Prescription System', {
        x: 50,
        y: footerY + 15,
        size: 9,
        font: helvetica,
        color: rgb(0.5, 0.5, 0.5)
    });

    page.drawText('This prescription is valid only until dispensing.', {
        x: 50,
        y: footerY,
        size: 8,
        font: helvetica,
        color: rgb(0.5, 0.5, 0.5)
    });

    if (doctorAddress) {
        page.drawText(`Doctor: ${doctorAddress.substring(0, 15)}...`, {
            x: width - 200,
            y: footerY,
            size: 8,
            font: helvetica,
            color: rgb(0.5, 0.5, 0.5)
        });
    }

    // Save PDF as buffer (encryption handled by pdfEncryptor.js using muhammara)
    const pdfBytes = await pdfDoc.save();

    return Buffer.from(pdfBytes);
};

/**
 * Generate an Invoice PDF after dispensing
 * @param {Object} invoiceData - Invoice details
 * @param {string} invoiceData.dispenseId - Unique dispense transaction ID
 * @param {string} invoiceData.prescriptionId - Prescription ID
 * @param {string} invoiceData.patientName - Patient name (decrypted)
 * @param {Array} invoiceData.items - [{name, quantity, pricePerUnit, total}]
 * @param {number} invoiceData.totalAmount - Grand total
 * @param {Date} invoiceData.date - Dispense date
 * @returns {Promise<Buffer>} - PDF as buffer
 */
const generateInvoicePDF = async (invoiceData) => {
    const {
        dispenseId,
        prescriptionId,
        patientName,
        items,
        totalAmount,
        date
    } = invoiceData;

    const pdfDoc = await PDFDocument.create();
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const page = pdfDoc.addPage([595, 842]); // A4
    const { width, height } = page.getSize();
    let y = height - 50;

    // Header
    page.drawText('PHARMACY INVOICE', {
        x: 50, y, size: 24, font: helveticaBold,
        color: rgb(0.15, 0.68, 0.38) // Green
    });

    y -= 10;
    page.drawLine({
        start: { x: 50, y }, end: { x: width - 50, y },
        thickness: 2, color: rgb(0.15, 0.68, 0.38)
    });

    y -= 25;
    page.drawText(`Invoice: ${dispenseId}`, {
        x: 50, y, size: 11, font: helveticaBold, color: rgb(0, 0, 0)
    });

    y -= 18;
    page.drawText(`Prescription: #${prescriptionId}`, {
        x: 50, y, size: 10, font: helvetica, color: rgb(0.3, 0.3, 0.3)
    });
    page.drawText(`Date: ${new Date(date).toLocaleDateString('en-GB')}`, {
        x: 350, y, size: 10, font: helvetica, color: rgb(0.3, 0.3, 0.3)
    });

    y -= 18;
    page.drawText(`Patient: ${patientName}`, {
        x: 50, y, size: 11, font: helvetica, color: rgb(0, 0, 0)
    });

    y -= 30;

    // Table Header
    page.drawRectangle({
        x: 50, y: y - 5, width: width - 100, height: 22,
        color: rgb(0.15, 0.68, 0.38)
    });

    const colX = { item: 60, qty: 320, price: 400, total: 480 };

    page.drawText('Medicine', { x: colX.item, y, size: 10, font: helveticaBold, color: rgb(1, 1, 1) });
    page.drawText('Qty', { x: colX.qty, y, size: 10, font: helveticaBold, color: rgb(1, 1, 1) });
    page.drawText('Price', { x: colX.price, y, size: 10, font: helveticaBold, color: rgb(1, 1, 1) });
    page.drawText('Total', { x: colX.total, y, size: 10, font: helveticaBold, color: rgb(1, 1, 1) });

    y -= 25;

    // Table Rows
    for (const item of items) {
        page.drawText(item.name || 'Unknown', { x: colX.item, y, size: 10, font: helvetica, color: rgb(0, 0, 0) });
        page.drawText(String(item.quantity), { x: colX.qty, y, size: 10, font: helvetica, color: rgb(0, 0, 0) });
        page.drawText(`$${(item.pricePerUnit || 0).toFixed(2)}`, { x: colX.price, y, size: 10, font: helvetica, color: rgb(0, 0, 0) });
        page.drawText(`$${(item.total || 0).toFixed(2)}`, { x: colX.total, y, size: 10, font: helvetica, color: rgb(0, 0, 0) });

        y -= 20;

        // Draw row separator
        page.drawLine({
            start: { x: 50, y: y + 8 }, end: { x: width - 50, y: y + 8 },
            thickness: 0.5, color: rgb(0.85, 0.85, 0.85)
        });
    }

    y -= 10;

    // Total
    page.drawLine({
        start: { x: 350, y }, end: { x: width - 50, y },
        thickness: 2, color: rgb(0.15, 0.68, 0.38)
    });

    y -= 20;
    page.drawText('TOTAL:', { x: 400, y, size: 14, font: helveticaBold, color: rgb(0, 0, 0) });
    page.drawText(`$${(totalAmount || 0).toFixed(2)}`, { x: 470, y, size: 14, font: helveticaBold, color: rgb(0.15, 0.68, 0.38) });

    // Footer
    const footerY = 50;
    page.drawLine({
        start: { x: 50, y: footerY + 30 }, end: { x: width - 50, y: footerY + 30 },
        thickness: 1, color: rgb(0.7, 0.7, 0.7)
    });

    page.drawText('BlockRx - Blockchain-Based Prescription System', {
        x: 50, y: footerY + 15, size: 9, font: helvetica, color: rgb(0.5, 0.5, 0.5)
    });
    page.drawText('This invoice is generated upon successful dispensing.', {
        x: 50, y: footerY, size: 8, font: helvetica, color: rgb(0.5, 0.5, 0.5)
    });

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
};

module.exports = { generateProtectedPDF, generateInvoicePDF };
