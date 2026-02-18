const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { OAuth2Client } = require('google-auth-library');
// Khởi tạo Google Client với 3 thông số từ file .env
const client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'https://hiencuacau-api.onrender.com/api/auth/google/callback' // Phải khớp 100% với trên Google Console
);


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

// --- API 1: Người dùng bấm nút, Backend chuyển hướng sang trang đăng nhập Google ---
router.get('/google', (req, res) => {
  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: ['profile', 'email']
  });
  res.redirect(url);
});

// --- API 2: Google trả kết quả về đây (Link Callback cậu đã điền) ---
router.get('/google/callback', async (req, res) => {
  const { code } = req.query;
  try {
    // 1. Lấy token từ Google
    const { tokens } = await client.getToken(code);
    
    // 2. Giải mã token để lấy Email, Tên và Avatar
    const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = payload.email;
    const name = payload.name;
    const picture = payload.picture; // Lấy link ảnh từ Google

    // 3. XỬ LÝ TRÙNG LẶP & TẠO USER MỚI
    let user = await User.findOne({ email });
    if (!user) {
        let finalUsername = name;
        let isNameTaken = await User.findOne({ username: finalUsername });
        
        // NẾU TRÙNG TÊN: Lấy phần đầu của email ghép vào (VD: Trương Hoàng Nam (truonghoangnam))
        if (isNameTaken) {
            const emailPrefix = email.split('@')[0];
            finalUsername = `${name} (${emailPrefix})`;
        }

        user = new User({ 
            username: finalUsername, 
            email: email, 
            password: 'google_oauth_placeholder',
            avatar: picture,
            hwid: `google_${email}`, // Fix triệt để lỗi hwid: null
            userContext: '' 
        });
        await user.save();
    } else if (!user.avatar && picture) {
        user.avatar = picture;
        await user.save();
    }

    // 4. Tạo JWT Token
    const jwtToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    // 5. Ném người dùng về Frontend, GỬI KÈM CẢ AVATAR VÀ EMAIL
    res.redirect(`https://hiencuacau.onrender.com/?token=${jwtToken}&username=${encodeURIComponent(user.username)}&avatar=${encodeURIComponent(user.avatar || '')}&email=${encodeURIComponent(user.email)}`);

  } catch (error) {
    console.error("Lỗi Google Auth:", error);
    res.redirect('https://hiencuacau.onrender.com/?error=google_auth_failed');
  }
});

module.exports = router;