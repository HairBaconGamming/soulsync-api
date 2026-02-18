const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
    try {
        const authHeader = req.header('Authorization');
        if (!authHeader) return res.status(401).json({ error: 'Không tìm thấy mã xác thực.' });

        const token = authHeader.replace('Bearer ', '');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Dùng try-catch nhỏ bên trong để bắt lỗi MongoDB
        const user = await User.findById(decoded.id).select('-password');

        if (!user) {
            return res.status(401).json({ error: "Tài khoản không tồn tại hoặc đã bị xóa." });
        }

        req.user = user;
        req.token = token;
        next();
    } catch (e) {
        console.error("🚨 LỖI AUTH MIDDLEWARE:", e.message);
        // Trả về 401 thay vì để mặc định văng lỗi 500
        res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ.' });
    }
};

module.exports = auth;