// controller/email.webhook.controller.js
const Store = require("../model/store.model");
const { processIncomingEmail } = require("../service/email.processor.service.js");

// Helper to extract clean email (handles cases like "Store <test@domain.com>")
const extractCleanEmail = (rawTo) => {
    if (!rawTo) return "";
    const match = rawTo.match(/<([^>]+)>/) || rawTo.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    return match ? match[1].toLowerCase().trim() : rawTo.toLowerCase().trim();
};

const findStoreByEmail = async (recipientEmail) => {
    try {
        const cleanEmail = extractCleanEmail(recipientEmail);
        console.log(`[Email Debug] Searching MongoDB for store with email: "${cleanEmail}"`);
        
        // Lookup store in MongoDB case-insensitively
        const store = await Store.findOne({ 
            email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') } 
        }).lean();

        if (store) {
            console.log(`[Email Debug] Store found in MongoDB. ID: ${store._id}`);
            return store._id.toString();
        }
        return null;
    } catch (err) {
        console.error("[Email Debug] Store lookup error:", err.message);
        return null;
    }
};

const receiveCloudflareWebhook = async (req, res) => {
    try {
        const io = req.app.get("io");
        const expectedSecret = process.env.EMAIL_WEBHOOK_SECRET;

        // 1. Verify secret
        if (expectedSecret && req.headers['x-webhook-secret'] !== expectedSecret) {
            console.warn("[Email Debug] Unauthorized request: secret mismatch");
            return res.status(403).json({ error: "Unauthorized request" });
        }

        const recipientEmail = req.body.to;
        if (!recipientEmail) {
            console.warn("[Email Debug] Missing recipient email in request body");
            return res.status(400).json({ error: "Missing recipient email" });
        }

        console.log(`[Email Debug] Inbound webhook received for: ${recipientEmail}`);

        // 2. Identify target store in MongoDB
        const storeId = await findStoreByEmail(recipientEmail);
        if (!storeId) {
            console.warn(`[Email Debug] Email dropped: Unknown store address "${recipientEmail}". Check Store collection in MongoDB.`);
            return res.status(200).json({ success: false, message: "Store not found" });
        }

        // 3. Format data
        const emailData = {
            from: req.body.from,
            subject: req.body.subject,
            text: req.body.text
        };

        // 4. Attachments from Multer
        const attachments = req.files || [];
        console.log(`[Email Debug] Processing ${attachments.length} attachment(s) for store ID: ${storeId}`);

        // 5. Process email & emit to room
        await processIncomingEmail(emailData, attachments, io, String(storeId));

        console.log(`[Email Debug] Email processed and emitted to room: store-${storeId}`);
        return res.status(200).json({ success: true, message: "Cloudflare Webhook Processed." });
    } catch (error) {
        console.error("[Email Debug] receiveCloudflareWebhook error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};

module.exports = {
    receiveCloudflareWebhook
};