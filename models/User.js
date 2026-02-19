const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    // 1. ĐỊNH DANH CỐ ĐỊNH
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    
    // 2. TÊN HIỂN THỊ
    displayName: { type: String, trim: true },

    // 3. THÔNG TIN CƠ BẢN
    email: { type: String, required: true, trim: true },
    password: { type: String, required: true },
    avatar: { type: String, default: "" },

    // 4. NHẬN DIỆN GOOGLE OAUTH
    hwid: { type: String, default: null },

    // 5. BẢO MẬT & QUÊN MẬT KHẨU (OTP)
    resetPasswordOtp: { type: String, default: null },
    resetPasswordExpires: { type: Date, default: null },

    // 6. HỒ SƠ TÂM LÝ & TRÍ NHỚ DÀI HẠN (CỐT LÕI CỦA AI)
    userContext: { 
        type: String, 
        default: "Người dùng mới, chưa có thông tin bối cảnh cụ thể." 
    },
    
    // ĐÂY LÀ VÙNG TRÍ NHỚ MỚI CỦA CẤP ĐỘ 1:
    // Nơi AI tự động đúc kết và nhét các sự kiện quan trọng vào.
    coreMemories: {
        type: [String],
        default: []
    },

    // 7. DỮ LIỆU CÁC CÔNG CỤ TRỊ LIỆU
    moodHistory: { type: Array, default: [] },
    fireflies: { type: Array, default: [] },
    microWinsCount: { type: Number, default: 0 }

}, { 
    timestamps: true 
});

module.exports = mongoose.model('User', userSchema);