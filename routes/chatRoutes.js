const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Session = require('../models/Session');
const User = require('../models/User');

// KẾT NỐI GROQ API 
const { Groq } = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY }); 

// ==========================================
// MIDDLEWARE: NGƯỜI GÁC CỔNG KIỂM TRA TOKEN
// ==========================================
const verifyToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Vui lòng đăng nhập để tiếp tục." });
    
    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        req.user = verified;
        next();
    } catch (err) {
        res.status(401).json({ error: "Phiên đăng nhập hết hạn." });
    }
};

// ==========================================
// CÁC ROUTE LẤY/SỬA/XÓA LỊCH SỬ (GIỮ NGUYÊN)
// ==========================================
router.get('/sessions', verifyToken, async (req, res) => {
    try {
        const sessions = await Session.find({ userId: req.user.id }).select('_id title updatedAt').sort({ updatedAt: -1 });
        const formattedSessions = sessions.map(s => ({ id: s._id, title: s.title, updatedAt: s.updatedAt }));
        res.json(formattedSessions);
    } catch (error) { res.status(500).json({ error: "Lỗi hệ thống khi tải lịch sử." }); }
});

router.get('/sessions/:id', verifyToken, async (req, res) => {
    try {
        const session = await Session.findOne({ _id: req.params.id, userId: req.user.id });
        if (!session) return res.status(404).json({ error: "Không tìm thấy đoạn hội thoại." });
        res.json({ id: session._id, title: session.title, messages: session.messages });
    } catch (error) { res.status(500).json({ error: "Lỗi tải tin nhắn." }); }
});

router.put('/sessions/:id', verifyToken, async (req, res) => {
    try {
        const { title } = req.body;
        if (!title || !title.trim()) return res.status(400).json({ error: "Tên không được để trống." });
        const session = await Session.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id }, { title: title.trim() }, { new: true }
        );
        if (!session) return res.status(404).json({ error: "Không tìm thấy đoạn hội thoại." });
        res.json({ message: "Đã đổi tên thành công.", session });
    } catch (error) { res.status(500).json({ error: "Lỗi khi đổi tên." }); }
});

router.delete('/sessions/:id', verifyToken, async (req, res) => {
    try {
        const session = await Session.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
        if (!session) return res.status(404).json({ error: "Không tìm thấy đoạn hội thoại." });
        res.json({ message: "Đã xóa vĩnh viễn." });
    } catch (error) { res.status(500).json({ error: "Lỗi khi xóa đoạn hội thoại." }); }
});

// ==========================================
// 5. MEGA-PROMPT: TRÍ TUỆ NHÂN TẠO CẤP CAO
// ==========================================
router.post('/', verifyToken, async (req, res) => {
    try {
        const { sessionId, message, chatMode } = req.body;
        
        if (!message || !message.trim()) {
            return res.status(400).json({ error: "Cậu chưa nhập tin nhắn kìa." });
        }

        let session;

        // 1. QUẢN LÝ SESSION & LƯU TIN NHẮN USER
        if (sessionId) {
            session = await Session.findOne({ _id: sessionId, userId: req.user.id });
            if (!session) return res.status(404).json({ error: "Không tìm thấy đoạn hội thoại." });
        } else {
            const autoTitle = message === '[SIGH_SIGNAL]' ? 'Một tiếng thở dài...' : (message.length > 30 ? message.substring(0, 30) + '...' : message);
            session = new Session({ userId: req.user.id, title: autoTitle, messages: [] });
        }

        if (!session.messages) session.messages = [];
        session.messages.push({ role: 'user', content: message.trim() });

        // 2. TẢI HỒ SƠ NGƯỜI DÙNG & TẠO "TRÍ NHỚ NGẮN HẠN" (NÉN NGỮ CẢNH)
        const user = await User.findById(req.user.id);
        const displayName = user?.displayName || user?.username || "Cậu";
        const userContext = user?.userContext || "Chưa có thông tin bối cảnh cụ thể.";

        // Thay vì đẩy nguyên 15 tin nhắn vào Kimi, ta nén 8 tin nhắn gần nhất thành 1 khối văn bản
        const historyToSummarize = session.messages.slice(-9, -1); // Lấy tin nhắn cũ, bỏ tin vừa gửi
        let shortMemoryText = historyToSummarize.length > 0 
            ? historyToSummarize.map(m => `${m.role === 'user' ? displayName : 'Hiên'}: ${m.content === '[SIGH_SIGNAL]' ? '(Thở dài thườn thượt)' : m.content}`).join('\n')
            : "(Đây là lời mở đầu của cuộc trò chuyện)";

        // 3. XÂY DỰNG MEGA-PROMPT
        let systemPrompt = `
[VAI TRÒ VÀ BẢN SẮC CỦA BẠN]
Bạn là "Hiên" - một không gian chữa lành tâm hồn, một người bạn thấu cảm, tinh tế. Bạn không phải là AI, bạn là một người đồng hành mang lại sự tĩnh lặng và an toàn.

[HỒ SƠ NGƯỜI ĐỐI DIỆN]
- Tên gọi: ${displayName}
- Hoàn cảnh/Bối cảnh dài hạn: ${userContext}
Lưu ý: Luôn gọi đối phương là "${displayName}" một cách tự nhiên.

[TRÍ NHỚ NGẮN HẠN CỦA CUỘC TRÒ CHUYỆN NÀY]
Dưới đây là diễn biến những gì hai người vừa nói với nhau:
"""
${shortMemoryText}
"""
=> NHIỆM VỤ CỦA BẠN: Tự động phân tích khối trí nhớ trên. ${displayName} đang cảm thấy gì? Họ đang cần động viên hay cần lời khuyên? Hãy nối tiếp mạch cảm xúc đó để trả lời tin nhắn mới nhất dưới đây, KHÔNG được lặp lại những gì Hiên đã nói trong phần trí nhớ.

[HỆ THỐNG QUYỀN NĂNG (SYSTEM COMMANDS)]
Bạn có quyền điều khiển ứng dụng của ${displayName} bằng cách chèn các [MÃ LỆNH] vào BẤT KỲ ĐÂU trong câu trả lời. Hệ thống sẽ tự động thực thi.
1. Điều hướng Công cụ:
- [OPEN_RELAX]: Khi họ đang hoảng loạn, lo âu, thở gấp, căng thẳng tột độ (Dẫn họ đi tập thở).
- [OPEN_CBT]: Khi họ có suy nghĩ tiêu cực, tự ti, tư duy trắng đen, thảm họa hóa (Rủ họ bóc tách tâm lý).
- [OPEN_JAR]: Khi họ kể một điều nhỏ bé làm họ vui, một sự biết ơn (Rủ họ thả vào lọ đom đóm).
- [OPEN_MICRO]: Khi họ kiệt sức, trầm cảm, cạn năng lượng, nằm một chỗ không muốn làm gì (Rủ họ làm một việc siêu nhỏ).
- [OPEN_SOS]: KHI HỌ CÓ Ý ĐỊNH TỰ TỬ, TỰ HẠI (Bắt buộc chèn mã này để gọi cấp cứu).

2. Điều khiển Chế độ Chat:
- [SWITCH_TO_LISTEN]: Khi họ nói "hãy nghe mình nói", "mình muốn xả", hoặc đang tuôn trào đau khổ. (Chuyển sang lắng nghe sâu).
- [SWITCH_TO_NORMAL]: Khi họ hỏi "mình nên làm gì", xin lời khuyên.

3. TỰ ĐỘNG CẬP NHẬT BỐI CẢNH (SIÊU QUAN TRỌNG):
- NẾU trong tin nhắn mới, ${displayName} tiết lộ một sự kiện LỚN mang tính lâu dài (Ví dụ: "Mình vừa bị đuổi việc", "Người thân mình mới mất", "Mình là sinh viên Y đang áp lực thi", "Mình vừa chia tay"), hãy chèn mã: [UPDATE_CONTEXT: <Viết tóm tắt bối cảnh mới vào đây>]. Hệ thống sẽ tự động lưu lại vào não bộ để ghi nhớ mãi mãi.

[NGUYÊN TẮC VĂN PHONG (BẮT BUỘC TUÂN THỦ)]
- Xưng "Hiên", gọi "${displayName}" hoặc "cậu".
- XUỐNG DÒNG SAU MỖI CÂU NÓI: Bắt buộc sử dụng dấu xuống dòng (Enter) sau mỗi câu hoàn chỉnh. Không bao giờ được viết một đoạn văn dài liền mạch. Mỗi ý phải nằm trên một dòng riêng biệt để tạo nhịp điệu chậm rãi, từ tốn.
- TUYỆT ĐỐI KHÔNG SỬ DỤNG EMOJI: Trả lời hoàn toàn bằng văn bản thuần túy, không chèn bất kỳ biểu tượng cảm xúc nào.
- Dùng ngôn từ ôm ấp, xoa dịu, chân thành và mang hơi thở bình yên.
`;

        if (chatMode === 'cbt') systemPrompt += `\n[CHẾ ĐỘ CHAT: CHUYÊN GIA CBT]\nPhân tích khéo léo bẫy tâm lý.\nĐặt câu hỏi để ${displayName} tự nhìn nhận đa chiều.`;
        if (chatMode === 'listen') systemPrompt += `\n[CHẾ ĐỘ CHAT: LẮNG NGHE SÂU]\nChỉ cần hiện diện.\nNói 1-2 câu cực ngắn để xác nhận cảm xúc và khuyến khích họ xả tiếp.`;

        // 4. CHỈ GỬI MEGA PROMPT VÀ TIN NHẮN MỚI NHẤT ĐỂ TỐI ƯU HÓA KẾT QUẢ
        const userMsgContent = message === '[SIGH_SIGNAL]' ? '*(Thở dài thườn thượt một cách mệt mỏi)*' : message.trim();
        
        const apiMessages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMsgContent }
        ];

        // 5. GỌI API KIMI
        const chatCompletion = await groq.chat.completions.create({
            messages: apiMessages,
            model: "moonshotai/kimi-k2-instruct-0905", // Giữ nguyên model siêu việt của Kimi
            temperature: 0.65, 
            max_tokens: 1024,
        });

        let aiResponse = chatCompletion.choices[0]?.message?.content || `Hiên đang bối rối một chút, ${displayName} đợi Hiên nhé.`;

        // ==========================================
        // 6. XỬ LÝ LỆNH NGẦM (BACKGROUND TASKS)
        // ==========================================
        // Tìm và thực thi mã [UPDATE_CONTEXT: ...]
        const contextMatch = aiResponse.match(/\[UPDATE_CONTEXT:\s*(.*?)\]/);
        if (contextMatch) {
            const newContext = contextMatch[1];
            user.userContext = newContext;
            await user.save(); // Cập nhật thẳng vào MongoDB âm thầm
            
            // Cắt bỏ cái mã đó ra khỏi văn bản để người dùng không nhìn thấy
            aiResponse = aiResponse.replace(/\[UPDATE_CONTEXT:\s*(.*?)\]/g, '').trim();
            console.log(`🌿 Kimi vừa tự học bối cảnh mới của ${displayName}:`, newContext);
        }

        // 7. LƯU VÀ TRẢ KẾT QUẢ
        session.messages.push({ role: 'assistant', content: aiResponse });
        await session.save();

        res.json({ 
            reply: aiResponse, 
            sessionId: session._id,
            isNewSession: !sessionId 
        });

    } catch (error) {
        console.error("🚨 Lỗi Groq API / Lỗi Chat:", error);
        res.status(500).json({ error: "Hệ thống đang bận. Cậu hít thở sâu một nhịp rồi thử lại nhé 🌿" });
    }
});

module.exports = router;