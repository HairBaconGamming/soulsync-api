const express = require('express');
const router = express.Router();
const Memory = require('../models/Memory'); // Model Vector RAG cậu đã tạo
const verifyToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Vui lòng đăng nhập để tiếp tục." });
    
    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        req.user = verified;
        next();
    } catch (err) {
        res.status(401).json({ error: "Phiên đăng nhập hết hạn." });
    }
};

// Lấy toàn bộ bầu trời ký ức của User hiện tại
router.get('/', protect, async (req, res) => {
    try {
        // Lấy tất cả ký ức, sắp xếp mới nhất lên đầu. KHÔNG lấy mảng embedding để tiết kiệm băng thông
        const memories = await Memory.find({ userId: req.user._id })
                                     .select('-embedding') 
                                     .sort({ createdAt: -1 });
        res.status(200).json(memories);
    } catch (error) {
        console.error("🚨 Lỗi tải ký ức:", error);
        res.status(500).json({ message: "Không thể tải bầu trời ký ức." });
    }
});

// Xóa vĩnh viễn một vì sao (Xóa ký ức)
router.delete('/:id', protect, async (req, res) => {
    try {
        const memory = await Memory.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
        if (!memory) return res.status(404).json({ message: "Không tìm thấy ký ức này." });
        res.status(200).json({ message: "Ký ức đã hóa thành bụi sao." });
    } catch (error) {
        res.status(500).json({ message: "Lỗi khi xóa ký ức." });
    }
});

module.exports = router;