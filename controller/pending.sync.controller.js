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
        const storeId = req.user.storeId || req.user.id || req.body.storeId;
        const { clientMutations = [], lastSyncTimestamp } = req.body;

        const resolvedMutations = [];

        // 1. Process client mutations (actions taken while offline)
        for (const mutation of clientMutations) {
            const { type, jobId, payload, mutationId } = mutation;
            try {
                if (type === "UPDATE_STATUS") {
                    await Order.update(
                        { status: payload.status },
                        { where: { job_id: jobId, store_id: storeId } }
                    );
                    resolvedMutations.push({ mutationId, status: "applied" });
                } else if (type === "UPDATE_COST") {
                    await Order.update(
                        { cost_of_job: payload.cost },
                        { where: { job_id: jobId, store_id: storeId } }
                    );
                    resolvedMutations.push({ mutationId, status: "applied" });
                } else if (type === "UPDATE_PAYMENT") {
                    await Order.update(
                        { payment_status: payload.paymentStatus },
                        { where: { job_id: jobId, store_id: storeId } }
                    );
                    resolvedMutations.push({ mutationId, status: "applied" });
                }
            } catch (mutErr) {
                console.error(`Failed to apply client mutation ${mutationId}:`, mutErr.message);
                resolvedMutations.push({ mutationId, status: "failed", error: mutErr.message });
            }
        }

        // 2. Fetch all fresh or updated jobs for this store
        let queryCondition = { store_id: storeId };
        if (lastSyncTimestamp) {
            // Include records created/updated after the last client sync
            queryCondition.updated_at = {
                [require("sequelize").Op.gte]: new Date(lastSyncTimestamp)
            };
        }

        const orders = await Order.findAll({
            where: { store_id: storeId },
            include: [{ model: OrderFile, as: "files" }],
            order: [["created_at", "DESC"]],
            limit: 100
        });

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