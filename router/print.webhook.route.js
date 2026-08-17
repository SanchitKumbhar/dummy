const express = require("express");
const { receiveWebhook, verifyWebhook, printJobsController } = require("../controller/print.webhook.controller");
const middleware = require("../middleware/auth.middleware");

const router = express.Router();

// router.post("/v1/send/whatsapp-message", middleware, sendWhatsappMessage);
router.get("/v1/webhook/whatsapp-integration", verifyWebhook);
router.post("/v1/webhook/whatsapp-integration", receiveWebhook);
router.get("/v1/printjobs/:store_id", middleware, printJobsController);

module.exports = router;