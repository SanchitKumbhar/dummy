const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/auth.middleware");
const { syncPendingData } = require("../controller/pending.sync.controller");
const orderController = require("../controller/orders.controller");

// Add sync endpoint
router.post("/sync", authMiddleware, syncPendingData);

router.get("/get-order", authMiddleware, orderController.getOrder);
router.get("/dashboard-summary", authMiddleware, orderController.getDashboardSummary);
router.patch("/update-status", authMiddleware, orderController.updateStatus);
router.patch("/cost-order", authMiddleware, orderController.costOrder);

module.exports = router;