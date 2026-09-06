const path = require("path");
const db = require("../config/sqlite.config");
const { prepareIncomingFiles, isUnsupportedMediaType } = require("./archive.service.js");

/**
 * Promisified single-statement run helper (for job insert / transaction control).
 */
const runAsync = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) return reject(err);
            resolve(this);
        });
    });

/**
 * Bulk-insert file records using ONE prepared statement reused for every row,
 * instead of Promise.all-ing N independent db.run() calls (each of which
 * implicitly prepares + binds + finalizes its own statement).
 * Wrapped in db.serialize() so writes execute strictly in order on the
 * same connection, which also removes the need for Promise.all's
 * concurrency (SQLite is single-writer anyway, so "parallel" db.run calls
 * were being queued serially under the hood regardless).
 */
const insertFileRecords = (jobId, files) => {
    return new Promise((resolve, reject) => {
        if (files.length === 0) return resolve();

        db.serialize(() => {
            const stmt = db.prepare(
                `INSERT INTO print_job_files
                (job_id, file_name, file_path, file_type, pages)
                VALUES (?, ?, ?, ?, ?)`
            );

            let firstError = null;
            for (const file of files) {
                stmt.run(
                    jobId,
                    file.fileName || path.basename(file.localPath || ""),
                    file.localPath || file.file_path || "",
                    file.contentType || file.file_type || "application/octet-stream",
                    file.pages || 0,
                    (err) => {
                        if (err && !firstError) firstError = err;
                    }
                );
            }

            stmt.finalize((err) => {
                if (firstError) return reject(firstError);
                if (err) return reject(err);
                resolve();
            });
        });
    });
};

/**
 * Build the file shape the frontend expects. Pulled into a helper so the
 * dual camelCase/snake_case mapping is written once instead of inline
 * inside a .map() literal.
 */
const mapFileForResponse = (f) => {
    const fileName = f.fileName || f.file_name || path.basename(f.localPath || "document.pdf");
    const filePath = f.localPath || f.file_path || "";
    const fileType = f.contentType || f.file_type || "application/octet-stream";
    const pages = f.pages || 1;

    return {
        file_name: fileName,
        fileName,
        file_path: filePath,
        filePath,
        file_type: fileType,
        fileType,
        pages,
        localPath: filePath
    };
};

/**
 * Main message processor — standalone mode (no BullMQ).
 * Handles downloading media, archive extraction, and DB persistence.
 *
 * @param {Object} payload - Twilio webhook payload
 * @param {Object} io - Socket.IO server instance
 * @param {number} storeId - Store ID for tenant isolation
 * @param {Array|null} preparedFiles - Pre-extracted files (from archive worker)
 */
const processIncomingMessage = async (payload, io, storeId = 1, preparedFiles = null) => {
    try {
        const senderPhone = (payload.From || "UNKNOWN").replace("whatsapp:", "");
        const jobId = payload.MessageSid;
        const messageType = payload.MessageType || "";
        const bodyText = payload.Body || "";
        const mediaCount = Number(payload.NumMedia || 0);

        // Detect unsupported media (e.g. ZIP sent via WhatsApp)
        let unsupportedFileName = null;
        if (mediaCount === 0 && messageType === "document" && bodyText) {
            const trimmedBody = bodyText.trim();
            if (/\.\w{2,5}$/.test(trimmedBody) && isUnsupportedMediaType(trimmedBody)) {
                unsupportedFileName = trimmedBody;
                console.warn(
                    `⚠ Unsupported media: "${unsupportedFileName}" from ${senderPhone}. ` +
                    `WhatsApp/Twilio does not support this file type.`
                );
            }
        }

        // Process files.
        // NOTE: unsupportedFileName can only be set when mediaCount === 0,
        // so "mediaCount > 0 || !unsupportedFileName" was logically just
        // "!unsupportedFileName" — simplified below, no functional change,
        // just skips a redundant condition check on every message.
        let files;
        if (Array.isArray(preparedFiles) && preparedFiles.length > 0) {
            files = preparedFiles;
        } else if (!unsupportedFileName) {
            files = await prepareIncomingFiles(payload);
        } else {
            files = [];
        }

        // Determine status + running total in a single pass
        let jobStatus = "pending";
        let jobNotes = null;
        let totalPages = 0;
        for (const f of files) totalPages += (f.pages || 0);

        if (files.length === 0 && unsupportedFileName) {
            jobStatus = "failed";
            jobNotes = `Unsupported file type: ${unsupportedFileName}. ` +
                `WhatsApp does not support ZIP/RAR files. ` +
                `Please send as PDF, JPG, PNG, DOC, DOCX, PPTX, or XLSX.`;
        }

        // Transaction: BEGIN -> insert job -> bulk insert files -> COMMIT
        await runAsync("BEGIN TRANSACTION");

        try {
            await runAsync(
                `INSERT INTO print_jobs
                (job_id, store_id, sender_phone, source, file_count, total_pages, status, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [jobId, storeId, senderPhone, "whatsapp", files.length, totalPages, jobStatus, jobNotes]
            );

            await insertFileRecords(jobId, files);

            await runAsync("COMMIT");
        } catch (err) {
            await runAsync("ROLLBACK").catch(() => {});
            throw err;
        }

        // Response Object
        const createdJob = {
            jobId,
            job_id: jobId,
            storeId,
            store_id: storeId,
            senderPhone,
            sender_phone: senderPhone,
            customer_name: `WhatsApp (${senderPhone.slice(-4)})`,
            source: "whatsapp",
            status: jobStatus,
            notes: jobNotes,
            fileCount: files.length,
            file_count: files.length,
            totalPages: totalPages,
            total_pages: totalPages,
            files: files.map(mapFileForResponse),
            cost_of_job: 0,
            createdAt: new Date().toISOString()
        };

        // Notify desktop clients
        if (io) {
            io.to(`store-${storeId}`).emit("new-job", createdJob);
        }

        return createdJob;

    } catch (error) {
        console.error("processIncomingMessage error:", error);
        throw error;
    }
};

module.exports = {
    processIncomingMessage
};