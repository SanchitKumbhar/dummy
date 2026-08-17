const axios = require("axios");
const db = require("../config/sqlite.config");
const { getTokenForStore } = require("./archive.service.js");

const GRAPH_API_VERSION = process.env.WHATSAPP_API_VERSION || "v21.0";

const getPhoneNumberIdForStore = (storeId) => {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT whatsapp_phone_number_id FROM stores WHERE store_id = ?`,
            [storeId],
            (err, row) => {
                if (err) return reject(err);
                resolve(row ? row.whatsapp_phone_number_id : null);
            }
        );
    });
};

/**
 * Core send function — usable from an Express route, a worker, or any
 * internal "job completed" trigger. Not tied to req/res.
 *
 * Note: free-form text only works within the 24-hour customer service
 * window (i.e. the customer messaged you recently, like sending you the
 * print file). A "thank you, job done" reply almost always falls inside
 * that window since it's a direct reply to their own message, so this
 * should work reliably for that use case.
 */
async function sendWhatsappMessage(storeId, to, message) {
    const [token, phoneNumberId] = await Promise.all([
        getTokenForStore(storeId),
        getPhoneNumberIdForStore(storeId)
    ]);

    if (!token) {
        throw new Error(`No WhatsApp access token configured for store ${storeId}`);
    }
    if (!phoneNumberId) {
        throw new Error(`Store ${storeId} has not connected a WhatsApp number yet`);
    }

    const response = await axios.post(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
        {
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { body: message }
        },
        {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            }
        }
    );

    return response.data;
}

/**
 * Call this wherever a print job actually gets marked complete
 * (e.g. inside your "mark job as printed" route/service).
 */
async function sendPrintCompletionMessage(storeId, customerPhone, jobDetails = {}) {
    const { fileCount, totalPages } = jobDetails;

    const message = fileCount
        ? `✅ Your print job is done! ${fileCount} file(s), ${totalPages || "?"} page(s) printed. Thank you for using our service!`
        : `✅ Your print job is done! Thank you for using our service!`;

    try {
        const result = await sendWhatsappMessage(storeId, customerPhone, message);
        console.log(`Print completion message sent to ${customerPhone} for store ${storeId}`);
        return result;
    } catch (err) {
        console.error(`Failed to send print completion message to ${customerPhone}:`, err.response?.data || err.message);
        // Don't throw — a failed thank-you message shouldn't fail the whole
        // print-completion flow. Log and move on.
        return null;
    }
}

module.exports = {
    sendWhatsappMessage,
    sendPrintCompletionMessage,
    getPhoneNumberIdForStore
};