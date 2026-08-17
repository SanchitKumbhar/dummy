// const express = require("express");
// const router = express.Router();

// // Matches the pattern used by user.auth.js — adjust the path/name here if your
// // auth middleware file exports something other than a plain function.
// const requireAuth = require("../middleware/auth.middleware");

// // Same db module index.js uses (config/sqlite.config).
// const db = require("../config/sqlite.config");

// const FB_APP_ID = process.env.FB_APP_ID;
// const FB_APP_SECRET = process.env.FB_APP_SECRET; // never sent to frontend
// const GRAPH_VERSION = "v21.0";
// const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

// // ─────────────────────────────────────────────
// // Small promisified helpers around the sqlite3-style
// // callback API (db.get(sql, params, cb) / db.run(sql, params, cb)).
// // If config/sqlite.config already returns a promise-based client,
// // these still work as long as db.get/db.run accept (sql, params, callback).
// // ─────────────────────────────────────────────
// function dbGet(sql, params = []) {
//     return new Promise((resolve, reject) => {
//         db.get(sql, params, (err, row) => {
//             if (err) return reject(err);
//             resolve(row);
//         });
//     });
// }

// function dbRun(sql, params = []) {
//     return new Promise((resolve, reject) => {
//         db.run(sql, params, function (err) {
//             if (err) return reject(err);
//             resolve(this); // gives access to this.lastID / this.changes if needed
//         });
//     });
// }

// // NOTE: mounted at app.use("/api/whatsapp", ...) in index.js, so this path
// // must be RELATIVE (matches the pattern in store.route.js / user.auth.js).
// // Final route: POST /api/whatsapp/v1/connect
// router.post("/v1/connect", requireAuth, async (req, res) => {
//     const { code, wabaId, phoneNumberId, businessId } = req.body;
//     const storeId = req.storeId; // from your auth middleware/JWT

//     if (!code || !wabaId || !phoneNumberId) {
//         return res.status(400).json({ message: "code, wabaId, and phoneNumberId are required." });
//     }

//     try {
//         // 1. Exchange code for access token
//         const tokenRes = await fetch(
//             `${GRAPH}/oauth/access_token?client_id=${FB_APP_ID}&client_secret=${FB_APP_SECRET}&code=${code}`
//         );
//         const tokenData = await tokenRes.json();
//         if (!tokenRes.ok || !tokenData.access_token) {
//             throw new Error(tokenData.error?.message || "Token exchange failed.");
//         }
//         const accessToken = tokenData.access_token;

//         // 2. Fetch WABA + phone number info in parallel
//         const [wabaRes, phoneRes] = await Promise.all([
//             fetch(`${GRAPH}/${wabaId}?fields=id,name,account_review_status&access_token=${accessToken}`),
//             fetch(`${GRAPH}/${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating&access_token=${accessToken}`)
//         ]);
//         const wabaData = await wabaRes.json();
//         const phoneData = await phoneRes.json();

//         // 3. Check this phone number isn't already linked to a DIFFERENT store
//         const existing = await dbGet(
//             `SELECT store_id FROM stores WHERE whatsapp_phone_number_id = ? AND store_id != ?`,
//             [phoneNumberId, storeId]
//         );
//         if (existing) {
//             return res.status(409).json({ message: "This WhatsApp number is already connected to another store." });
//         }

//         // 4. Subscribe app to this WABA's webhooks (required for incoming messages)
//         await fetch(`${GRAPH}/${wabaId}/subscribed_apps?access_token=${accessToken}`, { method: "POST" });

//         // 5. Persist against the store, matching your actual column names
//         await dbRun(
//             `UPDATE stores SET
//                 whatsapp_phone_number_id = ?,
//                 whatsapp_access_token = ?,
//                 whatsapp_waba_id = ?,
//                 whatsapp_business_id = ?,
//                 whatsapp_display_phone_number = ?,
//                 whatsapp_verified_name = ?,
//                 whatsapp_connected_at = CURRENT_TIMESTAMP
//              WHERE store_id = ?`,
//             [
//                 phoneNumberId,
//                 accessToken,
//                 wabaId,
//                 businessId || null,
//                 phoneData.display_phone_number || null,
//                 phoneData.verified_name || null,
//                 storeId
//             ]
//         );

//         // 6. Respond to frontend (never include accessToken here)
//         return res.json({
//             success: true,
//             data: {
//                 wabaId,
//                 phoneNumberId,
//                 businessId: businessId || null,
//                 businessName: phoneData.verified_name || null,
//                 displayPhoneNumber: phoneData.display_phone_number || null,
//                 qualityRating: phoneData.quality_rating || null,
//                 accountReviewStatus: wabaData.account_review_status || null
//             }
//         });
//     } catch (err) {
//         console.error("WhatsApp connect failed:", err);
//         return res.status(500).json({ message: err.message || "Failed to connect WhatsApp Business." });
//     }
// });

// module.exports = router;



const express = require("express");
const router = express.Router();

// Matches the pattern used by user.auth.js — adjust the path/name here if your
// auth middleware file exports something other than a plain function.
const requireAuth = require("../middleware/auth.middleware");

// Same db module index.js uses (config/sqlite.config).
const db = require("../config/sqlite.config");

const FB_APP_ID = process.env.FB_APP_ID;
const FB_APP_SECRET = process.env.FB_APP_SECRET; // never sent to frontend
const GRAPH_VERSION = "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

// ─────────────────────────────────────────────
// Small promisified helpers around the sqlite3-style
// callback API (db.get(sql, params, cb) / db.run(sql, params, cb)).
// ─────────────────────────────────────────────
function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) return reject(err);
            resolve(this);
        });
    });
}

// Final route: POST /api/whatsapp/v1/connect
router.post("/v1/connect", requireAuth, async (req, res) => {
    const { code, wabaId, phoneNumberId, businessId } = req.body;
    const storeId = req.storeId; // from auth middleware

    if (!code || !wabaId || !phoneNumberId) {
        return res.status(400).json({ message: "code, wabaId, and phoneNumberId are required." });
    }

    try {
        // 1. Exchange code for short-lived access token
        const tokenRes = await fetch(
            `${GRAPH}/oauth/access_token?client_id=${FB_APP_ID}&client_secret=${FB_APP_SECRET}&code=${code}`
        );
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.access_token) {
            throw new Error(tokenData.error?.message || "Initial token exchange failed.");
        }
        const shortLivedToken = tokenData.access_token;

        // 2. Exchange short-lived token for long-lived (~60 days) access token
        const longLivedRes = await fetch(
            `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${FB_APP_ID}&client_secret=${FB_APP_SECRET}&fb_exchange_token=${shortLivedToken}`
        );
        const longLivedData = await longLivedRes.json();
        if (!longLivedRes.ok || !longLivedData.access_token) {
            throw new Error(longLivedData.error?.message || "Long-lived token exchange failed.");
        }
        const accessToken = longLivedData.access_token;

        // 3. Fetch WABA (with owner_business fallback) + phone number info in parallel
        const [wabaRes, phoneRes] = await Promise.all([
            fetch(`${GRAPH}/${wabaId}?fields=id,name,account_review_status,owner_business&access_token=${accessToken}`),
            fetch(`${GRAPH}/${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating&access_token=${accessToken}`)
        ]);
        const wabaData = await wabaRes.json();
        const phoneData = await phoneRes.json();

        const resolvedBusinessId = businessId || wabaData.owner_business?.id || null;

        // 4. Check this phone number isn't already linked to a DIFFERENT store
        const existing = await dbGet(
            `SELECT store_id FROM stores WHERE whatsapp_phone_number_id = ? AND store_id != ?`,
            [phoneNumberId, storeId]
        );
        if (existing) {
            return res.status(409).json({ message: "This WhatsApp number is already connected to another store." });
        }

        // 5. Subscribe app to this WABA's webhooks (required for incoming messages)
        await fetch(`${GRAPH}/${wabaId}/subscribed_apps?access_token=${accessToken}`, { method: "POST" });

        // 6. Persist against the store using the long-lived token
        await dbRun(
            `UPDATE stores SET
                whatsapp_phone_number_id = ?,
                whatsapp_access_token = ?,
                whatsapp_waba_id = ?,
                whatsapp_business_id = ?,
                whatsapp_display_phone_number = ?,
                whatsapp_verified_name = ?,
                whatsapp_connected_at = CURRENT_TIMESTAMP
             WHERE store_id = ?`,
            [
                phoneNumberId,
                accessToken,
                wabaId,
                resolvedBusinessId,
                phoneData.display_phone_number || null,
                phoneData.verified_name || null,
                storeId
            ]
        );

        // 7. Respond to frontend
        return res.json({
            success: true,
            data: {
                wabaId,
                phoneNumberId,
                businessId: resolvedBusinessId,
                businessName: phoneData.verified_name || null,
                displayPhoneNumber: phoneData.display_phone_number || null,
                qualityRating: phoneData.quality_rating || null,
                accountReviewStatus: wabaData.account_review_status || null
            }
        });
    } catch (err) {
        console.error("WhatsApp connect failed:", err);
        return res.status(500).json({ message: err.message || "Failed to connect WhatsApp Business." });
    }
});

module.exports = router;