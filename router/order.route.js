const express = require('express');
const router = express.Router();
const ordersController = require('../controller/orders.controller');

const authMiddleware = require('../middleware/auth.middleware');

// GET routes
router.get('/get-order', authMiddleware, ordersController.orderController);
router.get('/files/:jobId', authMiddleware, ordersController.getJobFilesController);
router.get('/dashboard-summary', authMiddleware, ordersController.dashboardSummaryController);

// POST / PATCH routes
router.post('/create-manual-job', authMiddleware, ordersController.createManualJobController);
router.patch('/cost-order', authMiddleware, ordersController.costController);
router.patch('/update-status', authMiddleware, ordersController.updateStatusController);

module.exports = router;