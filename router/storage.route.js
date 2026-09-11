const express = require('express');
const authMiddleware = require('../middleware/auth.middleware');
const { createUploadUrl } = require('../controller/storage.controller');

const router = express.Router();
router.post('/upload-url', authMiddleware, express.json(), createUploadUrl);

module.exports = router;