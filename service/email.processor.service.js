const path = require("path");
const Job = require("../model/job.model");
const { getPageCount } = require("./archive.service.js");

/**
 * Main email processor
 */
const processIncomingEmail = async (emailData, attachments, io, storeId) => {
    try {
        const senderEmail = emailData.from || "unknown@email.com";
        const subject = emailData.subject || "No Subject";
        const jobId = `email-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        
        let jobStatus = "pending";
        let jobNotes = subject;

        const files = await Promise.all(attachments.map(async (file) => {
            const pages = await getPageCount(file.path, file.mimetype);
            return {
                fileName: file.originalname,
                localPath: file.path,
                contentType: file.mimetype,
                pages: pages
            };
        }));

        let totalPages = 0;
        for (const f of files) totalPages += (f.pages || 0);

        if (files.length === 0) {
            jobStatus = "failed";
            jobNotes = "No supported attachments found in the email.";
        }

        const mongoFiles = files.map((file) => ({
            fileName: file.fileName,
            fileType: file.contentType || "application/octet-stream",
            pages: file.pages || 1,
            r2Key: file.localPath,
            fileUrl: file.localPath
        }));

        await Job.create({
            jobId,
            storeId: String(storeId),
            customerName: `Email (${senderEmail.split('@')[0]})`,
            senderPhone: senderEmail,
            source: "email",
            status: jobStatus,
            notes: jobNotes,
            totalPages,
            files: mongoFiles
        });

        const createdJob = {
            jobId,
            job_id: jobId,
            storeId: String(storeId),
            store_id: String(storeId),
            senderPhone: senderEmail,
            sender_phone: senderEmail,
            customer_name: `Email (${senderEmail.split('@')[0]})`,
            source: "email",
            status: jobStatus,
            notes: jobNotes,
            fileCount: files.length,
            file_count: files.length,
            totalPages: totalPages,
            total_pages: totalPages,
            files: files.map(f => ({
                file_name: f.fileName,
                fileName: f.fileName,
                original_name: f.fileName,
                originalName: f.fileName,
                file_path: f.localPath,
                filePath: f.localPath,
                file_type: f.contentType,
                fileType: f.contentType,
                pages: f.pages || 1,
                localPath: f.localPath
            })),
            cost_of_job: 0,
            createdAt: new Date().toISOString()
        };

        if (io) {
            io.to(`store-${String(storeId)}`).emit("new-job", createdJob);
        }

        return createdJob;
    } catch (error) {
        console.error("processIncomingEmail error:", error);
        throw error;
    }
};

module.exports = {
    processIncomingEmail
};