/**
 * Pending Sync Controller
 * Handles synchronization between offline desktop clients and the backend.
 */

const { Order, OrderFile } = require("../model/order.model");
const Store = require("../model/store.model");
const Job = require("../model/job.model");
const { getIO } = require("../service/socket.service");

exports.syncPendingData = async (req, res) => {
    try {
        const storeId = req.storeId || req.body.storeId;
        const { clientMutations = [], lastSyncTimestamp } = req.body;

        const resolvedMutations = [];

        // 1. Process client mutations (actions taken while offline)
        for (const mutation of clientMutations) {
            const { type, jobId, payload, mutationId } = mutation;
            try {
                if (type === "UPDATE_STATUS") {
                    await Job.updateOne({ jobId }, { $set: { status: payload.status } });
                    resolvedMutations.push({ mutationId, status: "applied" });
                } else if (type === "UPDATE_COST") {
                    await Job.updateOne({ jobId }, { $set: { costOfJob: payload.cost } });
                    resolvedMutations.push({ mutationId, status: "applied" });
                } else if (type === "UPDATE_PAYMENT") {
                    await Job.updateOne({ jobId }, { $set: { paymentStatus: payload.paymentStatus } });
                    resolvedMutations.push({ mutationId, status: "applied" });
                }
            } catch (mutErr) {
                console.error(`Failed to apply client mutation ${mutationId}:`, mutErr.message);
                resolvedMutations.push({ mutationId, status: "failed", error: mutErr.message });
            }
        }

        // 2. Fetch all fresh or updated jobs for this store
        const storeIdNum = Number(storeId);
        let queryCondition = { 
            $or: [
                { storeId: String(storeId) },
                { storeId: storeId }
            ]
        };
        
        if (!isNaN(storeIdNum)) {
            queryCondition.$or.push({ legacyStoreId: storeIdNum });
        }

        if (lastSyncTimestamp) {
            // Include records created/updated after the last client sync
            queryCondition.updatedAt = { $gte: new Date(lastSyncTimestamp) };
        }

        const orders = await Job.find(queryCondition)
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();

        return res.status(200).json({
            success: true,
            serverTimestamp: new Date().toISOString(),
            resolvedMutations,
            jobs: orders
        });
    } catch (err) {
        console.error("Pending sync error:", err);
        return res.status(500).json({
            success: false,
            message: "Synchronization error",
            error: err.message
        });
    }
};