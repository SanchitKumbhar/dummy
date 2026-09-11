const path = require("path");
const Job = require('../model/job.model');
const { prepareIncomingFiles, isUnsupportedMediaType } = require("./archive.service.js");

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

        const jobFiles = files.map((file) => ({
            fileName: file.fileName || path.basename(file.localPath || ''),
            fileType: file.contentType || file.file_type || 'application/octet-stream',
            pages: file.pages || 0,
            r2Key: file.r2Key || file.localPath || '',
            fileUrl: file.fileUrl || file.localPath || ''
        }));
        await Job.create({
            jobId,
            storeId,
            customerName: `WhatsApp (${senderPhone.slice(-4)})`,
            senderPhone,
            source: 'whatsapp',
            status: jobStatus,
            notes: jobNotes,
            totalPages,
            files: jobFiles
        });

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