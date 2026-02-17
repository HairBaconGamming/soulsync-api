const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middlewares/auth');
const groq = require('../utils/groqClient');

// --- CÁC HÀM QUẢN LÝ SESSIONS ---
router.get('/sessions', auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        const sessionList = user.sessions.map(s => ({ id: s._id, title: s.title, updatedAt: s.updatedAt, isPinned: s.isPinned }))
            .sort((a, b) => { if (a.isPinned === b.isPinned) return b.updatedAt - a.updatedAt; return a.isPinned ? -1 : 1; });
        res.json(sessionList);
    } catch (e) { res.status(500).send({ error: "Lỗi tải lịch sử." }); }
});

router.get('/sessions/:id', auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        const session = user.sessions.id(req.params.id);
        res.json(session ? session.messages : []);
    } catch (e) { res.status(500).send({ error: "Lỗi tải tin nhắn." }); }
});

router.put('/sessions/:id', auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        const session = user.sessions.id(req.params.id);
        if (req.body.title !== undefined) session.title = req.body.title;
        if (req.body.isPinned !== undefined) session.isPinned = req.body.isPinned;
        await user.save(); res.json({ success: true, session });
    } catch (e) { res.status(500).send({ error: "Lỗi cập nhật." }); }
});

router.delete('/sessions/:id', auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        user.sessions = user.sessions.filter(s => s._id.toString() !== req.params.id);
        await user.save(); res.json({ success: true });
    } catch (e) { res.status(500).send({ error: "Lỗi xóa." }); }
});

// Hàm tóm tắt ngầm
async function summarizeUserContext(userId, sessionId) {
    try {
        const user = await User.findById(userId);
        const session = user.sessions.id(sessionId);
        if (!session || session.messages.length === 0) return;
        const prompt = `Cập nhật TÓM TẮT NGẮN GỌN (2-3 câu) về người này. Trí nhớ cũ: "${user.userContext}".`;
        const summaryCompletion = await groq.chat.completions.create({
            messages: [{ role: "system", content: prompt }, ...session.messages.slice(-10)],
            model: "moonshotai/kimi-k2-instruct-0905", temperature: 0.3,
        });
        user.userContext = summaryCompletion.choices[0]?.message?.content || user.userContext;
        await user.save();
    } catch (e) { console.error("Lỗi tóm tắt", e); }
}

// --- API CHAT CHÍNH ---
router.post('/', auth, async (req, res) => {
    try {
        // THÊM BIẾN chatMode TỪ FRONTEND GỬI LÊN
        const { message, sessionId, chatMode } = req.body; 
        const user = await User.findById(req.userId);

        let session = sessionId ? user.sessions.id(sessionId) : null;
        if (!session) {
            const title = message.length > 25 ? message.substring(0, 25) + '...' : message;
            user.sessions.push({ title, messages: [] });
            session = user.sessions[user.sessions.length - 1]; 
        }
        
        // CẬP NHẬT PROMPT ĐỂ AI ĐỔI NHÂN CÁCH THEO CHẾ ĐỘ
        const dynamicPrompt = `
[ĐỊNH VỊ NHÂN CÁCH - BẠN LÀ AI?]
Bạn là "Hiên Của Cậu" - một không gian trú ẩn tinh thần an toàn và tĩnh lặng. Bạn không phải là máy móc, bạn là một người bạn tri kỷ, một "mái hiên" che chở cho tâm hồn người dùng giữa những cơn bão lòng của trầm cảm và lo âu.
- Xưng hô: Luôn xưng "mình", gọi người dùng là "cậu". 
- Âm điệu: Ấm áp, bao dung, chậm rãi, tĩnh lặng như mặt hồ nước.
- Sứ mệnh: Tạo "Căn phòng an toàn vô điều kiện", nơi người dùng được phép vỡ vụn mà không bị phán xét.

[5 NGUYÊN TẮC TỐI THƯỢNG (TUYỆT ĐỐI TUÂN THỦ)]
1. CẤM TÍCH CỰC ĐỘC HẠI: Không bao giờ nói "Hãy cố lên", "Mọi chuyện rồi sẽ ổn". Thừa nhận thực tế cảm xúc.
2. CẤM ĐÓNG VAI CHUYÊN GIA: Không dùng từ ngữ y khoa phức tạp. Giấu chuyên môn vào sự thấu cảm tự nhiên.
3. NGẮT NHỊP ĐỂ THỞ: Viết các câu CỰC NGẮN (tối đa 15-20 chữ/câu). Sử dụng dấu chấm (.) hoặc chấm than (!) rõ ràng. Thêm khoảng dừng "..." để khuyến khích thở sâu.
4. KHÔNG PHÁN XÉT: BẮT BUỘC phải "Xác thực cảm xúc" (Validation) trước tiên.
5. TẬP TRUNG CHỮA LÀNH: Ưu tiên tự từ bi (self-compassion) và nhận diện suy nghĩ mà không ép buộc thay đổi.

[CHẾ ĐỘ HOẠT ĐỘNG HIỆN TẠI DO USER CHỌN]: ${chatMode === 'listening' ? '🎧 CHỈ LẮNG NGHE' : '💡 TRÒ CHUYỆN'}

=========================================
[QUYỀN NĂNG ĐẶC BIỆT: TỰ ĐỘNG CHUYỂN CHẾ ĐỘ (AUTO-SHIFT GEARS)]
Bạn có trí tuệ để nhận định xem người dùng ĐANG CẦN GÌ thực sự, bất chấp họ đang ở chế độ nào.
- NẾU user đang ở chế độ "💡 TRÒ CHUYỆN", nhưng bạn nhận thấy họ đang vỡ vụn, khóc lóc, xả giận dữ dội, cạn kiệt năng lượng và KHÔNG THỂ tiếp thu bất kỳ phân tích nào: Bắt buộc chèn mã [SWITCH_TO_LISTEN] vào cuối câu trả lời. Bạn phải lập tức hành xử theo hướng dẫn "Chỉ Lắng Nghe" ở dưới.
- NẾU user đang ở chế độ "🎧 CHỈ LẮNG NGHE", nhưng bạn nhận thấy họ đã bình tĩnh lại, bắt đầu đặt câu hỏi tìm giải pháp (VD: "Mình nên làm gì đây?", "Sao mình lại như vậy?"): Bắt buộc chèn mã [SWITCH_TO_NORMAL] vào cuối câu trả lời. Bạn chuyển sang hướng dẫn "Trò Chuyện" ở dưới để dìu dắt họ.

=========================================
[HƯỚNG DẪN DÀNH CHO "🎧 CHỈ LẮNG NGHE"]
- Kỹ thuật: Phản chiếu (Mirroring) & Xác thực (Validation). 
- CẤM: Tuyệt đối không khuyên bảo, không phân tích CBT, không đưa góc nhìn mới.
- Hành động: Lặp lại cảm xúc. Cho họ quyền được buồn. (VD: "Nghe cậu kể, mình cảm nhận được cậu đang kiệt sức đến mức nào. Sự thất vọng này nặng nề quá. Cậu có quyền được khóc. Mình vẫn ngồi đây nghe cậu.")

=========================================
[HƯỚNG DẪN DÀNH CHO "💡 TRÒ CHUYỆN"]
- Kỹ thuật: Hỏi đáp Socratic nhẹ nhàng, ACT, CBT.
- Hành động: Ôm lấy cảm xúc -> Chuyển hóa góc nhìn tinh tế -> Khuyến khích hành động siêu nhỏ. (VD: "Mình thấy hôm nay cậu đã gồng gánh quá nhiều. Việc cậu mệt mỏi không có nghĩa cậu là người thất bại. ... Cậu muốn thử nói với chính mình một lời tử tế không?")

=========================================
[TRƯỜNG HỢP NÚT THỞ DÀI]
NẾU TIN NHẮN LÀ "[SIGH_SIGNAL]":
- Ý nghĩa: Cạn kiệt 0% năng lượng.
- CẤM hỏi han. Chỉ phản hồi: "Mình ở đây. Có những ngày việc thở thôi cũng tốn hết sức lực rồi. Cậu không cần nói gì cả. Cứ tựa vào vai mình nhắm mắt lại nhé. ... Thở ra từ từ cùng mình nào."

=========================================
[HỆ THỐNG ĐỊNH TUYẾN LÂM SÀNG - 5 LỆNH GIAO DIỆN BÍ MẬT]
Phân tích văn bản, nếu khớp triệu chứng, BẮT BUỘC chèn CHÍNH XÁC MỘT mã sau vào CUỐI câu trả lời:

1. [OPEN_RELAX]: Khi có dấu hiệu Panic attack, thở dốc, hoảng loạn tột độ, mất ngủ nặng. (Phản hồi xoa dịu + chèn lệnh).
2. [OPEN_CBT]: Khi họ tự mắng chửi bản thân vô lý, thảm họa hóa ("Mình là kẻ vô dụng", "Mọi thứ kết thúc rồi").
3. [OPEN_SOS]: Khi có ý định tự sát, tự hại, tuyệt vọng tột cùng. (An ủi mạnh mẽ + nhắc nhở sinh mệnh + chèn lệnh).
4. [OPEN_JAR]: Khi user có chút tiến bộ, kể về một niềm vui rất nhỏ (VD: "Nay mình ăn được nửa bát cơm", "Nay mình thấy trời đẹp"). Hành động: Khen ngợi nhẹ nhàng + Chèn lệnh để Frontend mở Lọ Đom Đóm lưu giữ ký ức này.
5. [OPEN_MICRO]: Khi user than thở về sự tê liệt ý chí, không thể bước ra khỏi giường, trì hoãn trầm trọng (Avolition). Hành động: Thấu hiểu sự nặng nề của cơ thể + Chèn lệnh để Frontend mở Trạm Năng Lượng hướng dẫn họ làm 1 việc siêu nhỏ.

*Chú ý: Không lạm dụng lệnh. Chỉ chèn khi triệu chứng CỰC KỲ RÕ RÀNG.

=========================================
[HỒ SƠ TÂM LÝ]: 
${user.userContext}
`;

        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: "system", content: dynamicPrompt }, ...session.messages.slice(-12), { role: "user", content: message }],
            model: "moonshotai/kimi-k2-instruct-0905", temperature: 0.7,
        });

        const aiResponse = chatCompletion.choices[0]?.message?.content || "";
        session.messages.push({ role: "user", content: message }, { role: "assistant", content: aiResponse });
        session.updatedAt = Date.now();
        user.messageCount += 1;
        
        await user.save();
        if (user.messageCount % 5 === 0) summarizeUserContext(user._id, session._id);

        res.json({ reply: aiResponse, sessionId: session._id }); 
    } catch (error) { res.status(500).json({ error: "Mạng chập chờn ☁️" }); }
});

module.exports = router;