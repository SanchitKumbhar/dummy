// workers/job.worker.js

const { Worker } = require("bullmq");
const Redis = require("ioredis");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const db = require("../config/sqlite.config");
const {
    isUnsupportedMediaType,
    prepareIncomingFiles,
    getTokenForStore
} = require("../service/archive.service.js");
const { sendWhatsappMessage } = require("../service/whatsapp.service.js");

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
    console.error("REDIS_URL not set in .env. Worker cannot start.");
    process.exit(1);
}

const BATCH_WINDOW_MS = Number(process.env.WHATSAPP_BATCH_WINDOW_MS || 6000);

// -------------------- Redis Connections --------------------
const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null
});
const pubClient = new Redis(redisUrl);
const batchClient = new Redis(redisUrl);

connection.on("connect", () => {
    console.log("Redis connected for worker");
});

connection.on("error", (err) => {
    console.error("Worker Redis connection error:", err.message);
});

// -------------------- SQLite Helper --------------------
const runQuery = (query, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(query, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
};

// -------------------- Image Detection Helper --------------------
function isImage(file) {
    const rawName = String(file.fileName || file.file_name || file.originalName || file.localPath || "");
    const ext = path.extname(rawName).toLowerCase();
    const mime = (file.contentType || file.file_type || file.mimeType || "").toLowerCase();

    const imageExtensions = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".svg", ".heic"];
    
    return (
        imageExtensions.includes(ext) ||
        mime.startsWith("image/") ||
        rawName.startsWith("image_") ||
        rawName.includes("wamid.") ||
        ext === "" // WhatsApp images that arrive without an extension
    );
}

// -------------------- Worker --------------------
const worker = new Worker(
    "whatsapp-jobs",
    async (job) => {
        try {
            const data = job.data.payload || job.data;
            const storeId = job.data.storeId || 1;
            const preparedFiles = Array.isArray(job.data.preparedFiles) ? job.data.preparedFiles : null;

            console.log("JOB DATA RECEIVED:", data);

            const token = await getTokenForStore(storeId);
            if (!token) {
                console.error(
                    "No WhatsApp access token available for store " + storeId + ". " +
                    "Media downloads will fail with 401 Unauthorized."
                );
            }

            const senderPhone = (data.From || "UNKNOWN").replace("whatsapp:", "");
            const jobId = data.MessageSid;
            const messageType = data.MessageType || "";
            const bodyText = data.Body || "";
            const mediaCount = Number(data.NumMedia || 0);

            console.log(`Processing message: ${jobId} from ${senderPhone} for store-${storeId}`);

            // -------------------- Detect Unsupported Media --------------------
            let unsupportedFileName = null;
            if (mediaCount === 0 && messageType === "text" && bodyText) {
                const hasExtension = /\.\w{2,5}$/.test(bodyText.trim());
                if (hasExtension && isUnsupportedMediaType?.(bodyText.trim())) {
                    unsupportedFileName = bodyText.trim();
                    console.warn(
                        `⚠ Possible unsupported media reference: "${unsupportedFileName}" from ${senderPhone}.`
                    );
                }
            }

            // -------------------- Process Files --------------------
            let files = [];

            if (preparedFiles && preparedFiles.length > 0) {
                files = preparedFiles;
            } else if (mediaCount > 0) {
                files = await prepareIncomingFiles(data, token);
            }

            if (mediaCount > 0 && files.length === 0) {
                throw new Error(
                    `All media file(s) failed to download for message ${jobId}. ` +
                    `Check the WhatsApp access token and media ID validity.`
                );
            }

            // -------------------- Batch With Other Messages --------------------
            const batchKey = `printflow:batch:${storeId}:${senderPhone}`;
            const lockKey = `${batchKey}:owner`;

            const entry = JSON.stringify({ jobId, files, unsupportedFileName });

            await batchClient.rpush(batchKey, entry);
            await batchClient.pexpire(batchKey, BATCH_WINDOW_MS + 2000);

            const gotLock = await batchClient.set(lockKey, jobId, "PX", BATCH_WINDOW_MS, "NX");

            if (!gotLock) {
                console.log(`Message ${jobId} appended to existing batch for ${senderPhone}, owner handles finalize.`);
                return { jobId, batched: true };
            }

            await new Promise((resolve) => setTimeout(resolve, BATCH_WINDOW_MS));

            const rawEntries = await batchClient.lrange(batchKey, 0, -1);
            await batchClient.del(batchKey);
            await batchClient.del(lockKey);

            const allEntries = rawEntries.map((e) => JSON.parse(e));
            const rawFiles = allEntries.flatMap((e) => e.files);
            const memberJobIds = allEntries.map((e) => e.jobId);

            // -------------------------------------------------------------
            // File naming rule:
            //   - IMAGE files  -> renamed to file_1.<ext>, file_2.<ext>, ...
            //     (WhatsApp images often arrive with no meaningful original
            //     name, e.g. "wamid.xxxx", so we give them a clean sequence)
            //   - ALL OTHER files (pdf, doc, docx, xlsx, pptx, etc.)
            //     -> keep their actual original filename as sent, untouched
            // -------------------------------------------------------------
            let imageIndex = 0;
            const allFiles = rawFiles.map((file) => {
                const rawName =
                    file.fileName ||
                    file.file_name ||
                    file.originalName ||
                    file.original_name ||
                    (file.localPath ? path.basename(file.localPath) : "document.pdf");

                let resolvedName = rawName; // default: keep actual filename

                if (isImage(file)) {
                    imageIndex++;

                    // path.extname() blindly grabs everything after the LAST dot.
                    // WhatsApp media IDs like "wamid.HBgMOTE4MDEw...AA=" contain
                    // exactly one dot, so a naive extname() call turns the whole
                    // ID into a bogus "extension". Guard against that by only
                    // trusting extensions that actually look like real file
                    // extensions (short, alphanumeric).
                    let ext = path.extname(rawName).toLowerCase();
                    const looksLikeRealExtension = /^\.[a-z0-9]{2,5}$/.test(ext);
                    if (!looksLikeRealExtension) ext = "";

                    if (!ext) {
                        const mime = (file.contentType || file.file_type || file.mimeType || "").toLowerCase();
                        if (mime.includes("png")) ext = ".png";
                        else if (mime.includes("webp")) ext = ".webp";
                        else if (mime.includes("gif")) ext = ".gif";
                        else ext = ".jpg"; // sensible default for WhatsApp photos
                    }
                    resolvedName = `file_${imageIndex}${ext}`;
                }
                // non-image files fall through with resolvedName === rawName

                return {
                    ...file,
                    fileName: resolvedName,
                    file_name: resolvedName,
                    original_name: resolvedName,
                    originalName: resolvedName
                };
            });

            const unsupportedNames = allEntries
                .map((e) => e.unsupportedFileName)
                .filter(Boolean);

            const finalJobId = jobId;
            const totalPages = allFiles.reduce((sum, file) => sum + (file.pages || 0), 0);

            let jobStatus = "pending";
            let jobNotes = null;

            if (allFiles.length === 0 && unsupportedNames.length > 0) {
                jobStatus = "failed";
                jobNotes = `Unsupported file type(s): ${unsupportedNames.join(", ")}. ` +
                    `WhatsApp does not support ZIP/RAR/archive files. ` +
                    `Please send files as PDF, JPG, PNG, DOC, DOCX, PPTX, or XLSX.`;
            }

            console.log(
                `Finalizing batched job ${finalJobId} for ${senderPhone}: ` +
                `${allFiles.length} file(s) across ${memberJobIds.length} message(s) [${memberJobIds.join(", ")}]` +
                (unsupportedNames.length > 0 ? ` (unsupported: ${unsupportedNames.join(", ")})` : "")
            );

            // -------------------- DB Inserts --------------------
            await runQuery(
                `INSERT INTO print_jobs 
                (job_id, store_id, sender_phone, source, file_count, total_pages, status, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [finalJobId, storeId, senderPhone, "whatsapp", allFiles.length, totalPages, jobStatus, jobNotes]
            );

            for (const file of allFiles) {
                await runQuery(
                    `INSERT INTO print_job_files 
                    (job_id, file_name, file_path, file_type, pages)
                    VALUES (?, ?, ?, ?, ?)`,
                    [finalJobId, file.fileName, file.localPath || file.filePath || "", file.contentType || file.file_type || "application/octet-stream", file.pages || 1]
                );
            }

            console.log("Job and files successfully saved to SQLite database:", finalJobId);

            // -------------------- Broadcast Event --------------------
            const createdJob = {
                jobId: finalJobId,
                job_id: finalJobId,
                storeId: storeId,
                store_id: storeId,
                senderPhone: senderPhone,
                sender_phone: senderPhone,
                customer_name: data.ProfileName || `WhatsApp (${senderPhone.slice(-4)})`,
                source: "whatsapp",
                fileCount: allFiles.length,
                file_count: allFiles.length,
                totalPages: totalPages,
                total_pages: totalPages,
                files: allFiles.map((f) => ({
                    file_name: f.fileName,
                    fileName: f.fileName,
                    original_name: f.fileName,
                    originalName: f.fileName,
                    file_path: f.localPath || f.file_path || f.filePath || "",
                    filePath: f.localPath || f.file_path || f.filePath || "",
                    file_type: f.contentType || f.file_type || f.fileType || "application/octet-stream",
                    fileType: f.contentType || f.file_type || f.fileType || "application/octet-stream",
                    pages: f.pages || 1,
                    localPath: f.localPath || f.file_path || f.filePath || ""
                })),
                status: jobStatus,
                notes: jobNotes,
                cost_of_job: 0,
                createdAt: new Date().toISOString()
            };

            await pubClient.publish(
                "store-events",
                JSON.stringify({
                    storeId: storeId,
                    event: "new-job",
                    data: createdJob
                })
            );

            console.log(`Emitted real-time job payload to store channel store-${storeId}`);

            // -------------------- Notify Customer via WhatsApp --------------------
            try {
                const confirmationMessage = jobStatus === "failed"
                    ? `⚠️ ${jobNotes}`
                    : `✅ We've received your ${allFiles.length} file(s) (${totalPages} page(s)) and queued them for printing. We'll notify you once it's ready!`;

                await sendWhatsappMessage(storeId, senderPhone, confirmationMessage);

                console.log(`Confirmation WhatsApp message sent to ${senderPhone} for job ${finalJobId}`);
            } catch (notifyErr) {
                console.error(
                    `Failed to send confirmation WhatsApp message to ${senderPhone} for job ${finalJobId}:`,
                    notifyErr.response?.data || notifyErr.message
                );
            }

            return createdJob;

        } catch (err) {
            console.error("Worker lifecycle processing error:", err);
            throw err;
        }
    },
    { connection }
);

// -------------------- Events --------------------
worker.on("completed", (job) => {
    console.log("Job completed successfully:", job.id);
});

worker.on("failed", (job, err) => {
    console.error("Job failed:", job?.id, err.message);
});