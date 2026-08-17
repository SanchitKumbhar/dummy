const db = require("../config/sqlite.config");
const { processIncomingEmail } = require("../service/email.processor.service.js");

// Helper to extract clean email (handles cases like "Store <test@domain.com>")
const extractCleanEmail = (rawTo) => {
    if (!rawTo) return "";
    const match = rawTo.match(/<([^>]+)>/) || rawTo.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    return match ? match[1].toLowerCase().trim() : rawTo.toLowerCase().trim();
};

const findStoreByEmail = (recipientEmail) => {
    return new Promise((resolve, reject) => {
        const cleanEmail = extractCleanEmail(recipientEmail);

        // Case-insensitive SQL lookup
        db.get(`SELECT store_id FROM stores WHERE LOWER(email) = LOWER(?)`, [cleanEmail], (err, row) => {
            if (err) return reject(err);
            resolve(row ? row.store_id : null);
        });
    });
};

const receiveCloudflareWebhook = async (req, res) => {
    try {
        const io = req.app.get("io");

        // 1. Verify secret
        if (req.headers['x-webhook-secret'] !== 'my_super_secret_key_123') {
            return res.status(403).json({ error: "Unauthorized request" });
        }

        const recipientEmail = req.body.to;
        if (!recipientEmail) {
            return res.status(400).json({ error: "Missing recipient email" });
        }
        console.log(recipientEmail);
        // 2. Identify target store
        const storeId = await findStoreByEmail(recipientEmail);
        if (!storeId) {
            console.warn(`Email dropped: Unknown store address ${recipientEmail}`);
            return res.status(200).json({ success: false, message: "Store not found" });
        }
        console.log(storeId)

        // 3. Format data
        const emailData = {
            from: req.body.from,
            subject: req.body.subject,
            text: req.body.text
        };

        // 4. Attachments from Multer
        const attachments = req.files || [];

        // 5. Process email & emit via Socket.IO
        // Ensure storeId is passed as a string/number depending on how your frontend joined the room
        await processIncomingEmail(emailData, attachments, io, String(storeId));

        return res.status(200).json({ success: true, message: "Cloudflare Webhook Processed." });

    } catch (error) {
        console.error("receiveCloudflareWebhook error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};

module.exports = {
    receiveCloudflareWebhook
};