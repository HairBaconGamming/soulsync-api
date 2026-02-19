const mongoose = require('mongoose');

// Cấu trúc cho một tin nhắn đơn lẻ
const messageSchema = new mongoose.Schema({
    role: { 
        type: String, 
        enum: ['user', 'assistant', 'system'], 
        required: true 
    },
    content: { 
        type: String, 
        required: true 
    },
    timestamp: { 
        type: Date, 
        default: Date.now 
    }
}, { _id: false }); // Không cần tạo ID riêng cho từng dòng tin nhắn cho nhẹ DB

// Cấu trúc cho toàn bộ cuộc hội thoại (Session)
const sessionSchema = new mongoose.Schema({
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', // Liên kết trực tiếp tới file User.js
        required: true 
    },
    title: { 
        type: String, 
        default: 'Tâm sự mới' 
    },
    // ĐÂY CHÍNH LÀ CHÌA KHÓA FIX LỖI ".PUSH": 
    // Chúng ta khởi tạo mặc định là một mảng rỗng [] để nó không bao giờ bị undefined
    messages: { 
        type: [messageSchema], 
        default: [] 
    }
}, { 
    timestamps: true 
});

module.exports = mongoose.model('Session', sessionSchema);