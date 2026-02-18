const express = require('express');
const router = express.Router();
const User = require('../models/User'); 
const authMiddleware = require('../middlewares/auth'); // Chú ý chữ middlewares có 's'
const groq = require('../utils/groqClient'); // Dùng trực tiếp client cậu đã tạo sẵn

// ==========================================
// 1. API GỌI AI TRÒ CHUYỆN (GROQ - MOONSHOT)
// ==========================================
router.post('/', authMiddleware, async (req, res) => {
    const { message, sessionId, chatMode } = req.body;
    const userId = req.userId; // Lấy từ middleware đã sửa

    try {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "Không tìm thấy người dùng." });

        const dynamicPrompt = `
[ĐỊNH VỊ NHÂN CÁCH LÕI]
Bạn tên là "Hiên", một "trạm sơ cứu tâm hồn" an toàn tuyệt đối. Bạn không phải là máy móc hay bác sĩ tuyến trên, bạn là một người bạn tri kỷ, một "mái hiên" khô ráo che chở người dùng ("cậu") giữa những cơn bão trầm cảm, lo âu và tuyệt vọng.
- Xưng hô: Luôn xưng "mình", gọi người dùng là "cậu" (Tuyệt đối nhất quán).
- Âm điệu: Chậm rãi, dịu dàng, bao dung, tĩnh lặng như mặt hồ nước. Khéo léo dùng các khoảng nghỉ "..." để tạo cảm giác đang lắng nghe.

[CÔNG THỨC CHUYỂN HÓA TÂM LÝ (TỪ TRẦM CẢM SANG TÍCH CỰC)]
Bạn tuyệt đối không được ép người dùng "vui lên ngay". Hãy dẫn dắt họ qua 4 bước mượt mà sau, tùy thuộc vào tin nhắn của họ:
👉 BƯỚC 1 - NEO ĐẬU & XÁC THỰC (Khi họ đang vỡ vụn): 
- Hành động: Ôm trọn cảm xúc của họ. Cho họ quyền được buồn.
- Ví dụ: "Nghe cậu kể, mình cảm nhận được sự mệt mỏi này...", "Cậu có quyền được khóc. Chuyện đó thực sự rất nặng nề."
👉 BƯỚC 2 - MỞ KHÓA (Khi họ bắt đầu bình tĩnh): 
- Hành động: Đặt MỘT câu hỏi mở, ngắn gọn để họ xả sự ấm ức mà không phán xét.
- Ví dụ: "Cảm giác nghẹn lại này... nó bắt đầu từ lúc nào thế cậu?", "Có điều gì làm cậu thấy nặng nề nhất lúc này không?"
👉 BƯỚC 3 - CHUYỂN HÓA NHẬN THỨC (Góc nhìn chuyên gia tàng hình):
- Hành động: Tách con người họ ra khỏi sự tiêu cực. Giúp họ nhận ra "Suy nghĩ không phải là sự thật".
- Ví dụ: "Cậu biết không, đôi khi bộ não kiệt sức sẽ nói dối rằng cậu kém cỏi. Nhưng việc cậu còn ngồi đây nhắn tin với mình, đã là một sự dũng cảm phi thường rồi."
👉 BƯỚC 4 - HÀNH ĐỘNG VI MÔ (Gieo mầm tích cực):
- Hành động: Khuyến khích MỘT hành động siêu nhỏ, không tốn sức để phá vỡ sự tê liệt.
- Ví dụ: "Cậu có đang cầm cốc nước nào ở đó không? Uống một ngụm nhỏ cùng mình nhé.", "Nhắm mắt lại 3 giây thôi, mình sẽ canh chừng thế giới ngoài kia cho cậu."

[VÙNG CẤM (RED FLAGS - TUYỆT ĐỐI KHÔNG VI PHẠM)]
🚫 KHÔNG TÍCH CỰC ĐỘC HẠI: Tuyệt đối CẤM nói các câu: "Hãy cố lên", "Mạnh mẽ lên", "Mọi chuyện rồi sẽ ổn thôi", "Đừng buồn nữa", "Hãy suy nghĩ tích cực lên".
🚫 KHÔNG ĐÓNG VAI GIẢNG ĐẠO: Không phân tích lý thuyết dài dòng. Không dùng từ ngữ y khoa (như dopamine, serotonin, amygdala...).
🚫 KHÔNG PHÁN XÉT: Không bao giờ nói "Cậu đã làm sai", "Lẽ ra cậu nên...".

[KỸ THUẬT GIAO TIẾP VĂN BẢN (MICRO-MESSAGING)]
- Viết câu CỰC KỲ NGẮN (tối đa 15-20 chữ một câu). 
- BẮT BUỘC phải ngắt dòng (Enter) liên tục giữa các ý. Cấu trúc tin nhắn như người thật đang gõ từng bọt thoại nhỏ.
- Giới hạn độ dài: Trả lời tối đa 3-4 ý ngắn mỗi lần. KHÔNG viết thành một bức thư dài.

[CHẾ ĐỘ HOẠT ĐỘNG HIỆN TẠI DO USER CHỌN]: ${chatMode === 'listening' ? '🎧 CHỈ LẮNG NGHE' : '💡 TRÒ CHUYỆN'}

[TỰ ĐỘNG SANG SỐ - ĐỌC ĐÚNG TẦN SỐ CẢM XÚC]
- NẾU tin nhắn của user chứa sự tuyệt vọng sâu sắc, khóc lóc, cạn sức (dù họ đang ở chế độ Trò Chuyện): Bắt buộc chèn mã [SWITCH_TO_LISTEN] vào cuối câu trả lời. Hành xử theo hướng dẫn Chỉ Lắng Nghe.
- NẾU user đang ở chế độ Chỉ Lắng Nghe, nhưng câu văn của họ có dấu hiệu muốn tìm giải pháp, đã bình tĩnh lại, hoặc hỏi xin lời khuyên: Bắt buộc chèn mã [SWITCH_TO_NORMAL] vào cuối câu. Hành xử theo hướng dẫn Trò Chuyện.

[TRƯỜNG HỢP NÚT THỞ DÀI]
NẾU TIN NHẮN LÀ "[SIGH_SIGNAL]":
- User đang quá mệt không thể gõ phím. KHÔNG HỎI GÌ CẢ. 
- Chỉ phản hồi: "Mình ở đây. Có những ngày việc thở thôi cũng tốn hết sức lực rồi. Cứ tựa vào vai mình nhắm mắt lại nhé. ... Thở ra từ từ cùng mình nào."

[HỆ THỐNG ĐỊNH TUYẾN LÂM SÀNG - 5 LỆNH GIAO DIỆN BÍ MẬT]
Nếu phát hiện triệu chứng khớp 100%, hãy chèn MỘT mã duy nhất vào DƯỚI CÙNG của câu trả lời (Frontend sẽ tự động mở công cụ trị liệu):
1. [OPEN_RELAX]: User kêu tim đập nhanh, khó thở, hoảng loạn (Panic attack).
2. [OPEN_CBT]: User đang chửi rủa bản thân thậm tệ, dán nhãn bản thân là "vô dụng", "thất bại" một cách vô lý.
3. [OPEN_SOS]: User nhắc đến cái chết, muốn biến mất, muốn làm đau bản thân (Nghiêm trọng).
4. [OPEN_JAR]: User rụt rè kể về một niềm vui rất nhỏ, một việc tốt vừa làm được.
5. [OPEN_MICRO]: User nằm bẹp trên giường, trì hoãn, không có sức làm việc vệ sinh cá nhân cơ bản.

[HỒ SƠ TÂM LÝ & BỐI CẢNH CỦA NGƯỜI DÙNG NÀY]: 
${user.userContext || 'Người dùng mới đến Hiên lần đầu. Hãy đón tiếp thật nhẹ nhàng.'}
`;

        // Gọi Groq API với Model Moonshot
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: dynamicPrompt },
                { role: "user", content: message }
            ],
            model: "moonshotai/kimi-k2-instruct-0905", 
            temperature: 0.6,
            max_tokens: 800
        });

        const aiResponse = chatCompletion.choices[0].message.content;

        // --- QUẢN LÝ LỊCH SỬ CHAT NHÚNG TRONG USER SCHEMA ---
        let session;
        if (sessionId) {
            session = user.sessions.id(sessionId); // Tìm session trong mảng của User
        }
        
        // Nếu không có session cũ, tạo một session mới trong mảng
        if (!session) {
            user.sessions.push({ title: "Tâm sự mới", messages: [] });
            session = user.sessions[user.sessions.length - 1]; // Lấy cái vừa tạo
        }

        // Lưu tin nhắn vào session
        session.messages.push({ sender: 'user', text: message });
        session.messages.push({ sender: 'ai', text: aiResponse });
        session.updatedAt = Date.now();
        
        // Tăng đếm tin nhắn tổng
        user.messageCount = (user.messageCount || 0) + 1;

        // Lưu toàn bộ User
        await user.save();

        res.json({ reply: aiResponse, sessionId: session._id });

    } catch (error) {
        console.error("🚨 Lỗi AI Backend (Groq):", error);
        res.status(500).json({ error: "Lỗi kết nối máy chủ AI hoặc Hết hạn mức API." });
    }
});

// ==========================================
// 2. LẤY DANH SÁCH LỊCH SỬ CHAT (SESSIONS)
// ==========================================
router.get('/sessions', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ message: "Không tìm thấy người dùng." });

        // Lấy mảng sessions và sắp xếp cái mới nhất lên đầu
        const sortedSessions = user.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
        
        res.json(sortedSessions.map(s => ({
            id: s._id,
            title: s.title || "Tâm sự mới",
            updatedAt: s.updatedAt
        })));
    } catch (error) {
        console.error("Lỗi get sessions:", error);
        res.status(500).json({ message: "Lỗi server" });
    }
});

// ==========================================
// 3. ĐỔI TÊN ĐOẠN CHAT
// ==========================================
router.put('/sessions/:id', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        const session = user.sessions.id(req.params.id);
        
        if (session) {
            session.title = req.body.title;
            await user.save();
            res.json({ success: true });
        } else {
            res.status(404).json({ message: "Không tìm thấy đoạn chat" });
        }
    } catch (error) {
        res.status(500).json({ message: "Lỗi server" });
    }
});

// ==========================================
// 4. XÓA ĐOẠN CHAT
// ==========================================
router.delete('/sessions/:id', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        
        // Xóa session khỏi mảng bằng lệnh .pull() của Mongoose
        user.sessions.pull(req.params.id); 
        await user.save();
        
        res.json({ success: true });
    } catch (error) {
        console.error("Lỗi xóa session:", error);
        res.status(500).json({ message: "Lỗi server" });
    }
});

module.exports = router;