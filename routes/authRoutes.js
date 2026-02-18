const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User'); // Đảm bảo đường dẫn tới file Model User là chính xác
const { OAuth2Client } = require('google-auth-library');

// ==========================================
// CẤU HÌNH GOOGLE OAUTH CLIENT
// ==========================================
// Nhớ điền GOOGLE_CLIENT_ID và GOOGLE_CLIENT_SECRET trong file .env nhé
const client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'https://hiencuacau-api.onrender.com/api/auth/google/callback' // Phải khớp 100% với Google Console
);

// ==========================================
// 1. API ĐĂNG KÝ (THỦ CÔNG)
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
    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      if (existingUser.username === username) {
          return res.status(400).json({ message: "Tên đăng nhập này đã có người xài mất rồi." });
      }
      if (existingUser.email === email) {
          return res.status(400).json({ message: "Email này đã được đăng ký. Cậu thử đăng nhập nhé." });
      }
    }

    // C. Tạo tài khoản mới
    const newUser = new User({ 
        username, 
        email, 
        password, // Nếu ở code cũ cậu có dùng bcrypt để mã hóa thì nhớ bọc lại nhé, nếu không thì cứ để vậy
        hwid: `manual_${Date.now()}_${Math.floor(Math.random() * 1000)}`, // Đảm bảo hwid luôn độc nhất
        userContext: '' 
    });
    
    await newUser.save();
    res.status(201).json({ message: "Tạo trạm thành công! Cậu có thể bước vào Hiên." });

  } catch (error) {
    console.error("🚨 Lỗi Đăng ký:", error);
    res.status(500).json({ message: "Lỗi máy chủ cục bộ. Cậu đợi một chút rồi thử lại nhé." });
  }
});

// ==========================================
// 2. API ĐĂNG NHẬP (THỦ CÔNG)
// ==========================================
router.post('/login', async (req, res) => {
  const { identifier, password } = req.body; 

  try {
    // Tìm user khớp với username HOẶC khớp với email
    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier }]
    });

    if (!user) {
      return res.status(400).json({ message: "Mình không tìm thấy Tên đăng nhập hoặc Email này." });
    }

    // Kiểm tra mật khẩu (Khớp với logic lưu password của cậu)
    if (password !== user.password) {
        return res.status(400).json({ message: "Mật mã bí mật chưa đúng rồi cậu ơi." });
    }

    // Tạo token và gửi thông tin về Frontend
    const jwtToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    
    res.json({ 
        token: jwtToken, 
        username: user.username, 
        email: user.email, 
        avatar: user.avatar || ''
    });

  } catch (error) {
    console.error("🚨 Lỗi Đăng nhập:", error);
    res.status(500).json({ message: "Lỗi kết nối máy chủ." });
  }
});

// ==========================================
// 3. API ĐĂNG NHẬP GOOGLE (BẮT ĐẦU CHUYỂN HƯỚNG)
// ==========================================
router.get('/google', (req, res) => {
  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: ['profile', 'email']
  });
  res.redirect(url);
});

// ==========================================
// 4. API GOOGLE CALLBACK (NHẬN KẾT QUẢ TỪ GOOGLE)
// ==========================================
router.get('/google/callback', async (req, res) => {
  const { code } = req.query;
  
  try {
    // A. Lấy token và giải mã thông tin từ Google
    const { tokens } = await client.getToken(code);
    const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: process.env.GOOGLE_CLIENT_ID,
    });
    
    const payload = ticket.getPayload();
    const email = payload.email;
    const name = payload.name;
    const picture = payload.picture; 
    const googleHwid = `google_${email}`; // Gán sẵn hwid chuẩn

    // B. THUẬT TOÁN TÌM KIẾM MỚI (CHỐNG TRÙNG LẶP E11000)
    // Tìm kiếm xem có ai sở hữu email này HOẶC hwid này chưa
    let user = await User.findOne({ 
        $or: [
            { email: email }, 
            { hwid: googleHwid }
        ] 
    });
    
    // Nếu hoàn toàn chưa có ai trong DB
    if (!user) {
        // Xử lý chống trùng Tên hiển thị (Username)
        let finalUsername = name;
        let isNameTaken = await User.findOne({ username: finalUsername });
        
        if (isNameTaken) {
            const emailPrefix = email.split('@')[0];
            finalUsername = `${name} (${emailPrefix})`;
        }

        // Tạo tài khoản mới 
        user = new User({ 
            username: finalUsername, 
            email: email, 
            password: `google_${Date.now()}_placeholder`, 
            avatar: picture,
            hwid: googleHwid,
            userContext: '' 
        });
        await user.save();

    } else {
        // C. NẾU USER ĐÃ TỒN TẠI (DO ĐĂNG NHẬP TRƯỚC ĐÓ)
        // Kiểm tra xem có cần "vá" lại dữ liệu bị thiếu không (tự chữa lành DB)
        let isModified = false;
        
        if (!user.avatar && picture) { user.avatar = picture; isModified = true; }
        if (!user.email && email) { user.email = email; isModified = true; }
        if (!user.hwid) { user.hwid = googleHwid; isModified = true; } // Vá lỗi hwid bị null
        
        if (isModified) {
            await user.save();
        }
    }

    // D. Tạo JWT Token để duy trì đăng nhập
    const jwtToken = jwt.sign({ id: user._id, userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    // E. Đẩy người dùng về lại Frontend kèm theo dữ liệu trên thanh URL
    const frontendUrl = 'https://hiencuacau.onrender.com';
    const redirectUrl = `${frontendUrl}/?token=${jwtToken}&username=${encodeURIComponent(user.username)}&avatar=${encodeURIComponent(user.avatar || '')}&email=${encodeURIComponent(user.email || '')}`;
    
    res.redirect(redirectUrl);

  } catch (error) {
    console.error("🚨 CHI TIẾT LỖI GOOGLE AUTH:", error);
    res.redirect('https://hiencuacau.onrender.com/?error=google_auth_failed');
  }
});

module.exports = router;