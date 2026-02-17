require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User'); // Trỏ đúng đường dẫn tới file model của cậu

async function clearUsers() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('🟢 Đã kết nối MongoDB!');

        // Lệnh tiêu diệt toàn bộ User
        const result = await User.deleteMany({});
        console.log(`💥 Đã xóa sạch ${result.deletedCount} tài khoản trong Database!`);

        process.exit(0);
    } catch (error) {
        console.error('🔴 Lỗi:', error);
        process.exit(1);
    }
}

clearUsers();