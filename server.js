const express = require('express');
const cors = require('cors');
require('dotenv').config();
const mongoose = require('mongoose');

// Khởi tạo Express
const app = express();
app.use(cors());
app.use(express.json());

// Kết nối Database
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('🟢 Đã kết nối MongoDB!'))
    .catch(err => console.error('🔴 Lỗi kết nối MongoDB:', err));

// --- QUẢN LÝ ROUTES (MODULES GIAO TIẾP VỚI NHAU Ở ĐÂY) ---
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const toolRoutes = require('./routes/toolRoutes');
const chatRoutes = require('./routes/chatRoutes');

// Gắn các API vào các đường dẫn gốc
app.use('/api/auth', authRoutes);            // Sẽ xử lý /api/login, /api/register
app.use('/api/user', userRoutes);       // Sẽ xử lý /api/user/profile...
app.use('/api', toolRoutes);            // Sẽ xử lý /api/mood, /api/tts...
app.use('/api/chat', chatRoutes);       // Sẽ xử lý /api/chat/sessions...

app.get('/api/ping', (req, res) => {
  res.status(200).json({ 
    status: "ready", 
    message: "Hiên đã sẵn sàng đón cậu! 🌿",
    timestamp: new Date()
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Backend chạy siêu mượt tại port ${PORT}`));