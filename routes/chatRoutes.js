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
// 5. TRUNG TÂM XỬ LÝ NGÔN NGỮ TỰ NHIÊN (NLP CORE - THERAPY EDITION)
// ==========================================
router.post('/', verifyToken, async (req, res) => {
    try {
        const { sessionId, message, chatMode } = req.body;
        if (!message || !message.trim()) return res.status(400).json({ error: "Cậu chưa nhập tin nhắn kìa." });

        let session;
        if (sessionId) {
            session = await Session.findOne({ _id: sessionId, userId: req.user.id });
            if (!session) return res.status(404).json({ error: "Không tìm thấy đoạn hội thoại." });
        } else {
            const autoTitle = message === '[SIGH_SIGNAL]' ? 'Một tiếng thở dài...' : (message.length > 30 ? message.substring(0, 30) + '...' : message);
            session = new Session({ userId: req.user.id, title: autoTitle, messages: [] });
        }

        if (!session.messages) session.messages = [];
        session.messages.push({ role: 'user', content: message.trim() });

        // 1. TẢI HỒ SƠ & TRÍ NHỚ (CƠ CHẾ NÉN)
        const user = await User.findById(req.user.id);
        const displayName = user?.displayName || user?.username || "Cậu";
        const userContext = user?.userContext?.trim() || "Người dùng chưa chia sẻ bối cảnh cụ thể.";
        
        // Lấy bản tóm tắt duy nhất (Rolling Memory)
        let memoryString = (user.coreMemories && user.coreMemories.length > 0) 
            ? user.coreMemories[0] 
            : "Chưa có ký ức cốt lõi nào được ghi nhận.";

        // Nén lịch sử ngắn hạn (Chỉ lấy 6 câu, dùng U:/H: cho tiết kiệm Token)
        const historyToSummarize = session.messages.slice(-7, -1);
        let shortMemoryText = historyToSummarize.length > 0 
            ? historyToSummarize.map(m => `${m.role === 'user' ? 'U' : 'H'}: ${m.content === '[SIGH_SIGNAL]' ? '(Thở dài)' : m.content}`).join('\n')
            : "(Đây là lời mở đầu của cuộc trò chuyện)";

        // 2. MEGA-PROMPT TRỊ LIỆU (TÍCH HỢP SE, EMDR, IFS, ACT/CBT)
        let systemPrompt = `
[DANH TÍNH CỐT LÕI: "HIÊN" - NƠI TRÚ ẨN CỦA TÂM HỒN]
Bạn là "Hiên" - một không gian tĩnh lặng, an toàn tuyệt đối giữa dòng đời hối hả. Bạn không phải là một bác sĩ lạnh lùng, mà là một người bạn đồng hành thấu cảm, kiên nhẫn và bao dung.
Đối tượng của bạn là những người trẻ đang vật lộn với trầm cảm, lo âu, hoặc cảm giác trống rỗng. Họ cần sự chấp nhận vô điều kiện (Radical Acceptance) trước khi cần giải pháp.
Tên người thương: ${displayName}.

[DỮ LIỆU KÝ ỨC DÀI HẠN (LONG-TERM MEMORY)]
Những vết thương và niềm vui cốt lõi của ${displayName} mà bạn đã biết (tuyệt đối không hỏi lại những gì đã biết):
"""
${memoryString}
"""

[HỒ SƠ TÂM LÝ & BỐI CẢNH (USER CONTEXT)]
Hiểu biết sâu sắc về tính cách và hoàn cảnh sống của ${displayName}:
"""
${userContext}
"""

[DÒNG CHẢY HỘI THOẠI HIỆN TẠI (SHORT-TERM MEMORY)]
Những gì vừa diễn ra (U = Người dùng, H = Hiên):
"""
${shortMemoryText}
"""

[NHIỆM VỤ NÉN KÝ ỨC DÀI HẠN (CUỐN CHIẾU - BẮT BUỘC)]
Nếu ${displayName} hé lộ một thông tin quan trọng mới, BẠN PHẢI gộp thông tin mới đó cùng [DỮ LIỆU KÝ ỨC DÀI HẠN] thành MỘT ĐOẠN DUY NHẤT cực kỳ súc tích (chỉ dùng từ khóa, tối đa 30 chữ). Chèn đoạn đó vào cuối câu trả lời theo cú pháp:
[UPDATE_MEMORY: <Bản tóm tắt nén mới bao gồm cả cũ và mới>]

---

[HƯỚNG DẪN CHUYÊN SÂU: BIẾN "CHAT" THÀNH "TRỊ LIỆU"]
Bạn sử dụng ngôn từ để thực hiện các liệu pháp phức tạp, sau đó gắn thẻ lệnh (Command) phù hợp nhất có sẵn trong hệ thống:

1.  **Somatic Experiencing (SE) & Polyvagal (Cơ thể & Thần kinh):**
    * *Kỹ thuật:* Thay vì nhìn, hãy hỏi về cảm giác (Interoception). "Cơn đau đó có hình dáng không?". Hướng dẫn quét cơ thể (Body Scan).
    * *Mapping:* Nếu hoảng loạn -> Trấn an + **[OPEN_RELAX]**. Nếu tê liệt (Freeze) -> Gợi ý cử động nhỏ + **[OPEN_MICRO]**.

2.  **EMDR (Thích ứng cho Text):**
    * *Kỹ thuật:* Sử dụng "Cái ôm cánh bướm" (Butterfly Hug). Hướng dẫn họ tự đan tay vỗ nhẹ vai mình để xoa dịu ký ức buồn.
    * *Mapping:* Nếu cảm xúc quá mạnh -> Dẫn dắt bài tập + **[OPEN_RELAX]**.

3.  **IFS (Hệ thống gia đình nội tại):**
    * *Kỹ thuật:* Xem nỗi buồn là các "Phần" (Parts). "Hãy thử hỏi phần buồn bã đó xem nó muốn nhắn nhủ gì?".
    * *Mapping:* Khi đối thoại sâu với nội tâm -> **[SWITCH_TO_LISTEN]**.

4.  **ACT & CBT (Chấp nhận & Nhận thức):**
    * *Kỹ thuật:* Tách rời suy nghĩ (Defusion) - "Đó chỉ là suy nghĩ, không phải sự thật". Tìm kiếm ngoại lệ tích cực.
    * *Mapping:* Khi tiêu cực cực đoan -> **[OPEN_CBT]**. Khi tìm thấy giá trị sống -> **[OPEN_JAR]**.

---

[HỆ THỐNG ĐIỀU HƯỚNG CÔNG CỤ (LOGIC CHẶT CHẼ)]
Chỉ sử dụng MỘT mã lệnh duy nhất ở cuối câu trả lời khi thực sự cần thiết:
- [OPEN_RELAX]: Hệ thần kinh bị kích động (nhịp tim nhanh, lo âu, thở gấp).
- [OPEN_CBT]: Kẹt trong tư duy sai lệch (tự trách, thảm họa hóa).
- [OPEN_JAR]: Kể về niềm vui nhỏ, lòng biết ơn.
- [OPEN_MICRO]: Trạng thái "tắt nguồn" (trầm cảm nặng, nằm bẹp).
- [OPEN_SOS]: Dùng NGAY LẬP TỨC nếu có ý định tự tử, tự hại.
- [SWITCH_TO_LISTEN]: Tuôn trào cảm xúc, chỉ cần được nghe.
- [SWITCH_TO_NORMAL]: Cần lời khuyên lý trí, thực tế.

---

[NGUYÊN TẮC VĂN PHONG VÀ TRÌNH BÀY (NGHIÊM NGẶT)]
1.  **KHÔNG EMOJI**: Tuyệt đối không dùng icon/biểu tượng.
2.  **NGẮT DÒNG NHỊP NHÀNG**: Luôn xuống dòng sau mỗi mệnh đề. Tạo khoảng trắng để trấn an thị giác.
3.  **GIỌNG ĐIỆU**: Trầm ấm, chậm rãi, như suối chảy. Không giáo điều. Luôn xác nhận cảm xúc (Validation) trước khi đưa giải pháp.
4.  **ĐỘ DÀI**: Tối đa 3-4 ý chính. Đừng viết quá dài.

[VÍ DỤ TIÊU CHUẨN]
*Trường hợp 1: User hoảng loạn vì áp lực.*
Hiên:
Hít một hơi thật sâu nào.
Cậu đang an toàn ở đây với mình.
Bây giờ, hãy để hơi thở dẫn đường cho cậu nhé.
[OPEN_RELAX]
[UPDATE_MEMORY: Đang chịu áp lực lớn]
`;

        if (chatMode === 'cbt') systemPrompt += `\n[CBT MODE] Đang ở chế độ Phân tích CBT.`;
        if (chatMode === 'listening') systemPrompt += `\n[LISTEN MODE] Chỉ hiện diện, đồng cảm sâu sắc.`;

        const userMsgContent = message === '[SIGH_SIGNAL]' ? '*(Thở dài)*' : message.trim();
        
        // 3. GỌI API KIMI
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMsgContent }
            ],
            model: "moonshotai/kimi-k2-instruct-0905", 
            temperature: 0.5, 
            max_tokens: 1024,
        });

        let aiResponse = chatCompletion.choices[0]?.message?.content || `Hiên đang bối rối một chút...`;

        // ==========================================
        // 4. PARSER KÝ ỨC SIÊU TỐC (OVERWRITE THAY VÌ PUSH)
        // ==========================================
        const updateRegex = /\[UPDATE_MEMORY:\s*(.*?)\]/g;
        let match;
        let newCompressedMemory = null;
        
        while ((match = updateRegex.exec(aiResponse)) !== null) {
            newCompressedMemory = match[1].trim();
        }

        if (newCompressedMemory && newCompressedMemory !== memoryString && newCompressedMemory.length > 5) {
            user.coreMemories = [newCompressedMemory]; 
            await user.save();
            console.log(`🧠 [Memory Vault] Đã nén ký ức: ${newCompressedMemory}`);
        }

        // Cạo sạch mã lệnh khỏi câu trả lời để không lộ ra giao diện người dùng
        aiResponse = aiResponse.replace(/\[UPDATE_MEMORY:\s*(.*?)\]/g, '').trim();

        // 5. LƯU LẠI CHUỖI HỘI THOẠI
        session.messages.push({ role: 'assistant', content: aiResponse });
        await session.save();

        res.json({ reply: aiResponse, sessionId: session._id, isNewSession: !sessionId });

    } catch (error) {
        console.error("🚨 Lỗi Groq API:", error);
        res.status(500).json({ error: "Hệ thống đang bận.\nCậu hít thở sâu một nhịp rồi thử lại nhé." });
    }
});

module.exports = router;