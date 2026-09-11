const Job = require('../model/job.model');
const mongoose = require('mongoose');

/**
 * GET /api/customers/v1/list
 * Returns all customers for the authenticated store.
 */
const customerController = async (req, res) => {
    try {
        const storeId = req.storeId;
        if (!storeId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const filters = mongoose.isValidObjectId(storeId)
            ? [{ storeId: new mongoose.Types.ObjectId(storeId) }, { storeId: String(storeId) }]
            : [{ legacyStoreId: Number(storeId) }];
        const customers = await Job.aggregate([
            { $match: { $or: filters } },
            { $group: { _id: '$senderPhone', phone_number: { $first: '$senderPhone' }, total_orders: { $sum: 1 }, total_spent: { $sum: '$costOfJob' }, last_order_at: { $max: '$createdAt' } } },
            { $sort: { total_orders: -1 } },
            { $project: { _id: 0, customer_id: '$_id', phone_number: 1, total_orders: 1, total_spent: 1, last_order_at: 1 } }
        ]);

        return res.status(200).json({ success: true, data: customers });
    } catch (error) {
        console.error("customerController error:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

module.exports = { customerController };