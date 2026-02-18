const jwt = require('jsonwebtoken');
const User = require('../models/User'); // Import model User vào

const auth = async (req, res, next) => {
    try {
        const token = req.header('Authorization').replace('Bearer ', '');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // --- ĐOẠN NÂNG CẤP QUAN TRỌNG ---
        const user = await User.findById(decoded.id);

        if (!user) {
            // Nếu không tìm thấy User trong MongoDB, trả về lỗi 401 ngay lập tức
            return res.status(401).json({ error: "Tài khoản không tồn tại hoặc đã bị xóa." });
        }

        req.user = user;
        req.token = token;
        next();
    } catch (e) {
        res.status(401).send({ error: 'Vui lòng đăng nhập để tiếp tục.' });
    }
};

module.exports = auth;