const express = require("express");
const middleware = require("../middleware/auth.middleware");
const {
    orderController,
    costController,
    updateStatusController,
    getJobFilesController,
    createManualJobController,
    dashboardSummaryController
} = require("../controller/orders.controller");

const router = express.Router();

// All order routes require authentication
router.get("/v1/get-order", middleware, orderController);
router.patch("/v1/cost-order", middleware, costController);
router.patch("/v1/update-status", middleware, updateStatusController);
router.get("/v1/files/:jobId", middleware, getJobFilesController);
router.post("/v1/create-manual-job", middleware, createManualJobController);
router.get("/v1/dashboard-summary", middleware, dashboardSummaryController);

module.exports = router;
