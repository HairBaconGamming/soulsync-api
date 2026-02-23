const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken'); // Cần thiết để verifyToken hoạt động
const Memory = require('../models/Memory');

// ==========================================
// 🛡️ MIDDLEWARE XÁC THỰC (THEO NGUỒN CỦA CẬU)
// ==========================================
const verifyToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Vui lòng đăng nhập để tiếp tục." });
    
    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        req.user = verified; // Lưu thông tin user (thường chứa id) vào request
        next();
    } catch (err) {
        res.status(401).json({ error: "Phiên đăng nhập hết hạn." });
    }
};

// ==========================================
// 🌌 CÁC TUYẾN ĐƯỜNG KÝ ỨC (MEMORY ROUTES)
// ==========================================

/**
 * @desc    Lấy toàn bộ vì sao ký ức của người dùng
 * @route   GET /api/memories
 */
router.get('/', verifyToken, async (req, res) => {
    try {
        // req.user.id lấy từ payload của token sau khi verify
        const memories = await Memory.find({ userId: req.user.id })
            .select('-embedding') // Không lấy vector để nhẹ dữ liệu
            .sort({ createdAt: -1 });

        res.status(200).json(memories);
    } catch (error) {
        console.error("🚨 Lỗi tải bầu trời sao:", error);
        res.status(500).json({ error: "Không thể kết nối với dòng thời gian." });
    }
});

/**
 * @desc    Xóa vĩnh viễn một ký ức (Để người dùng "buông bỏ")
 * @route   DELETE /api/memories/:id
 */
router.delete('/:id', verifyToken, async (req, res) => {
    try {
        // Chỉ cho phép xóa nếu ký ức đó thuộc về chính người dùng này
        const deletedMemory = await Memory.findOneAndDelete({ 
            _id: req.params.id, 
            userId: req.user.id 
        });

        if (!deletedMemory) {
            return res.status(404).json({ error: "Ký ức không tồn tại hoặc không thuộc quyền sở hữu của cậu." });
        }

        res.status(200).json({ message: "Ký ức đã hóa thành bụi sao." });
    } catch (error) {
        console.error("🚨 Lỗi khi xóa ký ức:", error);
        res.status(500).json({ error: "Gặp sự cố khi xóa ký ức." });
    }
});

module.exports = router;