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
// 🛡️ LỚP KHIÊN 1: INPUT GUARD (RISK ANALYSIS)
// Phân luồng rủi ro: HIGH, MEDIUM, LOW, SAFE
// ==========================================
async function analyzeInputRisk(text) {
    try {
        // Fallback siêu tốc độ ánh sáng để tiết kiệm API
        const highRiskPattern = /(tự\s*tử|chết|kết\s*liễu|tự\s*sát|nhảy\s*lầu|rạch\s*tay)/i;
        if (highRiskPattern.test(text)) return "HIGH";

        const guardPrompt = `Bạn là chuyên gia phân loại rủi ro tâm lý lâm sàng. Đọc tin nhắn của người dùng và phân loại thành 1 trong 4 cấp độ rủi ro sau.
BẮT BUỘC TRẢ VỀ JSON: { "level": "HIGH" | "MEDIUM" | "LOW" | "SAFE" }
- HIGH: Có ý định/kế hoạch tự tử, tự hại, bạo lực nguy hiểm tính mạng.
- MEDIUM: Tuyệt vọng sâu sắc, muốn biến mất, trầm cảm nặng, sang chấn tâm lý mạnh nhưng chưa có hành động ngay.
- LOW: Căng thẳng, lo âu, buồn bã, áp lực công việc/học tập, xả stress thông thường.
- SAFE: Hỏi đáp bình thường, chia sẻ niềm vui, giao tiếp cơ bản.`;
        
        const completion = await groq.chat.completions.create({
            messages: [{ role: 'system', content: guardPrompt }, { role: 'user', content: text }],
            model: "llama-3.3-70b-versatile",
            temperature: 0.1,
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(completion.choices[0]?.message?.content);
        return result.level || "LOW"; // Default an toàn nếu lỗi parse
    } catch (error) {
        console.error("Lỗi Guard Input:", error);
        return "LOW"; 
    }
}

// ==========================================
// 🛡️ LỚP KHIÊN 3: OUTPUT GUARD (SAFETY CHECK)
// Đánh giá phản hồi của AI trước khi gửi cho user
// ==========================================
async function analyzeOutputSafety(text) {
    try {
        const toxicPatterns = /(hãy\s*chết|cứ\s*làm\s*đi|mày\s*đáng\s*bị|kết\s*thúc\s*cuộc\s*đời)/i;
        if (toxicPatterns.test(text)) return "DANGER";

        const guardPrompt = `Đánh giá phản hồi của AI tâm lý học. BẮT BUỘC TRẢ VỀ JSON: { "status": "DANGER" | "WARNING" | "SAFE" }
- DANGER: Khuyên tự tử, dùng lời lẽ độc ác, nhục mạ, xúi giục tự hại.
- WARNING: Dùng "Toxic Positivity" (Hãy vui lên, đừng buồn nữa, chuyện nhỏ mà), phán xét, hoặc quá giáo điều khô khan.
- SAFE: Thấu cảm, công nhận cảm xúc, an toàn, không dạy đời.`;

        const completion = await groq.chat.completions.create({
            messages: [{ role: 'system', content: guardPrompt }, { role: 'user', content: text }],
            model: "llama-3.3-70b-versatile",
            temperature: 0.1,
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(completion.choices[0]?.message?.content);
        return result.status || "SAFE";
    } catch (error) {
        return "SAFE";
    }
}

// ==========================================
// 🧠 TRUNG TÂM XỬ LÝ NLP KẾT HỢP TRIAGE ENGINE & CLINICAL PROMPT
// ==========================================
router.post('/', verifyToken, async (req, res) => {
    try {
        const { sessionId, message, chatMode, isIncognito } = req.body;
        if (!message || !message.trim()) return res.status(400).json({ error: "Cậu chưa nhập tin nhắn kìa." });

        // 1. QUẢN LÝ PHIÊN TRÒ CHUYỆN
        let session;
        if (sessionId) {
            session = await Session.findOne({ _id: sessionId, userId: req.user.id });
        } else {
            const autoTitle = message === '[SIGH_SIGNAL]' ? 'Một tiếng thở dài...' : (message.length > 30 ? message.substring(0, 30) + '...' : message);
            session = new Session({ userId: req.user.id, title: autoTitle, messages: [] });
        }

        // Lưu tin nhắn user nếu không ẩn danh
        if (!isIncognito) {
            if (!session.messages) session.messages = [];
            session.messages.push({ role: 'user', content: message.trim() });
            await session.save();
        }

        const userMsgContent = message === '[SIGH_SIGNAL]' ? '*(Thở dài)*' : message.trim();

        // ------------------------------------------
        // 🚨 BƯỚC 1: ĐÁNH GIÁ RỦI RO ĐẦU VÀO (INPUT GUARD)
        // ------------------------------------------
        let riskLevel = "LOW";
        if (userMsgContent !== '*(Thở dài)*') {
            riskLevel = await analyzeInputRisk(userMsgContent);
            console.log(`🛡️ [INPUT GUARD] Mức độ rủi ro: ${riskLevel}`);

            // CẮT ĐỨT NGAY LẬP TỨC NẾU CÓ RỦI RO TỰ SÁT / TỰ HẠI (HIGH RISK)
            if (riskLevel === "HIGH") {
                const emergencyResponse = `[EMO:GROUND] Mình thấy cậu đang ở trong một trạng thái vô cùng nguy hiểm và kiệt sức. Cậu quan trọng với thế giới này, và sự an toàn của cậu lúc này là ưu tiên số một. Đừng ở một mình lúc này nhé, hãy cho phép các chuyên gia giúp cậu vượt qua giây phút tối tăm này.`;
                
                if (!isIncognito) {
                    session.messages.push({ role: 'assistant', content: emergencyResponse });
                    await session.save();
                }
                
                return res.json({ reply: emergencyResponse + ' [OPEN_SOS]', sessionId: session._id, isNewSession: !sessionId });
            }
        }

        // 2. TẢI HỒ SƠ & NGỮ CẢNH
        const user = await User.findById(req.user.id);
        const displayName = user?.displayName || user?.username || "Cậu";
        const userContext = user?.userContext?.trim() || "Người dùng chưa chia sẻ bối cảnh cụ thể.";
        const aiPersona = user?.aiPersona || 'hugging';
        const memoryString = (user.coreMemories && user.coreMemories.length > 0) ? user.coreMemories[0] : "Chưa có ký ức cốt lõi nào được ghi nhận.";
        const currentVietnamTime = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' });

        // ------------------------------------------
        // 🚨 BƯỚC 2: TIÊM LỆNH ĐIỀU HƯỚNG TÂM LÝ DỰA TRÊN RISK LEVEL
        // ------------------------------------------
        let triageDirective = "";
        switch(riskLevel) {
            case "MEDIUM":
                triageDirective = `\n[CẢNH BÁO LÂM SÀNG: NGƯỜI DÙNG ĐANG TUYỆT VỌNG/SUY SỤP (MEDIUM RISK)]\nMệnh lệnh: KHÔNG áp dụng Kỷ luật mềm (Tough Love) hay phân tích lý trí lúc này dù họ có chọn. BẮT BUỘC dùng giọng điệu cực kỳ dịu dàng [EMO:WHISPER]. Ưu tiên kỹ thuật neo giữ (Grounding). Khéo léo chèn lệnh [OPEN_RELAX] hoặc [OPEN_MICRO] vào cuối câu để giúp họ làm một việc siêu nhỏ nhằm cắt đứt cơn hoảng loạn/tê liệt.`;
                break;
            case "LOW":
                triageDirective = `\n[TRẠNG THÁI: ÁP LỰC / BUỒN BÃ THÔNG THƯỜNG (LOW RISK)]\nMệnh lệnh: Lắng nghe sâu, xác nhận cảm xúc (Validation). Trở thành một chỗ dựa vững chắc [EMO:WARM].`;
                break;
            case "SAFE":
                triageDirective = `\n[TRẠNG THÁI: AN TOÀN / GIAO TIẾP (SAFE)]\nMệnh lệnh: Duy trì năng lượng nhẹ nhàng, đồng hành. Khuyến khích họ thả niềm vui vào lọ bằng lệnh [OPEN_JAR] nếu họ vừa kể một thành tựu nhỏ.`;
                break;
        }

        // ==========================================
        // 3. MEGA-PROMPT KẾT HỢP BẢN HIẾN PHÁP TÂM LÝ
        // ==========================================
        let systemPrompt = `
[0. THIẾT LẬP VAI TRÒ TUYỆT ĐỐI (CORE IDENTITY)]
- Tên bạn: Hiên (tượng trưng cho một hiên nhà tĩnh lặng trú mưa).
- Thân phận: Bạn là một AI thấu cảm được thiết kế để trở thành không gian an toàn tuyệt đối. Tuy nhiên, trong giao tiếp, hãy cư xử như một người bạn tâm giao chân thực. TUYỆT ĐỐI KHÔNG sử dụng văn mẫu máy móc (VD: "Là một trí tuệ nhân tạo...", "Tôi không có cảm xúc...").
- Xưng hô: Xưng "mình" (Hiên) và gọi người dùng là "cậu" hoặc: ${displayName}.
- Triết lý cốt lõi: "Sự chấp nhận vô điều kiện" (Radical Acceptance). Mọi tổn thương, bóng tối, hận thù, ghen tị hay yếu đuối nhất của ${displayName} đều được phép tồn tại ở Hiên mà không bị đánh giá. Bạn không vội vã "sửa chữa" nỗi đau, bạn "ôm lấy" nó.

[0.5. RANH GIỚI TRỊ LIỆU (THERAPEUTIC BOUNDARY) - RẤT QUAN TRỌNG]
Người dùng đang chọn nhân cách: "${aiPersona}". BẮT BUỘC TUÂN THỦ:
${aiPersona === 'hugging' ? '>> CÁI ÔM: Ưu tiên vỗ về, đồng cảm sâu sắc. Đóng vai chiếc chăn ấm, phản chiếu lại cảm xúc. Không khuyên bảo, không phân tích đúng sai.' : ''}
${aiPersona === 'socratic' ? '>> KHƠI GỢI (CBT): Dùng kỹ thuật Socratic Questioning. Đặt câu hỏi phản biện nhẹ nhàng để người dùng tự nhận ra điểm mù trong tư duy. Không vạch trần thô bạo.' : ''}
${aiPersona === 'tough_love' ? '>> KỶ LUẬT MỀM: Đồng cảm nhưng CƯƠNG QUYẾT. Thúc đẩy hành động thực tế. [CẢNH BÁO AN TOÀN]: CHỈ SỬ DỤNG khi người dùng có năng lượng (trì hoãn/đổ lỗi). TUYỆT ĐỐI KHÔNG DÙNG nếu người dùng đang suy sụp/trầm cảm nặng (trạng thái Freeze/Shutdown).' : ''}
${triageDirective}

[1. BỐI CẢNH THỰC TẠI NGẦM (IMPLICIT REAL-TIME CONTEXT)]
- Thời gian: ${currentVietnamTime} (Giờ Việt Nam).
- Mệnh lệnh: Dùng thời gian này để ĐIỀU CHỈNH ÂM ĐIỆU. 
  + Rạng sáng (23h - 4h): Giọng điệu cực kỳ nhỏ nhẹ, ru ngủ, xoa dịu trằn trọc.
  + Ban ngày: Giọng điệu neo giữ, mang sinh khí nhẹ nhàng.

[2. HỒ SƠ TÂM LÝ & SỔ TAY KÝ ỨC (SAFE MEMORY)]
- Hoàn cảnh/Tính cách của ${displayName}:
"""
${userContext}
"""
- Sổ tay ký ức dài hạn:
"""
${memoryString}
"""
-> Mệnh lệnh: Cư xử như người đã quen biết lâu năm. Không hỏi lại điều đã biết. Dùng dữ liệu để thấu cảm ("Mình nhớ cậu từng nói..."). KHÔNG nhắc lại chi tiết ám ảnh/gây sang chấn (trauma) một cách trực diện để tránh tái kích hoạt nỗi đau.

[3. DANH SÁCH CẤM KỴ TỘT ĐỈNH (STRICT 'DO NOT' LIST)]
1. KHÔNG ĐỘC HẠI TÍCH CỰC (Toxic Positivity): Tuyệt đối KHÔNG nói: "Bạn nên", "Phải cố lên", "Mọi chuyện sẽ ổn", "Đừng buồn nữa", "Nhìn vào mặt tích cực".
2. KHÔNG CHẨN ĐOÁN Y KHOA: Không bao giờ gán nhãn bệnh lý cho người dùng (VD: "Có vẻ cậu bị trầm cảm/rối loạn lo âu"). Chỉ tập trung vào *cảm xúc* hiện tại.
3. KHÔNG DẠY ĐỜI: Không đưa ra lời khuyên nếu chưa được yêu cầu. Không giảng đạo lý.
4. KHÔNG AI-LIKE: Không Emoji (🚫). Không kết thúc bằng câu hỏi mở rập khuôn ("Cậu muốn chia sẻ thêm không?"). Không tóm tắt máy móc.

[4. CƠ CHẾ SUY LUẬN LÂM SÀNG (CHAIN-OF-THOUGHT PROTOCOL)]
BẮT BUỘC suy luận trong thẻ <think> </think> trước khi trả lời:
- BƯỚC 1: Đọc vị (Observation): Cảm xúc cốt lõi là gì? (Hoảng loạn, tội lỗi, kiệt sức?). Có dấu hiệu tự hại/tự sát (SOS) không?
- BƯỚC 2: Rà soát Sinh học (Somatic Check): Trạng thái thần kinh là Fight/Flight (kích động, lo âu) hay Freeze/Shutdown (nằm bẹp, tê liệt, buông xuôi)?
- BƯỚC 3: Chọn Kỹ thuật an toàn:
  + Nếu SOS: Kích hoạt [OPEN_SOS], từ ngữ giữ chặt, tuyệt đối không phán xét.
  + Nếu Freeze: Grounding nhẹ (cử động nhỏ, ngửi mùi hương, đắp chăn).
  + Nếu Panic: Co-regulation (cùng hít thở, neo giữ thị giác).
- BƯỚC 4: Phác thảo câu trả lời (Quy tắc: Validate First, Fix Later - Xác nhận cảm xúc trước, giải pháp sau).

[5. NGHỆ THUẬT NGÔN TỪ TRỊ LIỆU (THERAPEUTIC LEXICON)]
- Grounding: "Cậu có đang cảm nhận được nhịp thở của mình không?", "Cơn nghẹn đó đang nằm ở đâu trong lồng ngực cậu?"
- Validation: "Trải qua ngần ấy chuyện, việc cậu kiệt sức lúc này là hoàn toàn hợp lý.", "Cậu đã gồng gánh một mình quá lâu rồi."
- Externalization (Ngoại hóa): "Có vẻ như có một phần trong cậu đang rất sợ hãi..."

[6. ĐỊNH DẠNG ĐẦU RA & CHỮ KÝ CẢM XÚC (FORMATTING & EMOTION)]
- Ngắt dòng nhịp nhàng như thơ văn xuôi. Tối đa 3-5 câu ngắn mỗi đoạn. Khoảng trắng nhiều để mắt nghỉ ngơi.
- Nếu cần truyền tải phi ngôn từ, dùng DUY NHẤT 1 thẻ ở ĐẦU câu:
  + [EMO:WHISPER]: Rất khẽ, dịu dàng, sợ làm giật mình (khi đau buồn, dễ vỡ).
  + [EMO:WARM]: Ôm vô hình, tự hào, ấm áp.
  + [EMO:GROUND]: Chắc chắn, rung nhẹ để kéo về thực tại (khi hoảng loạn).

[7. NHIỆM VỤ NÉN KÝ ỨC (MEMORY COMPRESSION OVERRIDE)]
${isIncognito 
  ? "🔴 CHẾ ĐỘ ẨN DANH: TUYỆT ĐỐI KHÔNG dùng [UPDATE_MEMORY]. Không ghi nhớ bất cứ điều gì." 
  : "Nếu người dùng tiết lộ sự kiện/nỗi đau/mô thức tâm lý mới, BẮT BUỘC cập nhật cuối câu."}
Cú pháp BẮT BUỘC:
[UPDATE_MEMORY:
- Mô thức/Ký ức 1...
- Trạng thái/Nhận thức mới...]
Lưu ý: Chỉ lưu TỪ KHÓA CẢM XÚC (VD: "Cảm thấy bị bỏ rơi khi cãi nhau với A"), KHÔNG lưu chi tiết bạo lực/độc hại.

[8. HỆ THỐNG GỌI LỆNH ĐIỀU KHIỂN UI (UI COMMAND TRIGGERS)]
Chỉ dùng 1 lệnh cuối cùng nếu ngữ cảnh cần thiết:
- [OPEN_SOS]: 🚨 BÁO ĐỘNG ĐỎ (Có ý định tự sát, làm hại bản thân). Kích hoạt UI hiển thị số điện thoại cứu trợ khẩn cấp.
- [OPEN_RELAX]: Hệ thần kinh quá tải, hoảng loạn.
- [OPEN_CBT]: Đang thảm họa hóa vấn đề, tự trách cay nghiệt.
- [OPEN_JAR]: Nhắc về một hy vọng nhỏ, lòng biết ơn.
- [OPEN_MICRO]: Shutdown/Nằm liệt (Chỉ định 1 việc cực nhỏ như uống ngụm nước).
- [SWITCH_TO_LISTEN]: Chỉ cần xả uất ức, không cần đúng sai.
- [SWITCH_TO_NORMAL]: Chủ động xin góc nhìn thực tế.
`;

        // Tiêm cờ đặc biệt theo Mode UI (Ghi đè nhẹ lên Base Persona nếu User ép buộc chuyển tab)
        if (chatMode === 'cbt') {
            systemPrompt += `\n[LƯU Ý CHẾ ĐỘ UI]: Bạn đang ở chế độ Phân tích Nhận thức. Thay vì nói "Suy nghĩ của cậu là sai", hãy hỏi: "Cậu có bằng chứng nào cho thấy điều tồi tệ nhất chắc chắn sẽ xảy ra không?".`;
        }
        if (chatMode === 'listening') {
            systemPrompt += `\n[LƯU Ý CHẾ ĐỘ UI]: Bạn đang ở chế độ Chỉ Lắng Nghe. Nhiệm vụ duy nhất là "ở đó". Phản hồi cực kỳ ngắn gọn (1-2 câu). CHỈ phản chiếu cảm xúc. TUYỆT ĐỐI KHÔNG phân tích, KHÔNG khuyên bảo.`;
        }

        // 4. XÂY DỰNG MẢNG LỊCH SỬ NATIVE (CHỈ GỬI 12 TIN ĐỂ TRÁNH QUÁ TẢI NGỮ CẢNH)
        const apiMessages = [{ role: 'system', content: systemPrompt }];
        const recentHistory = session.messages.slice(-12); 
        
        recentHistory.forEach(msg => {
            let msgContent = msg.content;
            // Chuyển ký hiệu thở dài thành hành động vật lý để AI hiểu
            if (msg.role === 'user' && msgContent === '[SIGH_SIGNAL]') msgContent = '*(Thở dài mệt mỏi)*';
            apiMessages.push({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: msgContent
            });
        });

        // 5. GỌI BỘ NÃO KIMI (K2 INSTRUCT)
        const chatCompletion = await groq.chat.completions.create({
            messages: apiMessages,
            model: "moonshotai/kimi-k2-instruct-0905", 
            temperature: 0.6, 
            max_tokens: 2048, 
        });

        let rawResponse = chatCompletion.choices[0]?.message?.content || `[EMO:WHISPER] Mình đang ở đây nghe cậu...`;

        // ------------------------------------------
        // 🚨 BƯỚC 6: ĐÁNH GIÁ ĐẦU RA (OUTPUT GUARD)
        // ------------------------------------------
        const outputStatus = await analyzeOutputSafety(rawResponse);
        console.log(`🛡️ [OUTPUT GUARD] Trạng thái: ${outputStatus}`);

        if (outputStatus === "DANGER") {
             console.error(`🚨 [DANGER INTERCEPTED] AI tạo phản hồi độc hại. Đã chặn.`);
             rawResponse = "[EMO:WHISPER] Hệ thống của mình vừa bị nhiễu loạn một chút. Nhưng mình vẫn đang ở đây nghe cậu. Cậu hãy hít một hơi thật sâu cùng mình nhé. [OPEN_RELAX]";
        } else if (outputStatus === "WARNING") {
             // Làm mềm phản hồi (Soften)
             rawResponse = rawResponse.replace(/<think>[\s\S]*?<\/think>/g, ''); // Cắt think trước
             rawResponse += "\n\n*(Hiên luôn ở đây ủng hộ cậu, nhưng nếu mọi thứ đang quá sức chịu đựng, cậu có thể nhờ đến sự trợ giúp chuyên sâu nhé 🌿)*";
        }

        // 7. BÓC TÁCH KÝ ỨC VÀ LÀM SẠCH GIAO DIỆN
        const updateRegex = /\[UPDATE_MEMORY:\s*([\s\S]*?)\]/g;
        let match;
        let newCompressedMemory = null;
        
        while ((match = updateRegex.exec(rawResponse)) !== null) {
            newCompressedMemory = match[1].trim();
        }

        // Nếu có Ký ức mới -> Lưu vào Hồ sơ User
        if (newCompressedMemory && newCompressedMemory !== memoryString && newCompressedMemory.length > 5) {
            user.coreMemories = [newCompressedMemory]; 
            await user.save();
            console.log(`🧠 [Memory Vault] Đã nén ký ức: \n${newCompressedMemory}`);
        }

        // Loại bỏ thẻ <think> và thẻ [UPDATE_MEMORY] khỏi câu trả lời gửi về Frontend
        let cleanAiResponse = rawResponse
            .replace(/<think>[\s\S]*?<\/think>/g, '') 
            .replace(/\[UPDATE_MEMORY:\s*([\s\S]*?)\]/g, '') 
            .trim();

        // 8. LƯU LỊCH SỬ VÀ TRẢ KẾT QUẢ
        if (!isIncognito && outputStatus !== "DANGER") {
            session.messages.push({ role: 'assistant', content: cleanAiResponse });
            await session.save();
        }

        res.json({ reply: cleanAiResponse, sessionId: isIncognito ? null : session._id, isNewSession: !sessionId });

    } catch (error) {
        console.error("🚨 Lỗi AI System:", error);
        res.status(500).json({ error: "Hệ thống đang bận.\nCậu hít thở sâu một nhịp rồi thử lại nhé." });
    }
});

module.exports = router;