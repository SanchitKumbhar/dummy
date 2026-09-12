const express = require('express');
const router = express.Router();
const ordersController = require('../controller/orders.controller');

// GET routes
router.get('/get-order', ordersController.orderController);
router.get('/files/:jobId', ordersController.getJobFilesController);
router.get('/dashboard-summary', ordersController.dashboardSummaryController);

// POST / PATCH routes
router.post('/create-manual-job', ordersController.createManualJobController);
router.patch('/cost-order', ordersController.costController);
router.patch('/update-status', ordersController.updateStatusController);

module.exports = router;