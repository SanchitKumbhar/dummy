const {
    ordersService,
    costService,
    updateStatusService,
    getJobFilesService,
    createManualJobService,
    getDashboardSummaryService
} = require("../service/orders.service");

/**
 * GET /api/orders/v1/get-order
 * Returns all print jobs for the authenticated store
 */
const orderController = async (req, res) => {
    try {
        const store_id = req.storeId;
        const result = await ordersService(store_id);
        if (result.status === 200) {
            return res.status(200).json({ data: result.order });
        }
        return res.status(result.status || 500).json({ success: false, message: "Failed to fetch orders" });
    } catch (error) {
        console.error("orderController error:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

/**
 * PATCH /api/orders/v1/cost-order
 * Update cost of a print job
 */
const costController = async (req, res) => {
    try {
        const store_id = req.storeId;
        const { jobId, cost } = req.body;
        if (!jobId || cost === undefined) {
            return res.status(400).json({ success: false, message: "jobId and cost are required" });
        }
        // Pass storeId to enforce tenant ownership
        const result = await costService(jobId, parseFloat(cost), store_id);
        if (result.status === 200) {
            return res.status(200).json({ success: true, message: "Cost updated" });
        }
        if (result.status === 404) {
            return res.status(404).json({ success: false, message: result.message });
        }
        return res.status(result.status || 500).json({ success: false, message: "Update failed" });
    } catch (error) {
        console.error("costController error:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

/**
 * PATCH /api/orders/v1/update-status
 * Update status of a print job (pending, printing, paused, completed, cancelled)
 */
const updateStatusController = async (req, res) => {
    try {
        const store_id = req.storeId;
        const { jobId, status } = req.body;
        if (!jobId || !status) {
            return res.status(400).json({ success: false, message: "jobId and status are required" });
        }
        // Pass storeId to enforce tenant ownership
        const result = await updateStatusService(jobId, status, store_id);
        if (result.status === 200) {
            return res.status(200).json({ success: true, message: "Status updated" });
        }
        if (result.status === 404) {
            return res.status(404).json({ success: false, message: result.message });
        }
        if (result.status === 400) {
            return res.status(400).json({ success: false, message: result.message });
        }
        return res.status(500).json({ success: false, message: "Update failed" });
    } catch (error) {
        console.error("updateStatusController error:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

/**
 * GET /api/orders/v1/files/:jobId
 * Get all files associated with a print job
 */
const getJobFilesController = async (req, res) => {
    try {
        const store_id = req.storeId;
        const { jobId } = req.params;
        if (!jobId) {
            return res.status(400).json({ success: false, message: "jobId is required" });
        }
        // Pass storeId to enforce tenant ownership
        const result = await getJobFilesService(jobId, store_id);
        return res.status(200).json({ files: result.files });
    } catch (error) {
        console.error("getJobFilesController error:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

/**
 * POST /api/orders/v1/create-manual-job
 * Create a manual print job from the desktop app
 */
const createManualJobController = async (req, res) => {
    try {
        const store_id = req.storeId;
        const { customer_name, sender_phone, pages, source, notes } = req.body;

        if (!pages || parseInt(pages) < 1) {
            return res.status(400).json({ success: false, message: "pages must be >= 1" });
        }

        const result = await createManualJobService(store_id, {
            customer_name,
            sender_phone,
            pages,
            source: source || "manual",
            notes
        });

        if (result.status === 201) {
            // Broadcast to socket room for real-time sync
            const io = req.app.get("io");
            if (io) {
                io.to(`store-${store_id}`).emit("new-job", result.job);
            }
            return res.status(201).json({ success: true, job: result.job });
        }
        return res.status(500).json({ success: false, message: "Failed to create job" });
    } catch (error) {
        console.error("createManualJobController error:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

/**
 * GET /api/orders/v1/dashboard-summary
 * Dashboard aggregation data for authenticated store
 */
const dashboardSummaryController = async (req, res) => {
    try {
        const store_id = req.storeId;
        const result = await getDashboardSummaryService(store_id);
        return res.status(200).json({ success: true, data: result.summary });
    } catch (error) {
        console.error("dashboardSummaryController error:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

module.exports = {
    orderController,
    costController,
    updateStatusController,
    getJobFilesController,
    createManualJobController,
    dashboardSummaryController
};
