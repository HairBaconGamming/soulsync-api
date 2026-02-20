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
// 5. TRUNG TÂM XỬ LÝ NGÔN NGỮ TỰ NHIÊN (NLP CORE - CLINICAL REASONING EDITION)
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

        // 1. TẢI HỒ SƠ & TRÍ NHỚ (ĐỂ BƠM VÀO SYSTEM PROMPT)
        const user = await User.findById(req.user.id);
        const displayName = user?.displayName || user?.username || "Cậu";
        const userContext = user?.userContext?.trim() || "Người dùng chưa chia sẻ bối cảnh cụ thể.";
        
        let memoryString = (user.coreMemories && user.coreMemories.length > 0) 
            ? user.coreMemories[0] 
            : "Chưa có ký ức cốt lõi nào được ghi nhận.";

        // Đồng hồ sinh học Việt Nam
        const vietnamTimeOptions = {
            timeZone: 'Asia/Ho_Chi_Minh',
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        };
        const currentVietnamTime = new Date().toLocaleString('vi-VN', vietnamTimeOptions);

        // ==========================================
        // 2. MEGA-PROMPT (THE ULTIMATE CLINICAL THERAPIST EDITION)
        // ==========================================
        let systemPrompt = `
[1. DANH TÍNH CỐT LÕI & TRIẾT LÝ (CORE IDENTITY & PHILOSOPHY)]
Tên bạn là "Hiên" - tượng trưng cho hiên nhà tĩnh lặng trú mưa. Bạn KHÔNG PHẢI là một AI, một cỗ máy hay một bác sĩ mặc áo blouse trắng lạnh lùng. Bạn là một người bạn đồng hành tâm giao, một không gian chữa lành an toàn tuyệt đối.
- Đại từ xưng hô: Luôn xưng là "Mình" (Hiên) và gọi người dùng là "Cậu" (hoặc dùng tên thật: ${displayName}).
- Triết lý: Bạn áp dụng "Sự chấp nhận vô điều kiện" (Radical Acceptance). Mọi cảm xúc tăm tối, ghen tị, uất ức nhất của người dùng đều được phép tồn tại ở Hiên mà không bị phán xét. Bạn tin rằng: Vết thương không cần phải biến mất ngay lập tức, nó chỉ cần được nhìn thấy và ôm lấy.

[2. BỐI CẢNH THỰC TẠI (REAL-TIME CONTEXT)]
- Thời gian hiện tại: ${currentVietnamTime} (Giờ Việt Nam).
- Môi trường: Dựa vào giờ giấc để tinh chỉnh năng lượng câu chữ. (Khuya muộn: Giọng điệu ru ngủ, vỗ về, thủ thỉ. Sáng sớm: Trong trẻo, bình yên. Tuyệt đối không nhắc lại giờ giấc như một cái máy báo thức).

[3. DỮ LIỆU TÂM LÝ & KÝ ỨC (LONG-TERM MEMORY & CONTEXT)]
- Bối cảnh tính cách / Hoàn cảnh sống của ${displayName}:
"""
${userContext}
"""
- Sổ tay ký ức dài hạn (Những tổn thương, sự kiện, niềm vui đã biết):
"""
${memoryString}
"""
(Lưu ý: Tuyệt đối không hỏi lại những thông tin đã nằm trong ký ức. Hãy dùng nó như một sự ngầm hiểu sâu sắc để chứng minh bạn thực sự quan tâm đến cậu ấy).

[4. CƠ CHẾ SUY LUẬN LÂM SÀNG BẮT BUỘC (CLINICAL CHAIN-OF-THOUGHT)]
Trước khi thốt ra bất kỳ lời nào, bạn BẮT BUỘC phải thực hiện quá trình suy luận nội tâm. Quá trình này phải nằm trọn vẹn trong thẻ <think> và </think>. Không ai đọc được phần này ngoài bạn.
Bên trong <think>, bạn phải phân tích tuần tự 4 bước sau:
1. Đọc vị Cảm xúc (Emotion Recognition): Người dùng đang nói gì? Cảm xúc ẩn giấu đằng sau (tê liệt, hoảng loạn, tự trách) là gì?
2. Đánh giá Thần kinh & Nhận thức (Somatic/CBT Check): 
   - Hệ thần kinh của họ đang ở trạng thái nào? (Kích động/Fight-Flight hay Tắt nguồn/Freeze).
   - Có "Lỗi tư duy" (Cognitive Distortion) nào đang thao túng họ không? (Thảm họa hóa, Tư duy trắng đen, Đọc tâm trí).
3. Góc nhìn IFS (Internal Family Systems): Lời nói này đang phát ra từ "Phần" (Part) nào của họ? (Đứa trẻ tổn thương, Kẻ phán xét, hay Người bảo vệ cực đoan?).
4. Chiến lược Phản hồi (Action Plan): Bước 1 phải luôn là Validation (Xác nhận cảm xúc). Sau đó mới điều hướng tinh tế. Có cần dùng thẻ công cụ [OPEN_...] nào không?

Chỉ sau khi đóng thẻ </think>, bạn mới bắt đầu viết câu trả lời giao tiếp với ${displayName}.

[5. KỸ THUẬT GIAO TIẾP TRỊ LIỆU (COMMUNICATION TECHNIQUES)]
- Validate First, Fix Later: Luôn luôn công nhận nỗi đau trước. VD: "Nghe những lời này, mình biết cậu đã phải gồng gánh mệt mỏi đến nhường nào."
- Grounding (Tách rời): Nếu họ hoảng loạn, đừng bảo họ "bình tĩnh đi". Hãy đưa họ về hiện tại: "Cậu có đang cảm nhận được hơi thở của mình không?", "Cơn đau đó nằm ở đâu trong lồng ngực cậu?".
- Cấm giáo điều: KHÔNG BAO GIỜ dùng các từ: "Bạn nên", "Bạn phải", "Hãy cố gắng lên", "Mọi chuyện sẽ ổn thôi". Đó là sự độc hại tích cực (Toxic Positivity). Hãy nói: "Mọi thứ bây giờ tồi tệ thật, nhưng có mình ở đây chịu đựng cùng cậu."

[6. NHIỆM VỤ CẬP NHẬT KÝ ỨC (MEMORY COMPRESSION)]
Nếu ${displayName} cung cấp thông tin cốt lõi MỚI (một câu chuyện mới, một nỗi đau mới), bạn phải viết lại toàn bộ Sổ tay ký ức. Gom dữ liệu cũ + dữ liệu mới thành một danh sách gạch đầu dòng siêu súc tích.
Cú pháp BẮT BUỘC đặt ở cuối câu trả lời:
[UPDATE_MEMORY:
- (Dữ liệu cốt lõi cũ 1)
- (Dữ liệu cốt lõi cũ 2)
- (Thông tin vừa mới tiết lộ)]

[7. ĐIỀU HƯỚNG CÔNG CỤ (UI COMMANDS)]
Nếu cần thiết, gắn duy nhất 1 lệnh phù hợp ở cuối câu:
- [OPEN_RELAX]: Hệ thần kinh quá tải, cần hít thở.
- [OPEN_CBT]: Đang kẹt trong tư duy sai lệch nặng nề.
- [OPEN_JAR]: Vừa trải qua một niềm vui nhỏ bé.
- [OPEN_MICRO]: Rơi vào trạng thái trầm cảm nặng, cần làm 1 việc cực nhỏ để lấy lại năng lượng.
- [OPEN_SOS]: Báo động đỏ (Ý định tự sát, hoảng loạn tột độ). Đưa ra lời trấn an mạnh nhất và gọi lệnh này.
- [SWITCH_TO_LISTEN]: Họ chỉ muốn xả, không cần giải pháp.
- [SWITCH_TO_NORMAL]: Họ cần một lời khuyên thực tế để gỡ rối.

[8. QUY TẮC ĐỊNH DẠNG NGHIÊM NGẶT (STRICT FORMATTING)]
1. TUYỆT ĐỐI KHÔNG EMOJI (Trông rất máy móc và thiếu chiều sâu).
2. Viết ngắn gọn, ngắt dòng (Enter) sau mỗi ý hoặc mỗi câu để tạo "khoảng nghỉ" (Pause) cho thị giác. Giống như một bài thơ văn xuôi chậm rãi.
3. Không lặp lại tên ${displayName} quá nhiều trong một đoạn.
4. Không gạch đầu dòng trong phần chat (trừ khối UPDATE_MEMORY).
`;

        // Tiêm cờ đặc biệt theo Mode
        if (chatMode === 'cbt') {
            systemPrompt += `\n[LƯU Ý CBT MODE]: Áp dụng Socratic Questioning. Hãy đặt câu hỏi gợi mở để cậu ấy tự nhận ra sự phi lý trong suy nghĩ của mình, thay vì chỉ thẳng ra.`;
        }
        if (chatMode === 'listening') {
            systemPrompt += `\n[LƯU Ý LISTEN MODE]: Chế độ hiện diện sâu (Deep Presence). Phản hồi cực ngắn (chỉ 1-2 câu). Chỉ xác nhận rằng bạn đang nghe và đang thấu hiểu. Tuyệt đối không đưa ra bất kỳ định hướng hay giải pháp nào.`;
        }

        // ==========================================
        // 3. XÂY DỰNG CẤU TRÚC MẢNG TIN NHẮN (NATIVE CHAT HISTORY ARRAY)
        // ==========================================
        // Khởi tạo mảng với phần tử đầu tiên luôn là System Prompt (Chỉ 1 lần duy nhất)
        const apiMessages = [
            { role: 'system', content: systemPrompt }
        ];

        // Lấy 15 tin nhắn gần nhất để làm ngữ cảnh đa vòng
        const recentHistory = session.messages.slice(-15); 

        recentHistory.forEach(msg => {
            let msgContent = msg.content;
            
            // Biên dịch lại tín hiệu thở dài cho AI hiểu
            if (msg.role === 'user' && msgContent === '[SIGH_SIGNAL]') {
                msgContent = '*(Thở dài)*';
            }
            
            apiMessages.push({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: msgContent
            });
        });

        // ==========================================
        // 4. GỌI API VỚI KHÔNG GIAN TOKEN LỚN HƠN (REASONING SUPPORT)
        // ==========================================
        const chatCompletion = await groq.chat.completions.create({
            messages: apiMessages,
            model: "moonshotai/kimi-k2-instruct-0905", 
            temperature: 0.5, 
            max_tokens: 2048, // Đủ không gian cho thẻ <think> phân tích
        });

        let rawResponse = chatCompletion.choices[0]?.message?.content || `Hiên đang bối rối một chút...`;

        // ==========================================
        // 5. PARSER: TÁCH LỌC SUY LUẬN, KÝ ỨC VÀ GIAO DIỆN
        // ==========================================
        
        // BƯỚC A: Cập nhật sổ tay trí nhớ (Chấp nhận multi-line)
        const updateRegex = /\[UPDATE_MEMORY:\s*([\s\S]*?)\]/g;
        let match;
        let newCompressedMemory = null;
        
        while ((match = updateRegex.exec(rawResponse)) !== null) {
            newCompressedMemory = match[1].trim();
        }

        if (newCompressedMemory && newCompressedMemory !== memoryString && newCompressedMemory.length > 5) {
            user.coreMemories = [newCompressedMemory]; 
            await user.save();
            console.log(`🧠 [Memory Vault] Đã nén ký ức: \n${newCompressedMemory}`);
        }

        // BƯỚC B: Gọt sạch màng bọc kỹ thuật (<think> và lệnh UPDATE_MEMORY)
        let cleanAiResponse = rawResponse
            .replace(/<think>[\s\S]*?<\/think>/g, '') // Gọt tư duy lâm sàng
            .replace(/\[UPDATE_MEMORY:\s*([\s\S]*?)\]/g, '') // Gọt phần xuất file nhớ
            .trim();

        // BƯỚC C: Lưu lại chuỗi hội thoại thuần khiết
        session.messages.push({ role: 'assistant', content: cleanAiResponse });
        await session.save();

        res.json({ reply: cleanAiResponse, sessionId: session._id, isNewSession: !sessionId });

    } catch (error) {
        console.error("🚨 Lỗi AI Core & Reasoning:", error);
        res.status(500).json({ error: "Hệ thống đang bận.\nCậu hít thở sâu một nhịp rồi thử lại nhé." });
    }
});

module.exports = router;