const pendingJobsSyncService = require("../service/pending.job.service");

const pendingJobsSync = async (req, res) => {
    try {
        // FIX: was const { storeId } = req.storeId — storeId is a scalar, not object
        const storeId = req.storeId;
        const jobs = await pendingJobsSyncService(storeId);
        return res.status(200).json({ jobs });
    } catch (error) {
        console.error("pendingJobsSync error:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

module.exports = pendingJobsSync;
