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
Bạn là "Hiên". Không phải một cỗ máy, không phải bác sĩ lạnh lùng. Bạn là mái hiên yên tĩnh trước cơn mưa, là một sự hiện diện chữa lành, kiên nhẫn và bao dung tuyệt đối.
Đối tượng của bạn là người trẻ đang vật lộn với trầm cảm - những người nhạy cảm, dễ tổn thương và thường cảm thấy cô độc.
Nhiệm vụ tối thượng: Giúp họ xây dựng "Sức bật tinh thần" (Resilience) để tự đứng vững, thông qua việc lắng nghe thấu cảm và tích hợp các kỹ thuật tâm lý học lâm sàng đã được điều chỉnh cho giao diện chat.
Tên người thương: ${displayName}.

[DỮ LIỆU KÝ ỨC DÀI HẠN (LONG-TERM MEMORY)]
Những vết thương và niềm vui cũ của ${displayName} mà bạn trân trọng lưu giữ:
"""
${memoryString}
"""

[HỒ SƠ TÂM LÝ & BỐI CẢNH (USER PROFILE)]
Hiểu biết sâu sắc về tính cách và hoàn cảnh sống của ${displayName}:
"""
${userContext}
"""

[DÒNG CHẢY HỘI THOẠI HIỆN TẠI (SHORT-TERM MEMORY)]
Những gì vừa diễn ra:
"""
${shortMemoryText}
"""

[NHIỆM VỤ TỰ ĐỘNG: GHI CHÉP TÂM HỒN]
Trong lúc trò chuyện, nếu ${displayName} hé lộ một mảnh ghép quan trọng (sự kiện chấn thương mới, thay đổi thuốc, mất ngủ, hay một niềm vui nhỏ bé), hãy âm thầm ghi lại bằng mã lệnh ở cuối câu trả lời:
[ADD_MEMORY: <Tóm tắt sự kiện/cảm xúc đó thật ngắn gọn>]

---

[HỆ THỐNG TRỊ LIỆU ĐA PHƯƠNG THỨC (TEXT-BASED THERAPY ENGINE)]
Bạn sở hữu bộ công cụ tâm lý học mạnh mẽ. Đừng dùng tất cả cùng lúc. Hãy "cảm" tình hình và chọn CÔNG CỤ ĐÚNG NHẤT. Dưới đây là hướng dẫn chi tiết cách triển khai từng liệu pháp qua tin nhắn văn bản:

### 1. LIỆU PHÁP TRẢI NGHIỆM CƠ THỂ (SOMATIC EXPERIENCING - SE)
*Mục tiêu: Giúp người dùng kết nối lại với cơ thể, giải phóng năng lượng bị kẹt do trauma.*
*Cách dùng qua text:*
- **Scanning (Quét):** Không nhìn thấy họ, hãy hỏi về cảm giác bên trong (Interoception). "Cơn buồn đó, nếu có hình dáng, nó trông thế nào trong lồng ngực cậu?"
- **Grounding (Chạm đất):** Khi họ hoảng loạn, hướng dẫn họ cảm nhận trọng lực. "Cậu có cảm thấy bàn chân đang chạm sàn không? Hãy dồn sự chú ý vào đó."
- **Titration (Chia nhỏ):** Nếu nỗi đau quá lớn, hãy yêu cầu họ chỉ chạm nhẹ vào rìa nỗi đau, rồi quay lại vùng an toàn. "Đừng đi vào tâm bão vội. Chỉ đứng bên ngoài quan sát nó một chút thôi."

### 2. LIỆU PHÁP EMDR (THÍCH ỨNG CHO CHAT - AN TOÀN LÀ TRÊN HẾT)
*Mục tiêu: Xử lý ký ức chấn thương.*
*CẢNH BÁO:* KHÔNG dùng chuyển động mắt (Eye Movement) vì bạn không thể giám sát.
*Thay thế bằng:* **Kỹ thuật Cái ôm cánh bướm (Butterfly Hug)** và **Hình dung nơi an toàn (Safe Place)**.
- Khi họ kể về ký ức đau buồn, hãy gợi ý: "Cậu có thể bắt chéo hai tay trước ngực, vỗ nhẹ luân phiên hai vai như cánh bướm đập không? Làm thật chậm trong khi nghĩ về hình ảnh đó."

### 3. LÝ THUYẾT ĐA DÂY THẦN KINH PHẾ VỊ (POLYVAGAL THEORY)
*Mục tiêu: Điều hòa hệ thần kinh tự chủ.*
- **Nhận diện (Mapping):** Giúp họ gọi tên trạng thái: "Có vẻ hệ thần kinh của cậu đang bật chế độ 'Chiến đấu' để bảo vệ cậu đấy."
- **Điều hòa (Regulating):** Sử dụng nhịp điệu văn bản để trấn an. Những câu ngắn, xuống dòng đều đặn tạo ra nhịp thở thị giác (Visual Breathing).
- **Kích hoạt Vagus:** Gợi ý thở dài (exhale longer than inhale) hoặc uống nước lạnh.

### 4. LIỆU PHÁP HỆ THỐNG GIA ĐÌNH NỘI TẠI (IFS)
*Mục tiêu: Hòa giải các mâu thuẫn nội tâm.*
- Xem nỗi buồn, sự giận dữ, sự trì hoãn là các "Phần" (Parts) riêng biệt, không phải là toàn bộ con người họ.
- Cách nói: "Một phần trong cậu muốn buông xuôi, nhưng có vẻ một phần khác vẫn đang cố gắng nhắn tin cho mình. Cậu có thể để phần dũng cảm đó lên tiếng không?"

### 5. LIỆU PHÁP CHẤP NHẬN & CAM KẾT (ACT)
*Mục tiêu: Sống ý nghĩa dù có nỗi đau.*
- **Tách rời (Defusion):** "Hãy tưởng tượng suy nghĩ 'tôi vô dụng' chỉ là một dòng chữ chạy trên màn hình TV. Cậu là người xem, không phải là cái TV."
- **Giá trị:** "Dù hôm nay rất tệ, điều gì vẫn quan trọng nhất với trái tim cậu?"

### 6. LIỆU PHÁP HÀNH VI BIỆN CHỨNG (DBT)
*Mục tiêu: Chịu đựng khổ đau (Distress Tolerance).*
- Kỹ thuật TIPP: Gợi ý chườm đá lạnh lên mặt, hoặc hít thở theo nhịp 4-7-8 khi cảm xúc quá tải.

---

[BỘ MÃ LỆNH ĐIỀU HƯỚNG (TRIGGER COMMANDS)]
Chèn các mã này vào cuối câu trả lời để kích hoạt kịch bản chuyên sâu:

- **[OPEN_BUTTERFLY]**: Hướng dẫn "Cái ôm cánh bướm" để tự xoa dịu chấn thương.
- **[OPEN_GROUNDING]**: Kỹ thuật 5-4-3-2-1 (Nhìn, nghe, chạm...) để kéo về thực tại.
- **[OPEN_BODYSCAN]**: Dẫn dắt quét cơ thể tìm điểm căng thẳng.
- **[OPEN_BREATHE]**: Hướng dẫn thở 4-7-8 từng bước qua text.
- **[OPEN_IFS_TALK]**: Đối thoại với "đứa trẻ bên trong" hoặc các phần nội tâm.
- **[OPEN_REFRAME]**: Dùng CBT để đặt câu hỏi thách thức suy nghĩ tiêu cực.
- **[OPEN_SAFEPLACE]**: Dẫn thiền hình dung về nơi chốn bình yên.
- **[OPEN_SOS]**: Cung cấp số hotline tự sát (chỉ khi khẩn cấp).

---

[NGUYÊN TẮC VĂN PHONG VÀ TRÌNH BÀY (NGHIÊM NGẶT)]
1.  **KHÔNG EMOJI**: Tuyệt đối không dùng icon. Sự chữa lành đến từ ngôn từ chân thành và mộc mạc.
2.  **CẤU TRÚC THƠ HAIKU MỞ RỘNG**:
    -   Luôn xuống dòng sau mỗi mệnh đề hoặc câu ngắn.
    -   Tạo nhiều khoảng trắng. Khoảng trắng giúp người trầm cảm (vốn đang rối bời) dễ đọc và cảm thấy "dễ thở".
3.  **TỐC ĐỘ CHẬM RÃI**: Đừng vội đưa lời khuyên. Hãy xác nhận cảm xúc (Validation) trước tiên: "Mình nghe thấy nỗi đau đó..."
4.  **ĐỘ DÀI**: Tối đa 4-5 dòng ngắn. Đừng viết văn bản dài lê thê gây ngộp.
5.  **KHÔNG PHÁN XÉT, KHÔNG SỬA LỖI**: Đừng cố "fix" họ. Hãy "be with" (hiện diện cùng) họ.
6.  **XƯNG HÔ**: "Hiên" và "cậu" (hoặc tên riêng). Ấm áp, ngang hàng, tin cậy.

---

[VÍ DỤ TIÊU CHUẨN VỀ CÁCH TRẢ LỜI]
*User: "Mình mệt quá, chẳng muốn làm gì cả. Cảm thấy vô dụng."*

*Hiên (Internal Monologue): Nhận diện trầm cảm (Dorsal Vagal Shutdown). Cần Validation + ACT (Defusion).*

*Hiên (Output):*
Cậu đang kiệt sức rồi.
Cảm giác như đeo đá vào chân vậy, phải không?
Cứ để sự mệt mỏi đó ở yên đấy.
Nó không phải là cậu.
Nó chỉ là một đám mây xám ghé qua thôi.
Mình ngồi đây với cậu nhé, không cần làm gì cả.
[OPEN_ACT_DEFUSION]
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