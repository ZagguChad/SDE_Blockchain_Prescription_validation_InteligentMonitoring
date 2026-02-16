/**
 * In-Memory Rate Limiter Middleware
 * 
 * Zero-dependency, zero-cost rate limiting.
 * Uses a simple Map with automatic cleanup to prevent memory leaks.
 * Suitable for single-server deployments.
 */

const rateLimitStore = new Map();

// Cleanup expired entries every 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore) {
        if (now > entry.resetAt) {
            rateLimitStore.delete(key);
        }
    }
}, 10 * 60 * 1000);

/**
 * Create a rate limiter middleware.
 * 
 * @param {Object} options
 * @param {number} options.maxRequests - Maximum requests in the window
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {string} options.keyPrefix - Prefix for the rate limit key
 * @param {function} [options.keyExtractor] - Custom key extraction from req (default: req.body.prescriptionId || req.ip)
 * @param {string} [options.message] - Custom error message
 * @returns {function} Express middleware
 */
function createRateLimiter({
    maxRequests = 5,
    windowMs = 15 * 60 * 1000,
    keyPrefix = 'rl',
    keyExtractor = null,
    message = 'Too many requests. Please try again later.'
}) {
    return (req, res, next) => {
        const identifier = keyExtractor
            ? keyExtractor(req)
            : (req.body?.prescriptionId || req.ip);

        const key = `${keyPrefix}:${identifier}`;
        const now = Date.now();

        let entry = rateLimitStore.get(key);

        if (!entry || now > entry.resetAt) {
            // New window
            entry = { count: 1, resetAt: now + windowMs };
            rateLimitStore.set(key, entry);
            return next();
        }

        entry.count++;

        if (entry.count > maxRequests) {
            const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
            return res.status(429).json({
                message,
                retryAfterSeconds: retryAfterSec
            });
        }

        return next();
    };
}

// Pre-configured limiters for MFA endpoints
const otpRequestLimiter = createRateLimiter({
    maxRequests: 3,
    windowMs: 15 * 60 * 1000, // 15 minutes
    keyPrefix: 'otp-req',
    message: 'Too many OTP requests. Please wait 15 minutes before trying again.'
});

const otpVerifyLimiter = createRateLimiter({
    maxRequests: 5,
    windowMs: 30 * 60 * 1000, // 30 minutes
    keyPrefix: 'otp-verify',
    message: 'Too many failed OTP attempts. Account locked for 30 minutes.'
});

const totpVerifyLimiter = createRateLimiter({
    maxRequests: 5,
    windowMs: 15 * 60 * 1000,
    keyPrefix: 'totp-verify',
    message: 'Too many failed TOTP attempts. Please wait 15 minutes.'
});

// Pre-configured limiters for Dispense MFA endpoints (pharmacy-side)
const dispenseOtpRequestLimiter = createRateLimiter({
    maxRequests: 3,
    windowMs: 15 * 60 * 1000, // 15 minutes
    keyPrefix: 'disp-otp-req',
    keyExtractor: (req) => req.body?.prescriptionId || req.ip,
    message: 'Too many dispense OTP requests. Please wait 15 minutes before trying again.'
});

const dispenseOtpVerifyLimiter = createRateLimiter({
    maxRequests: 5,
    windowMs: 30 * 60 * 1000, // 30 minutes
    keyPrefix: 'disp-otp-verify',
    keyExtractor: (req) => req.body?.prescriptionId || req.ip,
    message: 'Too many failed dispense OTP attempts. Locked for 30 minutes.'
});

const dispenseTotpVerifyLimiter = createRateLimiter({
    maxRequests: 5,
    windowMs: 15 * 60 * 1000,
    keyPrefix: 'disp-totp-verify',
    keyExtractor: (req) => req.body?.prescriptionId || req.ip,
    message: 'Too many failed dispense TOTP attempts. Please wait 15 minutes.'
});

module.exports = {
    createRateLimiter,
    otpRequestLimiter,
    otpVerifyLimiter,
    totpVerifyLimiter,
    dispenseOtpRequestLimiter,
    dispenseOtpVerifyLimiter,
    dispenseTotpVerifyLimiter
};
