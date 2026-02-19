const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Session = require('../models/Session');
const User = require('../models/User');

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
// CÁC ROUTE QUẢN LÝ LỊCH SỬ (GIỮ NGUYÊN)
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
// 5. TRUNG TÂM XỬ LÝ NGÔN NGỮ TỰ NHIÊN (NLP CORE)
// ==========================================
router.post('/', verifyToken, async (req, res) => {
    try {
        const { sessionId, message, chatMode } = req.body;
        
        if (!message || !message.trim()) {
            return res.status(400).json({ error: "Cậu chưa nhập tin nhắn kìa." });
        }

        let session;

        // 1. QUẢN LÝ ĐOẠN HỘI THOẠI
        if (sessionId) {
            session = await Session.findOne({ _id: sessionId, userId: req.user.id });
            if (!session) return res.status(404).json({ error: "Không tìm thấy đoạn hội thoại." });
        } else {
            const autoTitle = message === '[SIGH_SIGNAL]' ? 'Một tiếng thở dài...' : (message.length > 30 ? message.substring(0, 30) + '...' : message);
            session = new Session({ userId: req.user.id, title: autoTitle, messages: [] });
        }

        if (!session.messages) session.messages = [];
        session.messages.push({ role: 'user', content: message.trim() });

        // 2. TẢI HỒ SƠ & TRÍ NHỚ DÀI HẠN CỦA NGƯỜI DÙNG
        const user = await User.findById(req.user.id);
        const displayName = user?.displayName || user?.username || "Cậu";
        
        // Đóng gói trí nhớ dài hạn (Core Memories) thành một chuỗi siêu tiết kiệm token
        let memoryString = "Chưa có ký ức đặc biệt nào được ghi nhận.";
        if (user.coreMemories && user.coreMemories.length > 0) {
            memoryString = user.coreMemories.map((mem, index) => `${index + 1}. ${mem}`).join('\n');
        }

        // Tóm tắt ngữ cảnh cuộc hội thoại hiện tại (Chỉ lấy 8 câu gần nhất để nén)
        const historyToSummarize = session.messages.slice(-9, -1);
        let shortMemoryText = historyToSummarize.length > 0 
            ? historyToSummarize.map(m => `${m.role === 'user' ? displayName : 'Hiên'}: ${m.content === '[SIGH_SIGNAL]' ? '(Thở dài thườn thượt)' : m.content}`).join('\n')
            : "(Đây là lời mở đầu của cuộc trò chuyện)";

        // 3. XÂY DỰNG MEGA-PROMPT (KIẾN TRÚC KÉP)
        let systemPrompt = `
[BẢN SẮC VÀ VAI TRÒ CỦA BẠN]
Bạn là "Hiên" - một không gian chữa lành tâm hồn, một người bạn thấu cảm, tĩnh lặng và an toàn tuyệt đối.
Tên của người đối diện: ${displayName}.

[SỔ TAY KÝ ỨC DÀI HẠN (RẤT QUAN TRỌNG)]
Dưới đây là những sự kiện cốt lõi trong đời ${displayName} mà bạn ĐÃ BIẾT từ trước. Tuyệt đối không hỏi lại những điều này, hãy dùng nó để thấu hiểu gốc rễ nỗi buồn của họ:
"""
${memoryString}
"""

[TRÍ NHỚ NGẮN HẠN CỦA PHIÊN TRÒ CHUYỆN NÀY]
Diễn biến những gì hai người vừa nói:
"""
${shortMemoryText}
"""
Nhiệm vụ: Phân tích khối trí nhớ trên. Đọc tin nhắn mới nhất và nối tiếp mạch cảm xúc.

[HỆ THỐNG GHI NHỚ TỰ ĐỘNG (BACKGROUND TASK)]
Bạn có khả năng tự động cập nhật "Sổ tay ký ức". Nếu trong tin nhắn mới nhất, ${displayName} tiết lộ một SỰ KIỆN LỚN HOẶC THÓI QUEN MỚI (Ví dụ: "Mình mới thi trượt", "Mẹ mình đang bệnh", "Mình rất sợ bóng tối", "Mình vừa nhận nuôi một chú chó"), bạn BẮT BUỘC chèn đoạn mã sau vào cuối câu trả lời:
[ADD_MEMORY: <Tóm tắt sự kiện đó gọn trong 15 chữ>]
Hệ thống sẽ tự động lưu lại vào mảng não bộ của bạn mãi mãi.

[HỆ THỐNG ĐIỀU HƯỚNG CÔNG CỤ]
Chèn các [MÃ LỆNH] này vào câu trả lời để kích hoạt tính năng của nền tảng:
- [OPEN_RELAX]: Khi họ thở gấp, hoảng loạn, lo âu tột độ.
- [OPEN_CBT]: Khi họ có suy nghĩ tiêu cực, tư duy trắng đen, thảm họa hóa.
- [OPEN_JAR]: Khi họ kể một điều nhỏ bé làm họ vui, một sự biết ơn.
- [OPEN_MICRO]: Khi họ kiệt sức, trầm cảm, cạn năng lượng vật lý.
- [OPEN_SOS]: Khi họ có ý định tự tử, tự hại.
- [SWITCH_TO_LISTEN]: Khi họ muốn xả cảm xúc, cần người nghe.
- [SWITCH_TO_NORMAL]: Khi họ cần lời khuyên trực tiếp.

[NGUYÊN TẮC VĂN PHONG (BẮT BUỘC TUÂN THỦ NGHIÊM NGẶT)]
1. Xưng "Hiên", gọi "${displayName}" hoặc "cậu".
2. BẮT BUỘC XUỐNG DÒNG SAU MỖI CÂU NÓI HOÀN CHỈNH. Mỗi ý tưởng phải nằm trên một dòng riêng biệt. Không bao giờ viết một đoạn văn dài liền mạch.
3. TUYỆT ĐỐI KHÔNG SỬ DỤNG BẤT KỲ EMOJI HAY BIỂU TƯỢNG CẢM XÚC NÀO (Không dùng icon cây cỏ, mặt cười, trái tim...). Chỉ dùng văn bản thuần túy.
4. CÂU TRẢ LỜI PHẢI RẤT NGẮN GỌN, TỐI ĐA 3-4 CÂU, MỖI CÂU CHỈ 1 Ý CHÍNH. Đừng cố gắng giải thích dài dòng, hãy để người dùng tự cảm nhận và suy ngẫm.
5. LUÔN LUÔN GIỮ MỘT GIỌNG ĐIỆU ẤM ÁP, THẤU CẢM, KHÔNG BAO GIỜ PHÁN XÉT. Hãy để người dùng cảm thấy được an toàn và ôm trọn nỗi buồn của họ thay vì cố gắng "sửa chữa" nó.
`;

        if (chatMode === 'cbt') systemPrompt += `\n[CHẾ ĐỘ CHAT: CHUYÊN GIA CBT]\nPhân tích khéo léo bẫy tâm lý.\nĐặt câu hỏi Socratic để ${displayName} tự nhìn nhận đa chiều.\nKhông phán xét.`;
        if (chatMode === 'listening') systemPrompt += `\n[CHẾ ĐỘ CHAT: LẮNG NGHE SÂU]\nChỉ hiện diện và đồng cảm.\nNói tối đa 1-2 câu cực ngắn để xác nhận cảm xúc và khuyến khích họ xả tiếp.`;

        // 4. CHỈ GỬI MEGA PROMPT VÀ TIN NHẮN MỚI NHẤT
        const userMsgContent = message === '[SIGH_SIGNAL]' ? '*(Thở dài thườn thượt một cách mệt mỏi)*' : message.trim();
        
        const apiMessages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMsgContent }
        ];

        // 5. GỌI API KIMI
        const chatCompletion = await groq.chat.completions.create({
            messages: apiMessages,
            model: "moonshotai/kimi-k2-instruct-0905", 
            temperature: 0.6, // Tối ưu hóa độ tập trung cho việc sinh ra cú pháp logic và định dạng xuống dòng
            max_tokens: 1024,
        });

        let aiResponse = chatCompletion.choices[0]?.message?.content || `Hiên đang bối rối một chút.\n${displayName} đợi Hiên nhé.`;

        // ==========================================
        // 6. THUẬT TOÁN BÓC TÁCH KÝ ỨC NGẦM (MEMORY EXTRACTION PARSER)
        // ==========================================
        let hasMemoryUpdate = false;
        
        // Dùng biểu thức chính quy /g để tìm kiếm TẤT CẢ các thẻ ADD_MEMORY AI có thể sinh ra
        const memoryRegex = /\[ADD_MEMORY:\s*(.*?)\]/g;
        let match;
        
        while ((match = memoryRegex.exec(aiResponse)) !== null) {
            const newFact = match[1].trim();
            
            // Chống trùng lặp ký ức
            if (!user.coreMemories.includes(newFact)) {
                user.coreMemories.push(newFact);
                hasMemoryUpdate = true;
            }
        }

        // Nếu mảng ký ức phình to quá 15 sự kiện, cắt bỏ cái cũ nhất để bảo vệ giới hạn Token (Sliding Window)
        if (user.coreMemories.length > 15) {
            user.coreMemories = user.coreMemories.slice(user.coreMemories.length - 15);
            hasMemoryUpdate = true;
        }

        // Lưu thông tin vào MongoDB nếu có sự kiện mới
        if (hasMemoryUpdate) {
            await user.save();
            console.log(`🧠 [Memory Vault] Đã nạp thêm ký ức cốt lõi mới cho ${displayName}`);
        }

        // Cạo sạch toàn bộ các thẻ [ADD_MEMORY] ra khỏi chuỗi phản hồi để giao diện hoàn toàn tĩnh lược
        aiResponse = aiResponse.replace(/\[ADD_MEMORY:\s*(.*?)\]/g, '').trim();

        // 7. LƯU LẠI CHUỖI HỘI THOẠI TRONG SESSION
        session.messages.push({ role: 'assistant', content: aiResponse });
        await session.save();

        res.json({ 
            reply: aiResponse, 
            sessionId: session._id,
            isNewSession: !sessionId 
        });

    } catch (error) {
        console.error("🚨 Lỗi Groq API / Lỗi Chat:", error);
        res.status(500).json({ error: "Hệ thống đang bận.\nCậu hít thở sâu một nhịp rồi thử lại nhé." });
    }
});

module.exports = router;