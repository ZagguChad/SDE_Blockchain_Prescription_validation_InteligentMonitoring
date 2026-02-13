/**
 * PDF Password Generation Utility
 * 
 * Generates deterministic password for PDF protection
 * Format: patientUsername_DDMMYYYY
 * 
 * Example: zaggu-2E0592_12022009
 */

const generatePDFPassword = (patientUsername, dob) => {
    if (!patientUsername || !dob) {
        throw new Error('patientUsername and dob are required');
    }

    // Ensure dob is a Date object
    const dateObj = dob instanceof Date ? dob : new Date(dob);

    if (isNaN(dateObj.getTime())) {
        throw new Error('Invalid date provided');
    }

    // Format: DDMMYYYY
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();

    return `${patientUsername}_${day}${month}${year}`;
};

module.exports = { generatePDFPassword };
