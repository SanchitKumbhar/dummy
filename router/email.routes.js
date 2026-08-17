const express = require("express");
const multer = require("multer");
const path = require("path");
const { receiveCloudflareWebhook } = require("../controller/email.webhook.controller.js");
const { UPLOADS_DIR } = require("../service/archive.service.js");

const router = express.Router();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const safeBase = (file.originalname || "attachment").replace(/[^a-zA-Z0-9.-]/g, "_");
        const uniqueName = `email_${Date.now()}_${Math.random().toString(36).substring(2, 8)}_${safeBase}`;
        cb(null, uniqueName);
    }
});

const upload = multer({ storage: storage });

router.post(
    "/inbound-parse",
    upload.any(),
    receiveCloudflareWebhook
);

module.exports = router;