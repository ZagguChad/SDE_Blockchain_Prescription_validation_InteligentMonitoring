/**
 * Email Service for Prescription Delivery
 * 
 * Sends password-protected prescription PDFs to patients via email
 */

const nodemailer = require('nodemailer');

// Create reusable transporter
const createTransporter = () => {
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: false, // true for 465, false for other ports
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
};

/**
 * Send prescription email with password-protected PDF
 * @param {string} patientEmail - Patient's email address
 * @param {string} patientName - Patient's name
 * @param {string} patientUsername - Patient's login username
 * @param {Buffer} pdfBuffer - PDF file as buffer
 * @param {string} prescriptionId - Prescription ID
 * @param {string} pdfPassword - PDF password (optional, for display in email)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
const sendPrescriptionEmail = async (patientEmail, patientName, patientUsername, pdfBuffer, prescriptionId, pdfPassword = null) => {
    try {
        const transporter = createTransporter();

        // Email template
        const emailHTML = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
        .password-box { background: #fff; border: 2px solid #667eea; padding: 15px; margin: 15px 0; border-radius: 8px; }
        .code { font-family: monospace; background: #f3f4f6; padding: 8px 12px; border-radius: 4px; display: inline-block; font-size: 14px; }
        .footer { background: #374151; color: #9ca3af; padding: 15px; text-align: center; border-radius: 0 0 8px 8px; font-size: 12px; }
        .important { color: #dc2626; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 style="margin: 0;">🏥 Medical Prescription</h1>
            <p style="margin: 5px 0 0 0; opacity: 0.9;">BlockRx Medical System</p>
        </div>
        
        <div class="content">
            <p>Dear <strong>${patientName}</strong>,</p>
            
            <p>Your prescription has been issued and is attached to this email as a <strong>password-protected PDF</strong>.</p>
            
            <div class="password-box">
                <p style="margin-top: 0;"><strong>📄 To open the PDF, use this password:</strong></p>
                ${pdfPassword ?
                `<p class="code">${pdfPassword}</p>` :
                `<p class="code">${patientUsername}_DDMMYYYY</p>
                     <p style="font-size: 13px; color: #6b7280; margin-bottom: 0;">
                         Replace <strong>DDMMYYYY</strong> with your date of birth.<br>
                         <strong>Example:</strong> If your DOB is 12/02/2009, use: <code>${patientUsername}_12022009</code>
                     </p>`
            }
            </div>
            
            <p class="important">⚠️ Keep this password confidential. It contains your personal information.</p>
            
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
            
            <p><strong>🌐 You can also view your prescription online:</strong></p>
            <p>Visit: <a href="http://localhost:3000/login" style="color: #667eea;">http://localhost:3000/login</a></p>
            <p>
                <strong>Username:</strong> <span class="code">${patientUsername}</span><br>
                <strong>Password:</strong> <span class="code">${prescriptionId}</span>
            </p>
            
            <p style="margin-top: 20px; font-size: 13px; color: #6b7280;">
                This prescription is valid until dispensing. Please present this to the pharmacy when collecting your medication.
            </p>
        </div>
        
        <div class="footer">
            <p style="margin: 0;">BlockRx - Blockchain-Based Prescription System</p>
            <p style="margin: 5px 0 0 0;">This is an automated message. Please do not reply to this email.</p>
        </div>
    </div>
</body>
</html>
        `;

        const mailOptions = {
            from: process.env.SMTP_FROM || `"BlockRx Medical System" <${process.env.SMTP_USER}>`,
            to: patientEmail,
            subject: `Your Medical Prescription - #${prescriptionId}`,
            html: emailHTML,
            attachments: [
                {
                    filename: `Prescription_${prescriptionId}.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                }
            ]
        };

        const info = await transporter.sendMail(mailOptions);

        console.log('✅ Email sent successfully:', info.messageId);
        return { success: true, messageId: info.messageId };

    } catch (error) {
        console.error('❌ Email sending failed:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Send invoice email with PDF attachment after dispensing
 * @param {string} patientEmail - Patient's email address
 * @param {string} patientName - Patient's name
 * @param {string} prescriptionId - Prescription ID
 * @param {string} dispenseId - Dispense transaction ID
 * @param {Buffer} invoicePdfBuffer - Invoice PDF as buffer
 * @param {number} totalAmount - Invoice total
 * @returns {Promise<{success: boolean, error?: string}>}
 */
const sendInvoiceEmail = async (patientEmail, patientName, prescriptionId, dispenseId, invoicePdfBuffer, totalAmount) => {
    try {
        const transporter = createTransporter();

        const emailHTML = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
        .total-box { background: #fff; border: 2px solid #27ae60; padding: 15px; margin: 15px 0; border-radius: 8px; text-align: center; }
        .code { font-family: monospace; background: #f3f4f6; padding: 8px 12px; border-radius: 4px; display: inline-block; font-size: 14px; }
        .footer { background: #374151; color: #9ca3af; padding: 15px; text-align: center; border-radius: 0 0 8px 8px; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 style="margin: 0;">🧾 Pharmacy Invoice</h1>
            <p style="margin: 5px 0 0 0; opacity: 0.9;">BlockRx Medical System</p>
        </div>
        
        <div class="content">
            <p>Dear <strong>${patientName}</strong>,</p>
            
            <p>Your prescription <strong>#${prescriptionId}</strong> has been dispensed. Please find your invoice attached as a PDF.</p>
            
            <div class="total-box">
                <p style="margin: 0; font-size: 13px; color: #6b7280;">Invoice Total</p>
                <p style="margin: 5px 0 0 0; font-size: 28px; font-weight: bold; color: #27ae60;">$${(totalAmount || 0).toFixed(2)}</p>
                <p style="margin: 5px 0 0 0; font-size: 12px; color: #6b7280;">Transaction: ${dispenseId}</p>
            </div>
            
            <p style="margin-top: 20px; font-size: 13px; color: #6b7280;">
                This invoice was generated automatically upon successful dispensing. If you have questions, please contact your pharmacy.
            </p>
        </div>
        
        <div class="footer">
            <p style="margin: 0;">BlockRx - Blockchain-Based Prescription System</p>
            <p style="margin: 5px 0 0 0;">This is an automated message. Please do not reply to this email.</p>
        </div>
    </div>
</body>
</html>
        `;

        const mailOptions = {
            from: process.env.SMTP_FROM || `"BlockRx Medical System" <${process.env.SMTP_USER}>`,
            to: patientEmail,
            subject: `Pharmacy Invoice - Prescription #${prescriptionId}`,
            html: emailHTML,
            attachments: [
                {
                    filename: `Invoice_${dispenseId}.pdf`,
                    content: invoicePdfBuffer,
                    contentType: 'application/pdf'
                }
            ]
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Invoice email sent successfully:', info.messageId);
        return { success: true, messageId: info.messageId };

    } catch (error) {
        console.error('❌ Invoice email sending failed:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Send OTP verification email to patient
 * @param {string} patientEmail - Patient's email address
 * @param {string} patientName - Patient's name
 * @param {string} otp - 6-digit OTP code
 * @param {string} prescriptionId - Prescription ID for context
 * @returns {Promise<{success: boolean, error?: string}>}
 */
const sendOtpEmail = async (patientEmail, patientName, otp, prescriptionId) => {
    try {
        const transporter = createTransporter();

        const emailHTML = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
        .otp-box { background: #fff; border: 2px solid #667eea; padding: 20px; margin: 15px 0; border-radius: 8px; text-align: center; }
        .otp-code { font-family: monospace; font-size: 32px; letter-spacing: 8px; font-weight: bold; color: #667eea; }
        .footer { background: #374151; color: #9ca3af; padding: 15px; text-align: center; border-radius: 0 0 8px 8px; font-size: 12px; }
        .warning { color: #dc2626; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 style="margin: 0;">🔐 Verification Code</h1>
            <p style="margin: 5px 0 0 0; opacity: 0.9;">BlockRx Medical System</p>
        </div>
        
        <div class="content">
            <p>Dear <strong>${patientName}</strong>,</p>
            
            <p>Use the following code to verify your identity and access your prescription <strong>#${prescriptionId}</strong>:</p>
            
            <div class="otp-box">
                <p style="margin: 0 0 10px 0; font-size: 13px; color: #6b7280;">Your Verification Code</p>
                <p class="otp-code" style="margin: 0;">${otp}</p>
                <p style="margin: 10px 0 0 0; font-size: 13px; color: #6b7280;">Valid for 5 minutes</p>
            </div>
            
            <p class="warning">⚠️ Do not share this code with anyone. BlockRx staff will never ask for your OTP.</p>
            
            <p style="font-size: 13px; color: #6b7280; margin-top: 20px;">
                If you did not request this code, please ignore this email. Your account remains secure.
            </p>
        </div>
        
        <div class="footer">
            <p style="margin: 0;">BlockRx - Blockchain-Based Prescription System</p>
            <p style="margin: 5px 0 0 0;">This is an automated message. Please do not reply to this email.</p>
        </div>
    </div>
</body>
</html>
        `;

        const mailOptions = {
            from: process.env.SMTP_FROM || `"BlockRx Medical System" <${process.env.SMTP_USER}>`,
            to: patientEmail,
            subject: `🔐 Your BlockRx Verification Code - #${prescriptionId}`,
            html: emailHTML
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('✅ OTP email sent successfully:', info.messageId);
        return { success: true, messageId: info.messageId };

    } catch (error) {
        console.error('❌ OTP email sending failed:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Send dispense verification email to patient (pharmacy-side OTP)
 * This is used when pharmacist needs to verify patient identity before dispensing.
 * @param {string} patientEmail - Patient's email address
 * @param {string} patientName - Patient's name
 * @param {string} otp - 6-digit OTP code
 * @param {string} prescriptionId - Prescription ID for context
 * @returns {Promise<{success: boolean, error?: string}>}
 */
const sendDispenseVerificationEmail = async (patientEmail, patientName, otp, prescriptionId) => {
    try {
        const transporter = createTransporter();

        const emailHTML = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
        .otp-box { background: #fff; border: 2px solid #f59e0b; padding: 20px; margin: 15px 0; border-radius: 8px; text-align: center; }
        .otp-code { font-family: monospace; font-size: 32px; letter-spacing: 8px; font-weight: bold; color: #d97706; }
        .footer { background: #374151; color: #9ca3af; padding: 15px; text-align: center; border-radius: 0 0 8px 8px; font-size: 12px; }
        .warning { color: #dc2626; font-weight: bold; }
        .pharmacy-note { background: #fef3c7; border: 1px solid #f59e0b; padding: 12px; border-radius: 6px; margin: 15px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 style="margin: 0;">💊 Pharmacy Verification Code</h1>
            <p style="margin: 5px 0 0 0; opacity: 0.9;">BlockRx Medical System</p>
        </div>
        
        <div class="content">
            <p>Dear <strong>${patientName}</strong>,</p>
            
            <div class="pharmacy-note">
                <p style="margin: 0;"><strong>🏥 A pharmacy is preparing to dispense your prescription #${prescriptionId}.</strong></p>
                <p style="margin: 5px 0 0 0; font-size: 13px;">Please provide this code to the pharmacist to verify your identity.</p>
            </div>
            
            <div class="otp-box">
                <p style="margin: 0 0 10px 0; font-size: 13px; color: #6b7280;">Your Verification Code</p>
                <p class="otp-code" style="margin: 0;">${otp}</p>
                <p style="margin: 10px 0 0 0; font-size: 13px; color: #6b7280;">Valid for 5 minutes</p>
            </div>
            
            <p class="warning">⚠️ Only share this code with the pharmacist at the counter. Never share it over phone or text.</p>
            
            <p style="font-size: 13px; color: #6b7280; margin-top: 20px;">
                If you are not at a pharmacy or did not expect this, please ignore this email and contact your healthcare provider.
            </p>
        </div>
        
        <div class="footer">
            <p style="margin: 0;">BlockRx - Blockchain-Based Prescription System</p>
            <p style="margin: 5px 0 0 0;">This is an automated message. Please do not reply to this email.</p>
        </div>
    </div>
</body>
</html>
        `;

        const mailOptions = {
            from: process.env.SMTP_FROM || `"BlockRx Medical System" <${process.env.SMTP_USER}>`,
            to: patientEmail,
            subject: `💊 Pharmacy Verification Code - Prescription #${prescriptionId}`,
            html: emailHTML
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Dispense verification email sent successfully:', info.messageId);
        return { success: true, messageId: info.messageId };

    } catch (error) {
        console.error('❌ Dispense verification email sending failed:', error.message);
        return { success: false, error: error.message };
    }
};

module.exports = { sendPrescriptionEmail, sendInvoiceEmail, sendOtpEmail, sendDispenseVerificationEmail };
