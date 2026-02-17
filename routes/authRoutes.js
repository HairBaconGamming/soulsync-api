const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

router.post('/register', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 8);
        const user = new User({ username: req.body.username, password: hashedPassword });
        await user.save(); 
        res.status(201).send({ message: "Đăng ký thành công!" });
    } catch (e) { 
        console.error("🔴 LỖI ĐĂNG KÝ:", e);
        res.status(400).send({ error: "Tên đăng nhập đã tồn tại hoặc lỗi Database." }); 
    }
});

router.post('/login', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.body.username });
        if (!user) {
            return res.status(400).send({ error: "Không tìm thấy tài khoản." });
        }
        
        const isMatch = await bcrypt.compare(req.body.password, user.password);
        if (!isMatch) {
            return res.status(400).send({ error: "Sai mật khẩu." });
        }
        
        // Đoạn này hay gây lỗi 500 nhất nếu thiếu JWT_SECRET
        if (!process.env.JWT_SECRET) {
            throw new Error("Thiếu biến môi trường JWT_SECRET trong file .env");
        }

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.send({ token, username: user.username });
    } catch (e) { 
        console.error("🔴 LỖI ĐĂNG NHẬP:", e.message);
        res.status(500).send({ error: "Lỗi máy chủ." }); 
    }
});

module.exports = router;