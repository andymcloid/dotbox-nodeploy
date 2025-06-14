const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-me';

function generateToken() {
    return jwt.sign({}, JWT_SECRET, { expiresIn: '1y' });
}

function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
}

function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
        return res.status(401).json({ error: 'No authorization header' });
    }

    const [type, token] = authHeader.split(' ');

    if (type !== 'Bearer') {
        return res.status(401).json({ error: 'Invalid authorization type' });
    }

    const payload = verifyToken(token);
    if (!payload) {
        return res.status(401).json({ error: 'Invalid token' });
    }

    next();
}

module.exports = {
    generateToken,
    verifyToken,
    requireAuth
}; 