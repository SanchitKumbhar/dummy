const Job = require('../model/job.model');
const mongoose = require('mongoose');

// FIX: was db.run() which doesn't return rows — must use db.all() for SELECT
async function jobService(store_id) {
    const filters = mongoose.isValidObjectId(store_id)
        ? [{ storeId: new mongoose.Types.ObjectId(store_id) }, { storeId: String(store_id) }]
        : [{ legacyStoreId: Number(store_id) }];
    const jobs = await Job.find({ $or: filters }).sort({ createdAt: -1 }).lean();
    return { jobs };
}

module.exports = jobService;
