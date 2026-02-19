const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    // 1. ĐỊNH DANH CỐ ĐỊNH (Không thể thay đổi, dùng để hệ thống nhận diện)
    username: { 
        type: String, 
        required: true, 
        unique: true,
        lowercase: true,
        trim: true
    },
    
    // 2. TÊN HIỂN THỊ (Người dùng có thể tự do thay đổi)
    displayName: { 
        type: String,
        trim: true
    },

    // 3. THÔNG TIN CƠ BẢN
    email: { 
        type: String, 
        required: true,
        trim: true
    },
    password: { 
        type: String, 
        required: true 
    },
    avatar: { 
        type: String, 
        default: "" 
    },

    // 4. NHẬN DIỆN GOOGLE OAUTH
    hwid: { 
        type: String, 
        default: null 
    },

    // 5. BẢO MẬT & QUÊN MẬT KHẨU (OTP)
    resetPasswordOtp: { 
        type: String, 
        default: null 
    },
    resetPasswordExpires: { 
        type: Date, 
        default: null 
    },

    // 6. HỒ SƠ TÂM LÝ (Dành cho AI hiểu ngữ cảnh người dùng)
    userContext: { 
        type: String, 
        default: "Người dùng mới, chưa có thông tin. Hãy chia sẻ một chút về cậu nhé..." 
    }
}, { 
    // Tự động thêm createdAt (Ngày tham gia) và updatedAt (Lần cập nhật cuối)
    timestamps: true 
});

module.exports = mongoose.model('User', userSchema);