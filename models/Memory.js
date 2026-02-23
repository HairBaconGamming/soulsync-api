const mongoose = require('mongoose');

const memorySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true },
    sentiment: { type: String, enum: ['positive', 'negative', 'neutral'], default: 'neutral' }, // 🌟 Thêm dòng này
    embedding: { type: [Number], required: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Memory', memorySchema);