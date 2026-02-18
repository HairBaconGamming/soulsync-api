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

// ==========================================
// 1. API ĐĂNG KÝ (CẦN USERNAME VIẾT LIỀN & EMAIL)
// ==========================================
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  try {
    // A. Kiểm tra định dạng Username (Chỉ chữ và số, không khoảng trắng, không ký tự đặc biệt)
    const usernameRegex = /^[a-zA-Z0-9]+$/;
    if (!usernameRegex.test(username)) {
      return res.status(400).json({ message: "Tên đăng nhập phải viết liền, không dấu và không chứa ký tự đặc biệt nhé cậu." });
    }

    // B. Kiểm tra xem Username hoặc Email đã có ai dùng chưa
    // LƯU Ý: Cách này an toàn hơn việc set unique trong Database, tránh lỗi E11000 sập server
    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      if (existingUser.username === username) return res.status(400).json({ message: "Tên đăng nhập này đã có người xài mất rồi." });
      if (existingUser.email === email) return res.status(400).json({ message: "Email này đã được đăng ký. Cậu thử đăng nhập nhé." });
    }

    // C. Tạo tài khoản
    const newUser = new User({ 
        username, 
        email, 
        password, // Lưu ý: Cậu nhớ bọc bcrypt.hash() ở đây nếu code cũ của cậu có mã hóa mật khẩu nhé
        hwid: `manual_${Date.now()}` // Tạo hwid ngẫu nhiên cho tài khoản thủ công
    });
    await newUser.save();

    res.status(201).json({ message: "Tạo trạm thành công! Cậu có thể bước vào Hiên." });
  } catch (error) {
    res.status(500).json({ message: "Lỗi máy chủ cục bộ." });
  }
});

// ==========================================
// 2. API ĐĂNG NHẬP (BẰNG USERNAME HOẶC EMAIL ĐỀU ĐƯỢC)
// ==========================================
router.post('/login', async (req, res) => {
  const { identifier, password } = req.body; // Đổi tên biến thành identifier (định danh)

  try {
    // Tìm user khớp với username HOẶC khớp với email
    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier }]
    });

    if (!user) {
      return res.status(400).json({ message: "Mình không tìm thấy Tên đăng nhập hoặc Email này." });
    }

    // Kiểm tra mật khẩu (Sửa lại khớp với logic bcrypt của cậu nếu có)
    if (password !== user.password) {
        return res.status(400).json({ message: "Mật mã bí mật chưa đúng rồi cậu ơi." });
    }

    // Tạo token và gửi về kèm email, avatar
    const jwtToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ 
        token: jwtToken, 
        username: user.username, 
        email: user.email, 
        avatar: user.avatar 
    });

  } catch (error) {
    res.status(500).json({ message: "Lỗi kết nối máy chủ." });
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