const express = require('express');
const router = express.Router();
const pendingSyncController = require('../controller/pending.sync.controller');

const authMiddleware = require('../middleware/auth.middleware');

// Make sure the method name is exactly "syncPendingData"
router.post('/sync', authMiddleware, pendingSyncController.syncPendingData); 

module.exports = router;