const express = require('express');
const router = express.Router();
const pendingSyncController = require('../controller/pending.sync.controller');

// Make sure the method name is exactly "syncPendingData"
router.post('/sync', pendingSyncController.syncPendingData); 

module.exports = router;