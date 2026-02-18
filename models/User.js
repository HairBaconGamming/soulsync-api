const mongoose = require('mongoose');

const SessionSchema = new mongoose.Schema({
    title: { type: String, default: "Cuộc trò chuyện mới" },
    messages: { type: Array, default: [] },
    updatedAt: { type: Date, default: Date.now },
    isPinned: { type: Boolean, default: false }
});

const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    resetPasswordOtp: { type: String, default: null },
    resetPasswordExpires: { type: Date, default: null }
    userContext: { type: String, default: "Người dùng mới, chưa có thông tin." }, 
    sessions: [SessionSchema], 
    moodHistory: [{ 
        date: String, 
        mood: String,
        note: { type: String, default: "" } // THÊM DÒNG NÀY: Lưu ghi chú nhật ký
    }],
    microWinsCount: { type: Number, default: 0 },
    fireflies: [{ // THÊM DÒNG NÀY: Lưu ký ức đom đóm
        text: String, 
        createdAt: { type: Date, default: Date.now } 
    }],
    hwid: { 
        type: String, 
        unique: true, 
        sparse: true // <--- THÊM DÒNG NÀY: Bỏ qua kiểm tra trùng lặp nếu giá trị là null
    },
    messageCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);