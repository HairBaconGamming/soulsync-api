const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Session = require('../models/Session'); // Nhớ import model Session vào đầu file nếu chưa có

// Middleware: Người gác cổng kiểm tra Token
const verifyToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Vui lòng đăng nhập để tiếp tục." });
    
    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        req.user = verified; // Lưu id vào req để dùng cho các hàm sau
        next();
    } catch (err) {
        res.status(401).json({ error: "Phiên đăng nhập hết hạn." });
    }
};

// 1. LẤY TOÀN BỘ THÔNG TIN USER (Bao gồm cả Hồ sơ tâm lý)
router.get('/profile', verifyToken, async (req, res) => {
    try {
        // Tìm user, nhưng KHÔNG trả về mật khẩu để bảo mật
        const user = await User.findById(req.user.id).select('-password -resetPasswordOtp -resetPasswordExpires');
        if (!user) return res.status(404).json({ error: "Không tìm thấy người dùng." });
        
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: "Lỗi hệ thống khi tải hồ sơ." });
    }
});

// 2. CẬP NHẬT HỒ SƠ (Bao gồm cả Cấm kỵ và Xóa Ký ức)
router.put('/profile', verifyToken, async (req, res) => {
    try {
        const { displayName, userContext, aiPersona, isIncognito, totalEnergy, rebirthCount, blacklistedTopics, coreMemories } = req.body; 
        const user = await User.findById(req.user.id);
        
        if (!user) return res.status(404).json({ error: "Không tìm thấy người dùng." });

        if (displayName !== undefined) user.displayName = displayName;
        if (userContext !== undefined) user.userContext = userContext;
        if (aiPersona !== undefined) user.aiPersona = aiPersona; 
        if (isIncognito !== undefined) user.isIncognito = isIncognito; 
        if (totalEnergy !== undefined) user.totalEnergy = totalEnergy;
        if (rebirthCount !== undefined) user.rebirthCount = rebirthCount;
        
        // 👉 CẬP NHẬT 2 TRƯỜNG MỚI NÀY
        if (blacklistedTopics !== undefined) user.blacklistedTopics = blacklistedTopics;
        if (coreMemories !== undefined) user.coreMemories = coreMemories;

        await user.save();
        res.json({ message: "Đã lưu thông tin 🌿" });
    } catch (error) {
        res.status(500).json({ error: "Lỗi hệ thống khi lưu hồ sơ." });
    }
});

router.delete('/memory', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Reset Hồ sơ tâm lý của User
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: "Không tìm thấy người dùng." });
        
        user.userContext = "Người dùng vừa chọn xóa sạch ký ức. Hãy làm quen lại từ đầu một cách nhẹ nhàng.";
        user.coreMemories = []; // Xóa sạch mảng nén ký ức
        await user.save();

        // 2. Xóa toàn bộ lịch sử trò chuyện (Sessions) của User này
        await Session.deleteMany({ userId: userId });

        res.json({ message: "Toàn bộ trí nhớ và lịch sử trò chuyện đã được xóa vĩnh viễn." });
    } catch (error) {
        console.error("Lỗi xóa trí nhớ AI:", error);
        res.status(500).json({ error: "Hệ thống lỗi khi xóa ký ức. Cậu thử lại sau nhé." });
    }
});

module.exports = router;