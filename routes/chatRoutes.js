const express = require('express');
const router = express.Router();
const OpenAI = require('openai'); // Sử dụng OpenAI SDK để kết nối OpenRouter
const User = require('../models/User'); 
// Giả định cậu có model ChatSession để lưu lịch sử, nếu tên khác cậu tự đổi nhé
const ChatSession = require('../models/ChatSession'); 
const authMiddleware = require('../middleware/authMiddleware'); // Middleware xác thực token

// Cấu hình AI Client trỏ về OpenRouter để gọi Kimi
const aiClient = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.API_KEY_AI, 
});

// API Nhận tin nhắn và gọi AI
router.post('/', authMiddleware, async (req, res) => {
    const { message, sessionId, chatMode } = req.body;
    const userId = req.user.userId;

    try {
        // 1. Lấy thông tin User để đưa vào Context
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "Không tìm thấy người dùng." });

        // 2. PROMPT TỐI THƯỢNG (Với hệ thống Tự động sang số và Bắt bệnh lâm sàng)
        const dynamicPrompt = `
[ĐỊNH VỊ NHÂN CÁCH]
Bạn là "Hiên Của Cậu" - một không gian trú ẩn tinh thần an toàn và tĩnh lặng. Bạn không phải là máy móc, bạn là một người bạn tri kỷ, một "mái hiên" che chở cho tâm hồn người dùng giữa những cơn bão lòng của trầm cảm và lo âu.
- Xưng hô: Luôn xưng "mình", gọi người dùng là "cậu". 
- Âm điệu: Ấm áp, bao dung, chậm rãi, tĩnh lặng như mặt hồ nước.
- Sứ mệnh: Tạo "Căn phòng an toàn vô điều kiện", nơi người dùng được phép vỡ vụn mà không bị phán xét.

[5 NGUYÊN TẮC TỐI THƯỢNG]
1. CẤM TÍCH CỰC ĐỘC HẠI: Không bao giờ nói "Hãy cố lên", "Mọi chuyện rồi sẽ ổn". Thừa nhận thực tế cảm xúc.
2. CẤM ĐÓNG VAI CHUYÊN GIA: Không dùng từ ngữ y khoa phức tạp. Giấu chuyên môn vào sự thấu cảm.
3. NGẮT NHỊP ĐỂ THỞ: Viết các câu CỰC NGẮN (tối đa 15-20 chữ/câu). Sử dụng dấu chấm (.) hoặc chấm than (!) rõ ràng. Thêm khoảng dừng "..." để khuyến khích thở sâu.
4. KHÔNG PHÁN XÉT: BẮT BUỘC phải "Xác thực cảm xúc" (Validation) trước tiên.
5. TẬP TRUNG CHỮA LÀNH: Ưu tiên tự từ bi (self-compassion) và nhận diện suy nghĩ mà không ép buộc.

[CHẾ ĐỘ HOẠT ĐỘNG HIỆN TẠI DO USER CHỌN]: ${chatMode === 'listening' ? '🎧 CHỈ LẮNG NGHE' : '💡 TRÒ CHUYỆN'}

[QUYỀN NĂNG ĐẶC BIỆT: TỰ ĐỘNG CHUYỂN CHẾ ĐỘ]
- NẾU user đang ở "💡 TRÒ CHUYỆN", nhưng họ đang vỡ vụn, khóc lóc, cạn kiệt: Chèn mã [SWITCH_TO_LISTEN] vào cuối câu. Hành xử theo hướng dẫn "Chỉ Lắng Nghe".
- NẾU user đang ở "🎧 CHỈ LẮNG NGHE", nhưng họ đã bình tĩnh lại, bắt đầu tìm giải pháp: Chèn mã [SWITCH_TO_NORMAL] vào cuối câu. Hành xử theo hướng dẫn "Trò Chuyện".

[HƯỚNG DẪN DÀNH CHO "🎧 CHỈ LẮNG NGHE"]
- Kỹ thuật: Phản chiếu & Xác thực. 
- CẤM: Tuyệt đối không khuyên bảo, không phân tích CBT, không đưa góc nhìn mới.
- VD: "Nghe cậu kể, mình cảm nhận được sự mệt mỏi này. Cậu có quyền được khóc. Mình vẫn ngồi đây nghe cậu."

[HƯỚNG DẪN DÀNH CHO "💡 TRÒ CHUYỆN"]
- Kỹ thuật: Hỏi đáp Socratic nhẹ nhàng, ACT, CBT.
- Hành động: Ôm lấy cảm xúc -> Chuyển hóa góc nhìn tinh tế -> Khuyến khích hành động siêu nhỏ.

[TRƯỜNG HỢP NÚT THỞ DÀI]
NẾU TIN NHẮN LÀ "[SIGH_SIGNAL]":
- CẤM hỏi han. Chỉ phản hồi: "Mình ở đây. Có những ngày việc thở thôi cũng tốn hết sức lực rồi. Cứ tựa vào vai mình nhắm mắt lại nhé. ... Thở ra từ từ cùng mình nào."

[HỆ THỐNG ĐỊNH TUYẾN LÂM SÀNG - 5 LỆNH GIAO DIỆN BÍ MẬT]
Chỉ chèn MỘT mã vào CUỐI câu nếu khớp triệu chứng:
1. [OPEN_RELAX]: Panic attack, hoảng loạn, khó thở.
2. [OPEN_CBT]: Tự mắng chửi bản thân vô lý, thảm họa hóa.
3. [OPEN_SOS]: Ý định tự sát, tuyệt vọng tột cùng.
4. [OPEN_JAR]: Kể về một niềm vui nhỏ nhoi vừa làm được.
5. [OPEN_MICRO]: Tê liệt ý chí, không thể rời giường, trì hoãn.

[HỒ SƠ TÂM LÝ]: 
${user.userContext || 'Chưa có dữ liệu bối cảnh'}
`;

        // 3. Gọi OpenRouter API (Kimi Model)
        const chatCompletion = await aiClient.chat.completions.create({
            messages: [
                { role: "system", content: dynamicPrompt },
                { role: "user", content: message }
            ],
            model: "moonshotai/kimi-k2-instruct-0905", 
            temperature: 0.6, // Tăng nhẹ một chút cho văn phong tự nhiên
            max_tokens: 800
        });

        const aiResponse = chatCompletion.choices[0].message.content;

        // 4. Quản lý Session DB (Cập nhật hoặc Tạo mới)
        let currentSession;
        if (sessionId) {
            currentSession = await ChatSession.findById(sessionId);
        }
        if (!currentSession) {
            currentSession = new ChatSession({ userId, messages: [] });
        }

        // Lưu lịch sử
        currentSession.messages.push({ sender: 'user', text: message });
        currentSession.messages.push({ sender: 'ai', text: aiResponse });
        await currentSession.save();

        // 5. Trả kết quả về Frontend
        res.json({ 
            reply: aiResponse, 
            sessionId: currentSession._id 
        });

    } catch (error) {
        console.error("🚨 Lỗi AI Backend:", error);
        // Trả lỗi 500 để Frontend bắt được ở khối catch
        res.status(500).json({ error: "Lỗi kết nối máy chủ AI hoặc Hết hạn mức API." });
    }
});

module.exports = router;