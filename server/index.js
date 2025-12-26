require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const prescriptionRoutes = require('./routes/prescriptions');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use('/api/prescriptions', prescriptionRoutes);

app.post('/api/parse-prescription', async (req, res) => {
    try {
        const { transcript } = req.body;
        if (!transcript) return res.status(400).json({ success: false, error: 'No transcript provided' });

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `
            You are a helpful medical assistant. Extract the following details from the doctor's spoken text:
            - patientName (String)
            - age (Number or String)
            - medicine (String, include dosage if present)
            - quantity (Number)
            - notes (String summary of instructions)

            Return ONLY a valid JSON object. Do not use Markdown code blocks. Keys: patientName, age, medicine, quantity, notes.
            If a value is not found, set it to null.
            
            Text: "${transcript}"
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();

        // Cleanup if model returns markdown
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();

        const data = JSON.parse(text);
        res.json({ success: true, data });

    } catch (error) {
        console.error('AI Parse Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/', (req, res) => {
    res.send('Blockchain Prescription API is running');
});

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/blockchain-prescription')
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.error('MongoDB Connection Error:', err));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
