const Groq = require('groq-sdk');
// Lấy key từ file .env (ở file server.js đã cấu hình dotenv rồi)
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
module.exports = groq;