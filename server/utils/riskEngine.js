/**
 * Risk Engine — Adaptive Security Level Assessment
 * 
 * Maps actions to risk levels for adaptive MFA enforcement.
 * Configurable and extensible without code changes.
 */

// Default risk configuration
const RISK_CONFIG = {
    // Low risk: Email OTP only
    login: 'low',
    viewPrescription: 'low',
    viewProfile: 'low',

    // Medium risk: Email OTP + TOTP
    updateSettings: 'medium',
    enableTotp: 'medium',
    disableTotp: 'medium',

    // High risk: Email OTP + TOTP + Blockchain signature
    dispense: 'high',
    legalConsent: 'high',
    sensitivePrescription: 'high',
    deleteAccount: 'high'
};

// MFA requirements per risk level
const MFA_REQUIREMENTS = {
    low: ['emailOtp'],
    medium: ['emailOtp', 'totp'],
    high: ['emailOtp', 'totp', 'blockchainSignature']
};

/**
 * Assess the risk level for a given action.
 * @param {string} action - Action identifier
 * @returns {'low'|'medium'|'high'}
 */
function assessRiskLevel(action) {
    return RISK_CONFIG[action] || 'low';
}

/**
 * Get required MFA methods for a risk level.
 * Filters based on what the patient has enabled.
 * 
 * @param {string} riskLevel - 'low', 'medium', or 'high'
 * @param {Object} patientMfaStatus - { emailOtpEnabled, totpEnabled }
 * @returns {string[]} Required MFA methods
 */
function getRequiredMfaMethods(riskLevel, patientMfaStatus) {
    const allRequired = MFA_REQUIREMENTS[riskLevel] || MFA_REQUIREMENTS.low;

    // Filter to only methods the patient has enabled
    return allRequired.filter(method => {
        switch (method) {
            case 'emailOtp':
                return patientMfaStatus.emailOtpEnabled !== false; // Default true
            case 'totp':
                return patientMfaStatus.totpEnabled === true;
            case 'blockchainSignature':
                return true; // Always available if required (uses wallet)
            default:
                return false;
        }
    });
}

/**
 * Check if a patient's completed MFA satisfies the required level.
 * 
 * @param {string[]} completedMethods - Methods the patient has completed (e.g., ['emailOtp', 'totp'])
 * @param {string} riskLevel - Required risk level
 * @param {Object} patientMfaStatus - Patient's MFA configuration
 * @returns {{ satisfied: boolean, missing: string[] }}
 */
function checkMfaSatisfaction(completedMethods, riskLevel, patientMfaStatus) {
    const required = getRequiredMfaMethods(riskLevel, patientMfaStatus);
    const missing = required.filter(m => !completedMethods.includes(m));

    return {
        satisfied: missing.length === 0,
        missing
    };
}

module.exports = {
    assessRiskLevel,
    getRequiredMfaMethods,
    checkMfaSatisfaction,
    RISK_CONFIG,
    MFA_REQUIREMENTS
};
