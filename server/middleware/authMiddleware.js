const jwt = require('jsonwebtoken');

const protect = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer')) {
        return res.status(401).json({
            message: 'Not authorized, no token provided',
            code: 'NO_TOKEN'
        });
    }

    const token = authHeader.split(' ')[1];
    if (!token || token === 'null' || token === 'undefined') {
        return res.status(401).json({
            message: 'Not authorized, empty token',
            code: 'NO_TOKEN'
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Debug log for tracing token lifecycle issues
        const tokenType = decoded.type || decoded.role || 'unknown';
        console.log(`🔑 Auth: ${req.method} ${req.originalUrl} — token type: ${tokenType}`);

        // Attach decoded JWT payload: { id, role } for standard users
        // or { prescriptionId, type } for patient tokens
        req.user = decoded;

        return next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            console.warn(`🔒 Auth middleware — token expired for ${req.method} ${req.originalUrl}`);
            return res.status(401).json({
                message: 'Session expired. Please log in again.',
                code: 'TOKEN_EXPIRED'
            });
        }

        console.error(`🔒 Auth middleware — token invalid for ${req.method} ${req.originalUrl}: ${error.message}`);
        return res.status(401).json({
            message: 'Not authorized, invalid token',
            code: 'TOKEN_INVALID'
        });
    }
};

const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Not authorized' });
        }
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                message: `User role ${req.user.role} is not authorized to access this route`
            });
        }
        next();
    };
};

module.exports = { protect, authorize };
