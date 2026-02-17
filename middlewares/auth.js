const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
    try {
        const token = req.header('Authorization').replace('Bearer ', '');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.id; 
        next();
    } catch (e) { 
        console.error("🔴 LỖI XÁC THỰC:", e.message);
        res.status(401).send({ error: 'Vui lòng đăng nhập.' }); 
    }
};

module.exports = authMiddleware;