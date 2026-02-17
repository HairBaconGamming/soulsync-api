const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const auth = require('../middlewares/auth');

router.get('/profile', auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        res.json({ username: user.username, messageCount: user.messageCount, moodCount: user.moodHistory.length, createdAt: user.createdAt });
    } catch (e) { res.status(500).send({ error: "Lỗi tải hồ sơ." }); }
});

router.put('/password', auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!await bcrypt.compare(req.body.oldPassword, user.password)) return res.status(400).send({ error: "Mật khẩu cũ không đúng." });
        user.password = await bcrypt.hash(req.body.newPassword, 8);
        await user.save(); res.json({ success: true, message: "Đổi mật khẩu thành công!" });
    } catch (e) { res.status(500).send({ error: "Lỗi đổi mật khẩu." }); }
});

router.delete('/reset-data', auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        user.sessions = []; user.userContext = "Người dùng mới, chưa có thông tin."; user.messageCount = 0;
        await user.save(); res.json({ success: true });
    } catch (e) { res.status(500).send({ error: "Lỗi reset dữ liệu." }); }
});

module.exports = router;