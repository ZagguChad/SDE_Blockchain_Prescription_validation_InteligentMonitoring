const express = require('express');
const router = express.Router();
const PrescriptionLog = require('../models/PrescriptionLog');

// GET /api/analytics/medicines
// Returns aggregated usage stats for medicines
router.get('/medicines', async (req, res) => {
    try {
        // Aggregation Pipeline
        const stats = await PrescriptionLog.aggregate([
            // 1. Unwind the medicines array (one doc per medicine)
            { $unwind: "$medicines" },

            // 2. Group by medicine name (case-insensitive if needed, but assuming standardized input)
            {
                $group: {
                    _id: "$medicines.name",
                    totalQuantity: { $sum: "$medicines.quantity" },
                    count: { $sum: 1 },
                    lastDispensed: { $max: "$issuedAt" },
                    // Collect recent dosages for analysis
                    dosages: { $addToSet: "$medicines.dosage" }
                }
            },

            // 3. Project for cleaner output
            {
                $project: {
                    name: "$_id",
                    totalQuantity: 1,
                    count: 1,
                    lastDispensed: 1,
                    dosages: 1,
                    _id: 0,
                    // Flag as "anomalous" if count > threshold (e.g., 5) - simple rule-based logic
                    // In a real app, this would use a more complex algorithm or time-window
                    isHighAlert: { $gt: ["$count", 5] }
                }
            },

            // 4. Sort by count descending (most popular first)
            { $sort: { count: -1 } }
        ]);

        res.json({ success: true, data: stats });
    } catch (error) {
        console.error("Analytics Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
