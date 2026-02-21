const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middlewares/auth');
const groq = require('../utils/groqClient');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

// --- 1. LƯU CẢM XÚC VÀ NHẬT KÝ ---
router.post('/mood', auth, async (req, res) => {
    try {
        const { mood, note } = req.body; 
        const user = await User.findById(req.userId);
        
        // 🌟 NÂNG CẤP: Ép định dạng YYYY-MM-DD theo đúng múi giờ Việt Nam
        const today = new Intl.DateTimeFormat('en-CA', { 
            timeZone: 'Asia/Ho_Chi_Minh', 
            year: 'numeric', 
            month: '2-digit', 
            day: '2-digit' 
        }).format(new Date());
        
        const existing = user.moodHistory.findIndex(m => m.date === today);
        if (existing > -1) {
            user.moodHistory[existing].mood = mood;
            user.moodHistory[existing].note = note || "";
        } else {
            user.moodHistory.push({ date: today, mood, note: note || "" });
        }

        await user.save(); 
        res.json(user.moodHistory);
    } catch (e) { 
        console.error("Lỗi lưu mood:", e);
        res.status(500).send({ error: "Lỗi lưu cảm xúc." }); 
    }
});

// --- 2. LẤY LỊCH SỬ CẢM XÚC ---
router.get('/mood', auth, async (req, res) => {
    try { 
        const user = await User.findById(req.userId); 
        res.json(user.moodHistory || []); 
    } catch (e) { res.status(500).send({ error: "Lỗi tải cảm xúc." }); }
});

// --- 3. TÍNH NĂNG MỚI: AI ĐỌC NHẬT KÝ VÀ DỰ BÁO ---
router.get('/mood/insights', auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        const last7Days = user.moodHistory.slice(-7);
        
        if (last7Days.length < 2) {
            return res.json({ insight: "Mình cần thêm dữ liệu khoảng 2-3 ngày để phân tích chính xác 'thời tiết tâm hồn' cho cậu nhé! ✨" });
        }

        const historyString = last7Days.map(m => `Ngày ${m.date}: Cảm xúc ${m.mood}, Ghi chú: "${m.note || 'Không viết gì'}"`).join(" | ");
        
        const prompt = `Bạn là chuyên gia tâm lý học. Dưới đây là nhật ký cảm xúc những ngày qua của người dùng: [${historyString}].
        Hãy viết một đoạn Tóm tắt Thời tiết Tâm hồn (2-3 câu) cực kỳ ngắn gọn, ấm áp, xưng "mình" gọi "cậu". 
        Dựa vào sự biến thiên cảm xúc và nội dung ghi chú, hãy đoán xem vấn đề chính họ đang gặp là gì và đưa ra 1 lời khuyên thực tế. Tuyệt đối không gạch đầu dòng.`;

        const completion = await groq.chat.completions.create({
            messages: [{ role: "system", content: prompt }],
            model: "moonshotai/kimi-k2-instruct-0905",
            temperature: 0.5
        });

        res.json({ insight: completion.choices[0]?.message?.content });
    } catch (e) { 
        console.error("Lỗi AI Insights:", e);
        res.status(500).json({ error: "Lỗi AI Insights" }); 
    }
});

router.post('/cbt', auth, async (req, res) => {
    try {
        const prompt = `Bạn là chuyên gia Tâm lý học hành vi (CBT). Người dùng đang có suy nghĩ tiêu cực sau: "${req.body.negativeThought}".
Hãy phân tích và BẮT BUỘC trả về CHÍNH XÁC định dạng JSON sau (không kèm text nào khác ngoài JSON):
{
  "distortion": "Tên 1 Bẫy tâm lý (Lỗi tư duy) đang mắc phải (VD: Tư duy trắng đen, Phóng đại, Cảm tính hóa, Đọc tâm trí...)",
  "analysis": "Phân tích ngắn gọn (1-2 câu) tại sao suy nghĩ này lại rơi vào bẫy tâm lý đó.",
  "reframed": "Một câu nói thay thế tích cực, thực tế và bao dung hơn để người dùng tự nhủ với bản thân."
}`;
        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: "system", content: prompt }],
            model: "moonshotai/kimi-k2-instruct-0905",
            temperature: 0.3,
            response_format: { type: "json_object" } // Ép AI trả về chuẩn JSON
        });
        
        // Chuyển chuỗi JSON từ AI thành Object
        const result = JSON.parse(chatCompletion.choices[0]?.message?.content);
        res.json(result);
    } catch (e) { 
        console.error("Lỗi CBT:", e);
        res.status(500).json({ error: "Lỗi phân tích CBT." }); 
    }
});

// Thay thế trong backend/routes/toolRoutes.js
router.post('/tts', auth, async (req, res) => {
    try {
        const tts = new MsEdgeTTS();
        await tts.setMetadata("vi-VN-HoaiMyNeural", OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
        res.setHeader('Content-Type', 'audio/mpeg');
        
        const { audioStream } = tts.toStream(req.body.text);
        // SỬ DỤNG PIPE để xả thẳng luồng âm thanh siêu tốc về Frontend
        audioStream.pipe(res); 
        
    } catch (error) { 
        if (!res.headersSent) res.status(500).json({ error: "Lỗi TTS" }); 
    }
});

// --- API LỌ ĐOM ĐÓM KÝ ỨC (FIREFLY JAR) ---
router.post('/fireflies', auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!req.body.text.trim()) return res.status(400).send({ error: "Ký ức không được để trống" });
        
        user.fireflies.push({ text: req.body.text });
        await user.save();
        res.json(user.fireflies);
    } catch (e) { res.status(500).json({ error: "Lỗi thả đom đóm." }); }
});

router.get('/fireflies', auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        res.json(user.fireflies || []);
    } catch (e) { res.status(500).json({ error: "Lỗi tải đom đóm." }); }
});

// --- API TRẠM NĂNG LƯỢNG VI MÔ (MICRO-WINS) ---
router.get('/microwins', auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        res.json({ count: user.microWinsCount || 0 });
    } catch (e) { res.status(500).json({ error: "Lỗi tải dữ liệu" }); }
});

router.post('/microwins', auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        user.microWinsCount = (user.microWinsCount || 0) + 1;
        await user.save();
        res.json({ count: user.microWinsCount });
    } catch (e) { res.status(500).json({ error: "Lỗi cập nhật" }); }
});

// --- API ĐỐT NĂNG LƯỢNG (CHIÊU CUỐI SOS) ---
router.post('/microwins/consume', auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        // Đưa năng lượng về mốc 50 (Giữ lại thể chất của cây, chỉ đốt phần Hào quang)
        if (user.microWinsCount > 50) {
            user.microWinsCount = 50;
            await user.save();
        }
        res.json({ count: user.microWinsCount });
    } catch (e) { res.status(500).json({ error: "Lỗi giải phóng năng lượng" }); }
});

// --- THÊM VÀO backend/routes/toolRoutes.js ---
// API: TRẠM ĐIỀU PHỐI NĂNG LƯỢNG AI (Tạo nhiệm vụ tùy chỉnh)
router.get('/microwins/daily', auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        const context = user.userContext || "Một người dùng đang cần chút động lực để bước tiếp.";
        
        // Lấy giờ Việt Nam để AI giao việc cho chuẩn
        const vnHour = new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh", hour: 'numeric', hour12: false });
        let timeContext = "Ban ngày";
        if (vnHour >= 18 || vnHour < 5) timeContext = "Buổi tối/Đêm khuya";

        const prompt = `Bạn là một hệ thống kỷ luật mềm mại. Dựa vào bối cảnh tâm lý sau: "${context}", và thời gian hiện tại là: ${timeContext}.
Hãy thiết kế đúng 4 "Hạt mầm sinh mệnh" (Nhiệm vụ siêu nhỏ) để người dùng thực hiện ngay lập tức.
Yêu cầu NGHIÊM NGẶT:
- Nhiệm vụ phải thực tế, vật lý (không phải suy nghĩ), làm được trong dưới 2 phút.
- Gắn liền với bối cảnh của họ (VD: Nếu họ áp lực học tập, xúi họ uống nước/nhìn xa; Nếu họ trầm cảm nằm bẹp, xúi họ ngồi dậy vươn vai).
- Trả về ĐÚNG chuẩn JSON (không kèm text) với cấu trúc sau:
{
  "tasks": [
    { "id": 1, "title": "Tên nhiệm vụ ngắn gọn", "desc": "Lý do khoa học/tâm lý (1 câu)", "points": 15 },
    ... 3 task nữa
  ]
}
Số điểm (points) dao động từ 10 đến 30.`;

        const completion = await groq.chat.completions.create({
            messages: [{ role: "system", content: prompt }],
            model: "moonshotai/kimi-k2-instruct-0905",
            temperature: 0.6,
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(completion.choices[0]?.message?.content);
        res.json(result.tasks);
    } catch (e) {
        console.error("Lỗi tạo Task AI:", e);
        // Fallback khẩn cấp nếu AI lỗi
        res.json([
            { id: 1, title: 'Uống một cốc nước đầy', desc: 'Hydrat hóa não bộ giúp giảm sương mù tâm trí ngay lập tức.', points: 10 },
            { id: 2, title: 'Rời mắt khỏi màn hình 60s', desc: 'Nhìn ra xa 20 mét để nhãn cầu được nhả cơ gồng.', points: 15 },
            { id: 3, title: 'Rửa mặt bằng nước mát', desc: 'Kích hoạt dây thần kinh phế vị, reset nhịp tim.', points: 20 },
            { id: 4, title: 'Gấp chăn hoặc dọn mặt bàn', desc: 'Lấy lại cảm giác kiểm soát không gian xung quanh.', points: 20 }
        ]);
    }
});

module.exports = router;