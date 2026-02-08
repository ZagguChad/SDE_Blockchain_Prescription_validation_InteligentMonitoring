require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const prescriptionRoutes = require('./routes/prescriptions');
const analyticsRoutes = require('./routes/analytics');

// Mount Routes
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/patient', require('./routes/patient'));

const startExpiryJob = require('./cron/expiryJob');
const startBlockchainListener = require('./services/blockchainListener');

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log("✅ MongoDB Connected");
    startExpiryJob(); // Start the cron job
    startBlockchainListener(); // Start Event Listener
}).catch(err => console.log(err));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
