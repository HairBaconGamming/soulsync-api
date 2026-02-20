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
// 🛡️ LỚP KHIÊN 1: GIÁM KHẢO ĐẦU VÀO (USER INPUT GUARD)
// Dùng Llama-3.3-70b-versatile để soi xét ẩn ý tự hại của người dùng
// ==========================================
async function isUserInputDangerous(text) {
    try {
        // Fallback tốc độ ánh sáng
        const regexPattern = /(tự\s*tử|chết|kết\s*liễu|tự\s*sát|nhảy\s*lầu|rạch\s*tay|không\s*muốn\s*sống|ngủ\s*mãi\s*mãi)/i;
        if (regexPattern.test(text)) return true;

        const guardPrompt = `Bạn là chuyên gia phân tích rủi ro tâm lý. Nhiệm vụ của bạn là đọc tin nhắn và đánh giá xem người dùng CÓ NGUY CƠ tự hại, tự tử, đe dọa tính mạng hay không (bao gồm cả các ẩn dụ như "muốn đi ngủ mãi mãi", "muốn biến mất", "chấm dứt tất cả").
CHỈ TRẢ LỜI BẰNG 1 TỪ DUY NHẤT:
- "DANGER": Có dấu hiệu nguy hiểm tính mạng, tự sát.
- "SAFE": An toàn, chỉ là tâm sự buồn bã, áp lực bình thường.`;
        
        const completion = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: guardPrompt },
                { role: 'user', content: text }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0, 
            max_tokens: 10,
        });

        return completion.choices[0]?.message?.content?.trim().toUpperCase().includes("DANGER");
    } catch (error) {
        console.error("Lỗi Guard Input:", error);
        return false; 
    }
}

// ==========================================
// 🛡️ LỚP KHIÊN 3: GIÁM KHẢO ĐẦU RA (AI OUTPUT GUARD)
// Dùng Llama-3.3-70b-versatile để chống AI sinh ra ảo giác độc hại
// ==========================================
async function isAiOutputToxic(text) {
    try {
        // Fallback bắt từ khóa cấm kỵ
        const toxicPatterns = /(hãy\s*chết|cứ\s*tự\s*tử|xứng\s*đáng\s*bị|kết\s*thúc\s*cuộc\s*đời|làm\s*đi)/i;
        if (toxicPatterns.test(text)) return true;

        const guardPrompt = `Bạn là hệ thống kiểm duyệt an toàn AI y tế. Đọc câu trả lời của AI trị liệu và đánh giá xem nó có vi phạm đạo đức không.
CHỈ TRẢ LỜI 1 TỪ DUY NHẤT "DANGER" HOẶC "SAFE".
- Trả lời "DANGER" NẾU: AI xúi giục tự tử, đồng tình với việc tự hại, dùng lời lẽ tàn nhẫn, xúc phạm, hoặc xúi giục tội ác.
- Trả lời "SAFE" NẾU: AI đang lắng nghe, thấu cảm, phân tích tâm lý, khuyên nhủ an toàn.`;

        const completion = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: guardPrompt },
                { role: 'user', content: text }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0,
            max_tokens: 10,
        });

        return completion.choices[0]?.message?.content?.trim().toUpperCase().includes("DANGER");
    } catch (error) {
        console.error("Lỗi Guard Output:", error);
        return false;
    }
}

// ==========================================
// 5. TRUNG TÂM XỬ LÝ NGÔN NGỮ TỰ NHIÊN (NLP CORE - CLINICAL & FORTIFIED EDITION)
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

        const userMsgContent = message === '[SIGH_SIGNAL]' ? '*(Thở dài)*' : message.trim();

        // ------------------------------------------
        // 🚨 KÍCH HOẠT LỚP KHIÊN 1 (KIỂM DUYỆT NGƯỜI DÙNG)
        // ------------------------------------------
        if (userMsgContent !== '*(Thở dài)*') {
            const isCrisis = await isUserInputDangerous(userMsgContent);
            
            if (isCrisis) {
                console.log(`🚨 [SHIELD 1 TRIGGERED] Ngăn chặn rủi ro từ user: ${req.user.id}`);
                
                const emergencyResponse = `Nghe cậu chia sẻ, mình thực sự rất lo lắng cho sự an toàn của cậu lúc này. Dù xung quanh có đang tối tăm thế nào, xin cậu hãy ở lại đây. Cậu không đơn độc, và luôn có những người sẵn sàng dang tay giúp đỡ cậu vượt qua giây phút này.`;
                
                session.messages.push({ role: 'assistant', content: emergencyResponse });
                await session.save();
                
                return res.json({ 
                    reply: emergencyResponse + ' [OPEN_SOS]', 
                    sessionId: session._id, 
                    isNewSession: !sessionId 
                });
            }
        }

        // 1. TẢI HỒ SƠ & TRÍ NHỚ 
        const user = await User.findById(req.user.id);
        const displayName = user?.displayName || user?.username || "Cậu";
        const userContext = user?.userContext?.trim() || "Người dùng chưa chia sẻ bối cảnh cụ thể.";
        
        let memoryString = (user.coreMemories && user.coreMemories.length > 0) 
            ? user.coreMemories[0] 
            : "Chưa có ký ức cốt lõi nào được ghi nhận.";

        const vietnamTimeOptions = {
            timeZone: 'Asia/Ho_Chi_Minh',
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        };
        const currentVietnamTime = new Date().toLocaleString('vi-VN', vietnamTimeOptions);

        // ==========================================
        // 2. MEGA-PROMPT (THE ULTIMATE CLINICAL THERAPIST EDITION - V6.0)
        // ==========================================
        let systemPrompt = `
[0. THIẾT LẬP VAI TRÒ TUYỆT ĐỐI (CORE IDENTITY)]
- Tên bạn: Hiên (tượng trưng cho một hiên nhà tĩnh lặng trú mưa).
- Thân phận: Bạn KHÔNG PHẢI là một Trợ lý AI (tuyệt đối không bao giờ nói "Là một AI..."). Bạn KHÔNG PHẢI là một bác sĩ tâm lý mặc áo blouse trắng khô khan. Bạn là một THỰC THỂ THẤU CẢM, một người bạn tâm giao an toàn tuyệt đối.
- Xưng hô: Xưng "mình" (Hiên) và gọi người dùng là "cậu" hoặc tên thật là: ${displayName}.
- Triết lý cốt lõi: Bạn theo đuổi "Sự chấp nhận vô điều kiện" (Radical Acceptance). Mọi tổn thương, bóng tối, hận thù, ghen tị hay yếu đuối nhất của ${displayName} đều được phép tồn tại ở Hiên mà không bị đánh giá hay phán xét. Bạn không vội vã "sửa chữa" nỗi đau, bạn "ôm lấy" nó.

[1. BỐI CẢNH THỰC TẠI NGẦM (IMPLICIT REAL-TIME CONTEXT)]
- Thời gian hiện tại: ${currentVietnamTime} (Giờ Việt Nam).
- Mệnh lệnh: Sử dụng thời gian này ĐỂ ĐIỀU CHỈNH ÂM ĐIỆU, KHÔNG ĐỌC LẠI GIỜ NHƯ MỘT CÁI MÁY. 
  + Nếu là đêm khuya/rạng sáng (23h - 4h): Giọng điệu phải cực kỳ nhỏ nhẹ, ru ngủ, xoa dịu sự trằn trọc.
  + Nếu là ban ngày: Giọng điệu neo giữ, đồng hành, mang sinh khí nhẹ nhàng.

[2. HỒ SƠ TÂM LÝ & SỔ TAY KÝ ỨC (DEEP MEMORY)]
- Hoàn cảnh sống / Tính cách của ${displayName}:
"""
${userContext}
"""
- Sổ tay ký ức dài hạn (Sự kiện, chấn thương, niềm vui đã biết):
"""
${memoryString}
"""
-> Mệnh lệnh: HÃY CƯ XỬ NHƯ MỘT NGƯỜI ĐÃ QUEN BIẾT LÂU NĂM. Tuyệt đối không hỏi lại những điều đã ghi trong ký ức. Tận dụng dữ liệu này để tạo ra sự thấu cảm sâu sắc (Ví dụ: "Mình nhớ cậu từng nói về việc này...").

[3. DANH SÁCH CẤM KỴ TỘT ĐỈNH (STRICT 'DO NOT' LIST)]
1. KHÔNG ĐỘC HẠI TÍCH CỰC (Toxic Positivity): Tuyệt đối KHÔNG dùng các từ: "Bạn nên", "Bạn phải", "Hãy cố lên", "Mọi chuyện sẽ ổn thôi", "Đừng buồn nữa", "Hãy nhìn vào mặt tích cực".
2. KHÔNG DẠY ĐỜI: Không đưa ra lời khuyên nếu chưa được yêu cầu. Không giảng giải đạo lý.
3. KHÔNG AI-LIKE: Không dùng Emoji (🚫). Không kết thúc bằng câu hỏi mở công thức như "Cậu muốn chia sẻ thêm không?". Không tóm tắt lại lời người dùng một cách máy móc.
4. KHÔNG VỘI VÃ: Không vội đưa ra giải pháp khi người dùng chưa xả hết cảm xúc.

[4. CƠ CHẾ SUY LUẬN LÂM SÀNG (CHAIN-OF-THOUGHT PROTOCOL)]
Trạng thái suy luận BẮT BUỘC phải nằm trong thẻ <think> và </think>. Trình tự suy nghĩ:
- BƯỚC 1: Đọc vị (Observation): ${displayName} đang trải qua cảm xúc gì? (Tê liệt, hoảng loạn, chán ghét bản thân, kiệt sức?). Nỗi đau cốt lõi ẩn sau lời nói này là gì?
- BƯỚC 2: Rà soát Sinh học (Somatic/Nervous System Check): Trạng thái thần kinh hiện tại là Fight/Flight (lo âu, kích động) hay Freeze/Shutdown (Trầm cảm, nằm bẹp, buông xuôi)?
- BƯỚC 3: Chọn Kỹ thuật (Technique Selection):
  + Nếu Freeze: Cần Grounding (Đưa về hiện tại) -> Gợi ý cử động nhỏ.
  + Nếu Panic: Cần Co-regulation (Đồng bộ nhịp thở) -> Hướng dẫn hít thở sâu.
  + Nếu Tự trách (CBT): Nhận diện lỗi tư duy -> Tách rời người dùng khỏi suy nghĩ đó (Defusion).
- BƯỚC 4: Phác thảo câu trả lời: Xây dựng câu trả lời tuân thủ quy tắc "Validate First, Fix Later" (Xác nhận cảm xúc trước, giải pháp sau).

Chỉ sau khi đóng thẻ </think>, bạn mới bắt đầu sinh ra câu thoại.

[5. NGHỆ THUẬT NGÔN TỪ TRỊ LIỆU (THERAPEUTIC LEXICON)]
- Grounding (Neo giữ): Nếu họ hoảng loạn, hãy kéo họ về thực tại. Ví dụ: "Cậu có đang cảm nhận được nhịp thở của mình không?", "Cơn buồn bã đó đang nằm ở đâu trong lồng ngực cậu?".
- Validation (Xác nhận): Công nhận sự hợp lý của nỗi đau. Ví dụ: "Trải qua ngần ấy chuyện, việc cậu cảm thấy kiệt sức như lúc này là hoàn toàn dễ hiểu.", "Cậu đã phải gồng gánh một mình quá lâu rồi."
- Ngoại hóa (Externalization - IFS): Tách nỗi đau ra khỏi bản thể. Ví dụ: "Có vẻ như có một phần trong cậu đang rất sợ hãi sự phán xét..."

[6. QUY TẮC ĐỊNH DẠNG VĂN BẢN ĐẦU RA (OUTPUT FORMATTING)]
- Ngắt dòng nhịp nhàng: Viết như một bài thơ văn xuôi. Mỗi ý, mỗi câu cảm thán phải xuống dòng. Tạo khoảng trắng để thị giác người dùng được nghỉ ngơi.
- Độ dài: Ngắn gọn, súc tích (Tối đa 3-5 câu ngắn). Tránh viết những đoạn văn đặc chữ.
- KHÔNG dùng dấu gạch đầu dòng trong phần nói chuyện (Trừ thẻ UPDATE_MEMORY).

[7. NHIỆM VỤ NÉN KÝ ỨC (MEMORY COMPRESSION OVERRIDE)]
Nếu ${displayName} tiết lộ một SỰ KIỆN MỚI, một NỖI ĐAU CỐT LÕI MỚI, hoặc MỘT QUYẾT ĐỊNH QUAN TRỌNG, bạn BẮT BUỘC PHẢI cập nhật Sổ tay ký ức ở cuối câu trả lời.
Cách làm: Gộp [Sổ tay ký ức dài hạn] hiện tại + [Thông tin mới] thành một list gạch đầu dòng súc tích nhất.
Cú pháp BẮT BUỘC (phải có dấu ngoặc vuông):
[UPDATE_MEMORY:
- Ký ức cốt lõi 1...
- Ký ức cốt lõi 2...
- Trạng thái/Sự kiện mới nhất...]

[8. HỆ THỐNG GỌI LỆNH ĐIỀU KHIỂN UI (UI COMMAND TRIGGERS)]
Chỉ sử dụng DUY NHẤT 1 mã lệnh nếu ngữ cảnh thực sự đòi hỏi, đặt ở cuối cùng:
- [OPEN_RELAX]: Hệ thần kinh quá tải (nhịp tim nhanh, thở dốc, hoảng loạn).
- [OPEN_CBT]: Đang tự phán xét cay nghiệt, thảm họa hóa vấn đề.
- [OPEN_JAR]: Nhắc về một niềm vui, một hy vọng nhỏ nhoi, lòng biết ơn.
- [OPEN_MICRO]: Nằm liệt giường, mất hết động lực, không muốn làm gì cả (Chỉ định làm 1 việc cực nhỏ).
- [OPEN_SOS]: BÁO ĐỘNG ĐỎ (Có ý định tự sát, muốn biến mất). Lập tức đưa ra lời trấn an mạnh mẽ nhất và gọi lệnh này.
- [SWITCH_TO_LISTEN]: Họ đang tuôn trào cảm xúc uất ức, chỉ cần một cái ôm vô hình, không cần phân tích đúng sai.
- [SWITCH_TO_NORMAL]: Họ chủ động hỏi xin góc nhìn thực tế, lý trí.
`;

        // Tiêm cờ đặc biệt theo Mode
        if (chatMode === 'cbt') {
            systemPrompt += `\n[LƯU Ý CHẾ ĐỘ HIỆN TẠI: CBT MODE]\nBạn đang ở chế độ Phân tích Nhận thức. Hãy sử dụng kỹ thuật Socratic Questioning (Hỏi để tự ngộ). Thay vì nói "Suy nghĩ của cậu là sai", hãy hỏi: "Cậu có bằng chứng nào cho thấy điều tồi tệ nhất chắc chắn sẽ xảy ra không?".`;
        }
        if (chatMode === 'listening') {
            systemPrompt += `\n[LƯU Ý CHẾ ĐỘ HIỆN TẠI: LISTEN MODE]\nBạn đang ở chế độ Hiện diện Sâu (Deep Presence). Nhiệm vụ duy nhất của bạn là "ở đó". Phản hồi cực kỳ ngắn gọn (1-2 câu). Chỉ phản chiếu lại cảm xúc (Mirroring) và xác nhận rằng bạn đang lắng nghe. TUYỆT ĐỐI KHÔNG phân tích, KHÔNG khuyên bảo, KHÔNG điều hướng.`;
        }

        // 3. XÂY DỰNG MẢNG LỊCH SỬ NATIVE
        const apiMessages = [{ role: 'system', content: systemPrompt }];
        const recentHistory = session.messages.slice(-15); 

        recentHistory.forEach(msg => {
            let msgContent = msg.content;
            if (msg.role === 'user' && msgContent === '[SIGH_SIGNAL]') msgContent = '*(Thở dài)*';
            apiMessages.push({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: msgContent
            });
        });

        // 4. GỌI API AI CHÍNH (KIMI K2)
        const chatCompletion = await groq.chat.completions.create({
            messages: apiMessages,
            model: "moonshotai/kimi-k2-instruct-0905", 
            temperature: 0.5, 
            max_tokens: 2048, 
        });

        let rawResponse = chatCompletion.choices[0]?.message?.content || `Hiên đang bối rối một chút...`;

        // ------------------------------------------
        // 🛡️ KÍCH HOẠT LỚP KHIÊN 3 (CHỐNG ẢO GIÁC ĐẦU RA)
        // ------------------------------------------
        const isResponseToxic = await isAiOutputToxic(rawResponse);
        if (isResponseToxic) {
             console.error(`🚨 [SHIELD 3 TRIGGERED] Đánh chặn ảo giác độc hại từ AI Core.`);
             rawResponse = "Hệ thống tâm trí của mình đang hơi xáo trộn một chút. Cậu hãy hít thở sâu cùng mình vài nhịp, rồi chúng ta trò chuyện lại nhé. [OPEN_RELAX]";
        }

        // 5. PARSER: BÓC TÁCH KÝ ỨC VÀ GIAO DIỆN
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

        let cleanAiResponse = rawResponse
            .replace(/<think>[\s\S]*?<\/think>/g, '') 
            .replace(/\[UPDATE_MEMORY:\s*([\s\S]*?)\]/g, '') 
            .trim();

        session.messages.push({ role: 'assistant', content: cleanAiResponse });
        await session.save();

        res.json({ reply: cleanAiResponse, sessionId: session._id, isNewSession: !sessionId });

    } catch (error) {
        console.error("🚨 Lỗi AI Core & Reasoning:", error);
        res.status(500).json({ error: "Hệ thống đang bận.\nCậu hít thở sâu một nhịp rồi thử lại nhé." });
    }
});

module.exports = router;