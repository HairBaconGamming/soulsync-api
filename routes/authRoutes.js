const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User'); // Đảm bảo đường dẫn này đúng
const { OAuth2Client } = require('google-auth-library');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');

require('dns').setDefaultResultOrder('ipv4first');

// ==========================================
// CẤU HÌNH GOOGLE OAUTH CLIENT
// ==========================================
const client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'https://hiencuacau-api.onrender.com/api/auth/google/callback' 
);

// Cấu hình trạm gửi Email
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // Sử dụng SSL/TLS
  auth: { 
    user: process.env.EMAIL_USER, 
    pass: process.env.EMAIL_PASS 
  }
});

// ==========================================
// 1. ĐĂNG KÝ TÀI KHOẢN (REGISTER)
// ==========================================
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // LUẬT NGHIÊM KHẮC: Bắt đầu bằng chữ cái, chỉ chứa chữ thường và số
    const usernameRegex = /^[a-z][a-z0-9]*$/;
    if (!usernameRegex.test(username)) {
      return res.status(400).json({ 
        error: "Username phải bắt đầu bằng chữ cái thường, chỉ dùng chữ và số, không có khoảng trắng cậu nhé! 🌿" 
      });
    }

    // Kiểm tra trùng Email
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      if (existingUser.hwid && existingUser.hwid.startsWith('google_')) {
        return res.status(400).json({ 
          error: "Email này đã được liên kết với Google. Cậu hãy quay lại và bấm nút 'Đăng nhập bằng Google' nhé 🌿" 
        });
      }
      return res.status(400).json({ error: "Email này đã được sử dụng rồi. Cậu thử một email khác xem sao." });
    }

    // Kiểm tra trùng Username
    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      return res.status(400).json({ error: "Username này đã có người dùng. Cậu thêm vài con số để tạo điểm nhấn nhé." });
    }

    // Mã hóa mật khẩu và lưu
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ 
      username, 
      displayName: username, // Khởi tạo DisplayName bằng Username
      email, 
      password: hashedPassword 
    });
    
    await newUser.save();
    res.status(201).json({ message: "Tuyệt vời! Cậu đã đăng ký thành công. Giờ thì đăng nhập nhé." });

  } catch (error) {
    console.error("Lỗi đăng ký:", error);
    res.status(500).json({ error: "Hệ thống đang bận chút xíu, cậu thử lại sau nhé." });
  }
});

// ==========================================
// 2. ĐĂNG NHẬP (LOGIN) - HỖ TRỢ CẢ EMAIL & USERNAME
// ==========================================
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;

    // ✅ FIX: Cho phép tìm bằng Email HOẶC Username
    const user = await User.findOne({ 
        $or: [{ email: identifier }, { username: identifier }] 
    });

    if (!user) return res.status(400).json({ error: "Mình không tìm thấy tài khoản này trong hệ thống. Cậu gõ đúng chưa?" });

    // Chặn nếu là tài khoản Google (Kiểm tra qua hwid hoặc password)
    if (user.hwid && user.hwid.startsWith('google_')) {
      return res.status(400).json({ 
        error: "Tài khoản này dùng Google để mở cửa. Cậu hãy bấm nút 'Đăng nhập bằng Google' ở bên dưới nhé ✨" 
      });
    }

    // Kiểm tra mật khẩu
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: "Mật khẩu chưa đúng rồi, cậu nhớ lại thử xem." });

    // Tạo Token
    const token = jwt.sign({ id: user._id, userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    // ✅ FIX: Trả về đầy đủ thông tin (Thêm displayName)
    res.json({ 
      token, 
      user: { 
        id: user._id, 
        username: user.username, 
        displayName: user.displayName || user.username,
        email: user.email, 
        avatar: user.avatar 
      } 
    });

  } catch (error) {
    console.error("Lỗi đăng nhập:", error);
    res.status(500).json({ error: "Hệ thống đang bận chút xíu, cậu đợi mình tí nhé." });
  }
});

// ==========================================
// 3. GOOGLE OAUTH
// ==========================================
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
    const frontendUrl = 'https://hiencuacau.onrender.com'; // Nhớ đổi thành localhost:5173 khi test local

    if (!user) {
      // TÀI KHOẢN MỚI: Truyền tempToken và hình ảnh qua URL để frontend xử lý Setup
      const tempToken = jwt.sign({ email, name, picture, hwid: googleHwid }, process.env.JWT_SECRET, { expiresIn: '15m' });
      const redirectUrl = `${frontendUrl}/?setup=true&tempToken=${tempToken}&email=${encodeURIComponent(email)}&avatar=${encodeURIComponent(picture)}`;
      return res.redirect(redirectUrl);
    } else {
      // TÀI KHOẢN CŨ: Đăng nhập bình thường
      const jwtToken = jwt.sign({ id: user._id, userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
      
      // ✅ FIX: Gửi kèm đầy đủ displayName và email về URL
      const redirectUrl = `${frontendUrl}/?token=${jwtToken}` + 
                          `&username=${encodeURIComponent(user.username)}` +
                          `&displayName=${encodeURIComponent(user.displayName || user.username)}` +
                          `&avatar=${encodeURIComponent(user.avatar || '')}` +
                          `&email=${encodeURIComponent(user.email || '')}`;
      return res.redirect(redirectUrl);
    }
  } catch (error) { 
    console.error("Lỗi Google Callback:", error);
    res.redirect('https://hiencuacau.onrender.com/?error=google_auth_failed'); 
  }
});

// ==========================================
// 4. HOÀN TẤT SETUP GOOGLE (LẦN ĐẦU)
// ==========================================
router.post('/google-setup', async (req, res) => {
  try {
    const { tempToken, username, password } = req.body;

    if (!tempToken) return res.status(400).json({ error: "Không tìm thấy mã xác thực từ Google." });

    let decoded;
    try {
      decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
    } catch (jwtErr) {
      return res.status(400).json({ error: "Phiên kết nối Google đã thực sự hết hạn hoặc không hợp lệ." });
    }

    // LUẬT NGHIÊM KHẮC CHO USERNAME
    const usernameRegex = /^[a-z][a-z0-9]*$/;
    if (!usernameRegex.test(username)) {
      return res.status(400).json({ error: "Username phải bắt đầu bằng chữ cái thường, chỉ dùng chữ và số cậu nhé!" });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ error: "Username này đã có người dùng rồi." });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      username: username,
      displayName: username, // Khởi tạo displayName
      email: decoded.email,
      password: hashedPassword,
      avatar: decoded.picture, // Lấy avatar từ Google payload
      hwid: decoded.hwid
    });
    
    await newUser.save();

    const token = jwt.sign({ id: newUser._id, userId: newUser._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    
    // ✅ FIX: Trả về đầy đủ object user
    res.json({ 
      token, 
      user: { 
        username: newUser.username, 
        displayName: newUser.displayName,
        email: newUser.email, 
        avatar: newUser.avatar 
      } 
    });

  } catch (error) {
    console.error("🚨 Lỗi Google Setup:", error);
    res.status(500).json({ error: "Lỗi hệ thống khi tạo tài khoản." });
  }
});

// ==========================================
// 5. QUÊN MẬT KHẨU (GỬI OTP)
// ==========================================
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    
    if (!user) return res.status(404).json({ error: "Email này chưa từng ghé thăm Hiên Của Cậu." });

    // Tạo mã OTP 6 số ngẫu nhiên
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Lưu OTP và Hạn sử dụng (3 phút)
    user.resetPasswordOtp = otp;
    user.resetPasswordExpires = Date.now() + 3 * 60 * 1000; 
    await user.save();

    // Gửi Email
    const mailOptions = {
      from: `"Hiên Của Cậu" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: '🌿 Mã khôi phục mật khẩu - Hiên Của Cậu',
      html: `<div style="font-family: sans-serif; text-align: center; padding: 20px;">
               <h2>Xin chào ${user.displayName || user.username},</h2>
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

// ==========================================
// 6. ĐẶT LẠI MẬT KHẨU (NHẬP OTP)
// ==========================================
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    
    const user = await User.findOne({ 
      email, 
      resetPasswordOtp: otp, 
      resetPasswordExpires: { $gt: Date.now() } // Còn hạn
    });

    if (!user) return res.status(400).json({ error: "Mã OTP không đúng hoặc đã hết hạn (quá 3 phút)." });

    // Đổi mật khẩu
    user.password = await bcrypt.hash(newPassword, 10);
    user.resetPasswordOtp = undefined; 
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ message: "Mật khẩu đã được làm mới! Cậu có thể đăng nhập ngay." });

  } catch (error) {
    res.status(500).json({ error: "Lỗi hệ thống." });
  }
});

module.exports = router;