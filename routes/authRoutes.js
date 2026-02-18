const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User'); // Đảm bảo đường dẫn tới file Model User là chính xác
const { OAuth2Client } = require('google-auth-library');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');

// ==========================================
// CẤU HÌNH GOOGLE OAUTH CLIENT
// ==========================================
// Nhớ điền GOOGLE_CLIENT_ID và GOOGLE_CLIENT_SECRET trong file .env nhé
const client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'https://hiencuacau-api.onrender.com/api/auth/google/callback' // Phải khớp 100% với Google Console
);

// Cấu hình trạm gửi Email
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

router.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        // Kiểm tra xem Email đã tồn tại chưa
        const existingUser = await User.findOne({ email });
        
        if (existingUser) {
            // NẾU EMAIL NÀY LÀ CỦA GOOGLE
            if (existingUser.hwid && existingUser.hwid.startsWith('google_')) {
                return res.status(400).json({ 
                    error: "Email này đã được liên kết với Google. Cậu hãy quay lại và bấm nút 'Đăng nhập bằng Google' nhé 🌿" 
                });
            }
            // NẾU LÀ TÀI KHOẢN BÌNH THƯỜNG BỊ TRÙNG
            return res.status(400).json({ error: "Email này đã được sử dụng rồi. Cậu thử một email khác xem sao." });
        }

        // Kiểm tra trùng Tên hiển thị (Tùy chọn)
        const existingUsername = await User.findOne({ username });
        if (existingUsername) {
            return res.status(400).json({ error: "Tên hiển thị này đã có người dùng. Cậu thêm vài con số hay ký tự để tạo điểm nhấn nhé." });
        }

        // Mã hóa mật khẩu và lưu
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, email, password: hashedPassword });
        
        await newUser.save();
        res.status(201).json({ message: "Tuyệt vời! Cậu đã đăng ký thành công. Giờ thì đăng nhập nhé." });

    } catch (error) {
        console.error("Lỗi đăng ký:", error);
        res.status(500).json({ error: "Hệ thống đang bận chút xíu, cậu thử lại sau nhé." });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Tìm user theo email
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ error: "Mình không tìm thấy email này trong hệ thống. Cậu gõ đúng chưa?" });

        // CHẶN NGAY NẾU LÀ TÀI KHOẢN GOOGLE
        // (Nhận diện qua chuỗi mật khẩu placeholder chúng ta tạo lúc callback)
        if (user.password.includes('google_') && user.password.includes('_placeholder')) {
             return res.status(400).json({ 
                 error: "Tài khoản này dùng Google để mở cửa. Cậu hãy bấm nút 'Đăng nhập bằng Google' ở bên dưới nhé ✨" 
             });
        }

        // Nếu là tài khoản thường thì kiểm tra mật khẩu bình thường
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: "Mật khẩu chưa đúng rồi, cậu nhớ lại thử xem." });

        // Tạo Token
        const token = jwt.sign({ id: user._id, userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

        res.json({ 
            token, 
            user: { 
                id: user._id, 
                username: user.username, 
                email: user.email, 
                avatar: user.avatar 
            } 
        });

    } catch (error) {
        console.error("Lỗi đăng nhập:", error);
        res.status(500).json({ error: "Hệ thống đang bận chút xíu, cậu đợi mình tí nhé." });
    }
});

router.get('/google', (req, res) => {
  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: ['profile', 'email']
  });
  res.redirect(url);
});

router.get('/google/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await client.getToken(code);
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const { email, name, picture } = payload;
    const googleHwid = `google_${email}`;

    let user = await User.findOne({ $or: [{ email: email }, { hwid: googleHwid }] });
    const frontendUrl = 'https://hiencuacau.onrender.com'; // Sửa thành localhost:5173 nếu test ở máy

    if (!user) {
        // TÀI KHOẢN MỚI: Không lưu vào DB vội! Tạo Token tạm 15 phút.
        const tempToken = jwt.sign({ email, name, picture, hwid: googleHwid, isSetupToken: true }, process.env.JWT_SECRET, { expiresIn: '15m' });
        
        // Đẩy về Frontend kèm cờ ?setup=true
        const redirectUrl = `${frontendUrl}/?setup=true&tempToken=${tempToken}&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}&avatar=${encodeURIComponent(picture)}`;
        return res.redirect(redirectUrl);
    } else {
        // TÀI KHOẢN CŨ: Đăng nhập bình thường
        const jwtToken = jwt.sign({ id: user._id, userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        return res.redirect(`${frontendUrl}/?token=${jwtToken}&username=${encodeURIComponent(user.username)}&avatar=${encodeURIComponent(user.avatar || '')}&email=${encodeURIComponent(user.email || '')}`);
    }
  } catch (error) { res.redirect('https://hiencuacau.onrender.com/?error=google_auth_failed'); }
});

router.post('/google-setup', async (req, res) => {
    try {
        const { tempToken, username, password } = req.body;
        
        // Giải mã token tạm
        const decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
        if (!decoded.isSetupToken) return res.status(400).json({ error: "Mã xác thực không hợp lệ." });

        // Kiểm tra username trùng
        const existingUsername = await User.findOne({ username });
        if (existingUsername) return res.status(400).json({ error: "Tên hiển thị này đã có người dùng." });

        // Lưu vào DB với mật khẩu xịn
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({
            username, email: decoded.email, password: hashedPassword,
            avatar: decoded.picture, hwid: decoded.hwid
        });
        await newUser.save();

        // Tạo Token chính thức
        const token = jwt.sign({ id: newUser._id, userId: newUser._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: newUser._id, username: newUser.username, email: newUser.email, avatar: newUser.avatar } });

    } catch (error) {
        res.status(400).json({ error: "Phiên kết nối Google đã hết hạn. Cậu thử đăng nhập lại nhé." });
    }
});

router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });
        
        if (!user) return res.status(404).json({ error: "Email này chưa từng ghé thăm Hiên Của Cậu." });

        // Tạo mã OTP 6 số ngẫu nhiên
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Lưu OTP và Hạn sử dụng (3 phút) vào DB
        user.resetPasswordOtp = otp;
        user.resetPasswordExpires = Date.now() + 3 * 60 * 1000; 
        await user.save();

        // Gửi Email
        const mailOptions = {
            from: `"Hiên Của Cậu" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: '🌿 Mã khôi phục mật khẩu - Hiên Của Cậu',
            html: `<div style="font-family: sans-serif; text-align: center; padding: 20px;">
                     <h2>Xin chào ${user.username},</h2>
                     <p>Cậu vừa yêu cầu đặt lại mật khẩu. Đây là mã xác nhận của cậu, mã này sẽ <b>hết hạn trong 3 phút</b>:</p>
                     <h1 style="color: #0f766e; font-size: 32px; letter-spacing: 5px; background: #f0fdf4; padding: 15px; display: inline-block; border-radius: 10px;">${otp}</h1>
                     <p>Nếu cậu không yêu cầu đổi mật khẩu, hãy bỏ qua email này nhé.</p>
                   </div>`
        };

        await transporter.sendMail(mailOptions);
        res.json({ message: "Mã xác nhận đã được gửi đến email của cậu!" });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Lỗi hệ thống gửi mail. Cậu thử lại sau nhé." });
    }
});

router.post('/reset-password', async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        
        const user = await User.findOne({ 
            email, 
            resetPasswordOtp: otp, 
            resetPasswordExpires: { $gt: Date.now() } // Kiểm tra còn hạn không
        });

        if (!user) return res.status(400).json({ error: "Mã OTP không đúng hoặc đã hết hạn (quá 3 phút)." });

        // Đổi mật khẩu
        user.password = await bcrypt.hash(newPassword, 10);
        user.resetPasswordOtp = undefined; // Xóa OTP cũ
        user.resetPasswordExpires = undefined;
        await user.save();

        res.json({ message: "Mật khẩu đã được làm mới! Cậu có thể đăng nhập ngay." });

    } catch (error) {
        res.status(500).json({ error: "Lỗi hệ thống." });
    }
});

module.exports = router;