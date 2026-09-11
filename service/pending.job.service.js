const Job = require('../model/job.model');
const mongoose = require('mongoose');

// FIX: was db.run() (no rows), wrong columns, broken promise, bad SQL quote on 'pending'
async function pendingJobsSyncService(storeId) {
    const filters = mongoose.isValidObjectId(storeId)
        ? [{ storeId: new mongoose.Types.ObjectId(storeId) }, { storeId: String(storeId) }]
        : [{ legacyStoreId: Number(storeId) }];
    return Job.find({ $or: filters, status: 'pending' }).sort({ createdAt: -1 }).lean();
}

module.exports = pendingJobsSyncService;
