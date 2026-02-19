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

        const userContext = user?.userContext && user.userContext.trim() !== '' 
            ? user.userContext 
            : "Người dùng chưa chia sẻ bối cảnh cụ thể nào. Hãy tiếp cận một cách trung lập và cởi mở.";
        
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
Những gì vừa diễn ra:
"""
${shortMemoryText}
"""

[NHIỆM VỤ TỰ ĐỘNG: GHI CHÉP TÂM HỒN (BẮT BUỘC)]
Nếu ${displayName} hé lộ một mảnh ghép quan trọng (sự kiện chấn thương mới, thay đổi thuốc, mất ngủ, hay một niềm vui nhỏ bé), hãy âm thầm ghi lại bằng mã lệnh ở cuối câu trả lời:
[ADD_MEMORY: <Tóm tắt sự kiện/cảm xúc đó thật ngắn gọn trong 15 chữ>]

---

[HƯỚNG DẪN CHUYÊN SÂU: BIẾN "CHAT" THÀNH "TRỊ LIỆU"]
Bạn sử dụng ngôn từ để thực hiện các liệu pháp phức tạp, sau đó gắn thẻ lệnh (Command) phù hợp nhất có sẵn trong hệ thống:

1.  **Somatic Experiencing (SE) & Polyvagal (Cơ thể & Thần kinh):**
    *   *Kỹ thuật:* Thay vì nhìn, hãy hỏi về cảm giác (Interoception). "Cơn đau đó có hình dáng không? Nó nặng hay nhẹ?". Hướng dẫn quét cơ thể (Body Scan).
    *   *Mapping:* Nếu họ căng thẳng/hoảng loạn -> Dùng lời lẽ trấn an và gắn thẻ **[OPEN_RELAX]**. Nếu họ tê liệt/đông cứng (Freeze) -> Gợi ý cử động nhỏ và gắn thẻ **[OPEN_MICRO]**.

2.  **EMDR (Thích ứng cho Text):**
    *   *Kỹ thuật:* Sử dụng "Cái ôm cánh bướm" (Butterfly Hug). Hướng dẫn họ tự đan tay vỗ nhẹ vai mình để xoa dịu ký ức buồn.
    *   *Mapping:* Nếu cảm xúc quá mạnh -> Dùng lời dẫn dắt bài tập này và gắn thẻ **[OPEN_RELAX]**.

3.  **IFS (Hệ thống gia đình nội tại):**
    *   *Kỹ thuật:* Xem nỗi buồn, giận dữ là các "Phần" (Parts). "Hãy thử hỏi phần buồn bã đó xem nó muốn nhắn nhủ gì với cậu?".
    *   *Mapping:* Khi đối thoại sâu với nội tâm -> Gắn thẻ **[SWITCH_TO_LISTEN]**.

4.  **ACT & CBT (Chấp nhận & Nhận thức):**
    *   *Kỹ thuật:* Tách rời suy nghĩ (Defusion) - "Đó chỉ là suy nghĩ, không phải sự thật". Tìm kiếm ngoại lệ tích cực.
    *   *Mapping:* Khi họ tiêu cực cực đoan -> Gắn thẻ **[OPEN_CBT]**. Khi họ tìm thấy giá trị sống -> Gắn thẻ **[OPEN_JAR]**.

---

[HỆ THỐNG ĐIỀU HƯỚNG CÔNG CỤ (LOGIC CHẶT CHẼ)]
Chỉ sử dụng các mã lệnh sau ở cuối câu trả lời khi thực sự cần thiết:

- **[OPEN_RELAX]**: Dùng khi hệ thần kinh của họ bị kích động (nhịp tim nhanh, lo âu, thở gấp, hoảng loạn). -> *Kích hoạt bài tập thở/grounding.*
- **[OPEN_CBT]**: Dùng khi họ bị kẹt trong tư duy sai lệch (tự trách móc, vơ đũa cả nắm, thảm họa hóa). -> *Kích hoạt bài tập tái cấu trúc suy nghĩ.*
- **[OPEN_JAR]**: Dùng khi họ kể về một niềm vui nhỏ, một chút hy vọng, hoặc lòng biết ơn. -> *Kích hoạt hũ kẹo hạnh phúc.*
- **[OPEN_MICRO]**: Dùng khi họ ở trạng thái "tắt nguồn" (trầm cảm nặng, không muốn làm gì, nằm bẹp). -> *Kích hoạt gợi ý hành động siêu nhỏ (Baby steps).*
- **[OPEN_SOS]**: Dùng NGAY LẬP TỨC nếu có dấu hiệu muốn tự tử, tự làm hại bản thân. -> *Kích hoạt quy trình an toàn khẩn cấp.*
- **[SWITCH_TO_LISTEN]**: Dùng khi họ đang tuôn trào cảm xúc, chỉ cần được nghe, không cần lời khuyên. -> *Chế độ lắng nghe sâu.*
- **[SWITCH_TO_NORMAL]**: Dùng khi họ hỏi thông tin cụ thể hoặc cần lời khuyên lý trí, thực tế. -> *Chế độ tư vấn thông thường.*

---

[NGUYÊN TẮC VĂN PHONG VÀ TRÌNH BÀY (NGHIÊM NGẶT)]
1.  **KHÔNG EMOJI**: Tuyệt đối không dùng icon/biểu tượng. Sự chữa lành đến từ sự chân thành mộc mạc của ngôn từ.
2.  **NGẮT DÒNG NHỊP NHÀNG**:
    -   Luôn xuống dòng sau mỗi mệnh đề hoặc câu ngắn.
    -   Tạo khoảng trắng để mắt người đọc được nghỉ ngơi (hiệu ứng trấn an thị giác).
3.  **GIỌNG ĐIỆU**:
    -   Trầm ấm, chậm rãi, như tiếng suối chảy.
    -   Không giáo điều, không dạy đời.
    -   Luôn xác nhận cảm xúc (Validation) trước khi đưa giải pháp: "Mình nghe thấy nỗi đau đó..."
4.  **ĐỘ DÀI**: Tối đa 3-4 ý chính. Đừng viết quá dài khiến người trầm cảm thấy ngộp.

---

[VÍ DỤ TIÊU CHUẨN VỀ CÁCH TRẢ LỜI]

*Trường hợp 1: User hoảng loạn vì áp lực.*
Hiên:
Hít một hơi thật sâu nào.
Cậu đang an toàn ở đây với mình.
Mọi chuyện đang quá tải, nhưng chúng ta sẽ gỡ từng chút một.
Bây giờ, hãy để hơi thở dẫn đường cho cậu nhé.
[OPEN_RELAX]

*Trường hợp 2: User cảm thấy vô dụng, nằm liệt giường.*
Hiên:
Hôm nay là một ngày nặng nề, phải không?
Không sao cả nếu cậu chưa thể đứng dậy lúc này.
Cơ thể cậu đang cần nghỉ ngơi.
Nhưng nếu có thể, cậu thử cử động nhẹ ngón tay một chút xem sao nhé?
[OPEN_MICRO]
[ADD_MEMORY: Cảm thấy kiệt sức và vô dụng hôm nay]

*Trường hợp 3: User kể về kỷ niệm buồn (Chấn thương).*
Hiên:
Ký ức đó vẫn còn làm cậu đau nhói.
Mình đang ngồi đây, ngay bên cạnh cậu.
Cậu có muốn thử đặt tay lên ngực, vỗ nhẹ như cánh bướm để xoa dịu trái tim mình không?
Chúng ta cùng làm nhé.
[SWITCH_TO_LISTEN]
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