const { processIncomingMessage } = require("../service/print.webhook.service.js");
const { isArchiveAttachment, prepareIncomingFiles } = require("../service/archive.service.js");
const jobService = require("../service/jobs.service.js");
const Store = require('../model/store.model');
const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;

/**
 * GET /webhook
 * One-time handshake Meta performs when you click "Verify and Save"
 * in App Dashboard -> WhatsApp -> Configuration -> Webhook.
 */
const verifyWebhook = (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("Webhook verified successfully.");
        return res.status(200).send(challenge);
    }

    console.warn("Webhook verification failed. Token mismatch.");
    return res.sendStatus(403);
};

/**
 * Resolve which tenant/store a message belongs to, based on the
 * phone_number_id Meta sends in metadata. Each tenant's WABA phone
 * number gets its own phone_number_id after Embedded Signup, so this
 * is how a single shared webhook URL routes messages to the right store.
 *
 * ASSUMES a `stores` table with a `whatsapp_phone_number_id` column.
 * Adjust the table/column names to match your actual schema.
 */
const resolveStoreIdByPhoneNumberId = async (phoneNumberId) => {
    const store = await Store.findOne({ 'whatsapp.phoneNumberId': phoneNumberId }).select('_id').lean();
    return store?._id?.toString() || null;
};

/**
 * Normalizes a single Meta webhook message (+ its metadata/contacts)
 * into the flat, Twilio-shaped payload your worker/batching logic
 * already expects. This keeps downstream code (batching, DB writes,
 * socket emit) unchanged.
 */
const normalizeMetaMessage = (message, metadata, contacts) => {
    const contact = contacts?.[0];

    const normalized = {
        MessageSid: message.id,
        From: message.from,
        ProfileName: contact?.profile?.name || "",
        PhoneNumberId: metadata?.phone_number_id,
        DisplayPhoneNumber: metadata?.display_phone_number,
        NumMedia: "0",
        Body: "",
        MessageType: message.type
    };

    const mediaTypes = ["image", "document", "video", "audio", "sticker"];

    if (mediaTypes.includes(message.type)) {
        const mediaObj = message[message.type];
        normalized.NumMedia = "1";
        normalized.MediaContentType0 = mediaObj.mime_type || "";
        normalized.MediaId0 = mediaObj.id; // Meta gives an ID, not a URL — resolved later in the worker
        normalized.MediaFilename0 = mediaObj.filename || `${message.type}_${message.id}`;
        normalized.Body = mediaObj.caption || "";
    } else if (message.type === "text") {
        normalized.Body = message.text?.body || "";
    }

    return normalized;
};

/**
 * Webhook receiver — fast hand-off to BullMQ queue.
 * Detects archive attachments and routes them to the archive queue if available.
 */
const receiveWebhook = async (req, res) => {
    try {
        const body = req.body;

        // Always ack fast — Meta retries aggressively on non-200 responses.
        if (body.object !== "whatsapp_business_account") {
            return res.sendStatus(200);
        }

        const entry = body.entry?.[0];
        const change = entry?.changes?.[0];
        const value = change?.value;

        // Status callbacks (sent/delivered/read) arrive on the same field
        // but under value.statuses instead of value.messages — not a new
        // incoming message, so just ack and skip.
        if (!value?.messages || value.messages.length === 0) {
            return res.sendStatus(200);
        }

        const io = req.app.get("io");
        const messageQueue = req.app.get("messageQueue");
        const archiveQueue = req.app.get("archiveQueue");

        // Meta can batch multiple messages in one webhook call — process each.
        for (const message of value.messages) {
            const payload = normalizeMetaMessage(message, value.metadata, value.contacts);
            const jobId = payload.MessageSid;

            let storeId = req.storeId;
            if (!storeId) {
                storeId = await resolveStoreIdByPhoneNumberId(payload.PhoneNumberId);
            }
            if (!storeId) {
                console.warn(`No store mapped for phone_number_id ${payload.PhoneNumberId}. Defaulting to 6.`);
                storeId = 6;
            }

            const numMedia = Number(payload.NumMedia || 0);
            const hasArchive = numMedia > 0 && isArchiveAttachment(
                payload.MediaContentType0 || "",
                payload.MediaFilename0 || ""
            );

            if (hasArchive) {
                if (archiveQueue) {
                    await archiveQueue.add("unzip-archive", { payload, storeId }, { jobId });
                    continue;
                }
                const preparedFiles = await prepareIncomingFiles(payload);
                await processIncomingMessage(payload, io, storeId, preparedFiles);
                continue;
            }

            if (!messageQueue) {
                console.warn("Webhook received but BullMQ unavailable.");
                await processIncomingMessage(payload, io, storeId);
                continue;
            }

            await messageQueue.add("process-message", { payload, storeId }, { jobId });
        }

        return res.status(200).json({ success: true, message: "Webhook accepted and queued." });
    } catch (error) {
        console.error("receiveWebhook error:", error);
        // Still return 200 where possible so Meta doesn't retry-storm you —
        // log server-side and investigate instead of surfacing a 500 to Meta.
        return res.sendStatus(200);
    }
};

/**
 * POST /send
 * Sends a WhatsApp message from the authenticated store's connected number.
 * Body: { to: "918010235068", message: "Your print job is ready" }
 *
 * Note: outside the 24-hour customer service window, only approved message
 * templates can be sent — free-form text like this will fail with an error
 * from Meta if the customer hasn't messaged you recently.
 */
// const sendWhatsappMessageController = async (req, res) => {
//     try {
//         const storeId = req.storeId;
//         const { to, message } = req.body;

//         if (!storeId) {
//             return res.status(401).json({ success: false, message: "Unauthorized: missing store context" });
//         }
//         if (!to || !message) {
//             return res.status(400).json({ success: false, message: "Both 'to' and 'message' are required" });
//         }

//         const data = await sendWhatsappMessage(storeId, to, message);
//         return res.status(200).json({ success: true, data });
//     } catch (error) {
//         console.error("sendWhatsappMessageController error:", error.response?.data || error.message);
//         return res.status(500).json({
//             success: false,
//             message: "Failed to send WhatsApp message",
//             details: error.response?.data?.error?.message || error.message
//         });
//     }
// };

/**
 * Get print jobs for authenticated store.
 */
const printJobsController = async (req, res) => {
    try {
        const store_id = req.storeId;
        const result = await jobService(store_id);
        return res.status(200).json({ data: result.jobs });
    } catch (error) {
        console.error("printJobsController error:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

module.exports = {
    verifyWebhook,
    receiveWebhook,
    // sendWhatsappMessageController,
    printJobsController
};