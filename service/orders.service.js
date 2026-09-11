const Job = require('../model/job.model');
const mongoose = require('mongoose');

function tenantFilter(storeId) {
    const filters = [];
    if (mongoose.isValidObjectId(storeId)) filters.push({ storeId: new mongoose.Types.ObjectId(storeId) }, { storeId: String(storeId) });
    const legacyStoreId = Number(storeId);
    if (Number.isSafeInteger(legacyStoreId)) filters.push({ legacyStoreId });
    return filters.length === 1 ? filters[0] : { $or: filters.length ? filters : [{ storeId: String(storeId) }] };
}

async function ordersService(storeId) {
    const jobs = await Job.find(tenantFilter(storeId))
        .sort({ createdAt: -1 })
        .lean();
    return { status: 200, order: jobs };
}

async function costService(jobId, cost, storeId) {
    const result = await Job.updateOne({ jobId, ...tenantFilter(storeId) }, { $set: { costOfJob: cost } });
    return result.matchedCount ? { status: 200 } : { status: 404, message: 'Job not found or access denied' };
}

async function updateStatusService(jobId, status, storeId) {
    const validStatuses = ['pending', 'printing', 'paused', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) return { status: 400, message: 'Invalid status value' };
    const result = await Job.updateOne({ jobId, ...tenantFilter(storeId) }, { $set: { status } });
    return result.matchedCount ? { status: 200 } : { status: 404, message: 'Job not found or access denied' };
}

async function getJobFilesService(jobId, storeId) {
    const job = await Job.findOne({ jobId, ...tenantFilter(storeId) }, { files: 1 }).lean();
    return { status: 200, files: job?.files || [] };
}

async function createManualJobService(storeId, jobData) {
    const jobId = `MAN-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const job = await Job.create({
        jobId,
        storeId: Number.isNaN(Number(storeId)) ? storeId : Number(storeId),
        legacyStoreId: Number(storeId),
        customerName: jobData.customer_name || 'Walk-in Customer',
        senderPhone: jobData.sender_phone || 'manual',
        source: jobData.source || 'manual',
        totalPages: parseInt(jobData.pages, 10) || 1,
        status: 'pending',
        costOfJob: 0,
        notes: jobData.notes,
        files: []
    });
    return { status: 201, job: job.toObject() };
}

async function getDashboardSummaryService(storeId) {
    const filter = tenantFilter(storeId);
    const [counts, incomingJobs, recentActivity] = await Promise.all([
        Job.aggregate([{ $match: filter }, { $group: {
            _id: null,
            total: { $sum: 1 },
            pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
            printing: { $sum: { $cond: [{ $eq: ['$status', 'printing'] }, 1, 0] } },
            completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
            revenue: { $sum: '$costOfJob' }
        } }]),
        Job.find(filter).sort({ createdAt: -1 }).limit(5).lean(),
        Job.find(filter).sort({ updatedAt: -1 }).limit(8).lean()
    ]);
    const count = counts[0] || {};
    const total = Number(count.total || 0);
    const pending = Number(count.pending || 0);
    return {
        status: 200,
        summary: {
            total, pending, printing: Number(count.printing || 0), completed: Number(count.completed || 0),
            revenue: Number(count.revenue || 0), queueLoad: total ? Math.min(100, Math.round((pending / total) * 100)) : 0,
            incomingJobs, recentActivity
        }
    };
}

module.exports = { ordersService, costService, updateStatusService, getJobFilesService, createManualJobService, getDashboardSummaryService };
