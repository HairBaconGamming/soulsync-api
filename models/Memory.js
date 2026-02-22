const mongoose = require('mongoose');

const memorySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true },
    embedding: { type: [Number], required: true }, // 🧠 Lưu trữ Vector 384 chiều
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Memory', memorySchema);