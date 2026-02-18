const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
    try {
        const token = req.header('Authorization').replace('Bearer ', '');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const user = await User.findById(decoded.id);

        if (!user) {
            return res.status(401).json({ error: "Tài khoản không tồn tại hoặc đã bị xóa." });
        }

        // GÁN CẢ 2 BIẾN ĐỂ CHỐNG LỖI UNDEFINED
        req.user = user; 
        req.userId = user._id; // <--- Quan trọng: Để các file Routes đọc được req.userId
        
        req.token = token;
        next();
    } catch (e) {
        res.status(401).json({ error: 'Vui lòng đăng nhập để tiếp tục.' });
    }
};

module.exports = auth;