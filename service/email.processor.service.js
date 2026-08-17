const path = require("path");
const db = require("../config/sqlite.config");
const { getPageCount } = require("./archive.service.js");

// Promisified database helpers
const runAsync = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) return reject(err);
            resolve(this);
        });
    });

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
                stmt.run(jobId, file.fileName, file.localPath, file.contentType, file.pages || 0, (err) => {
                    if (err && !firstError) firstError = err;
                });
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
 * Main email processor
 */
const processIncomingEmail = async (emailData, attachments, io, storeId) => {
    try {
        const senderEmail = emailData.from || "unknown@email.com";
        const subject = emailData.subject || "No Subject";
        const jobId = `email-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        
        let jobStatus = "pending";
        let jobNotes = subject;

        // Count pages for each attachment
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

        // Database Transaction
        await runAsync("BEGIN TRANSACTION");
        try {
            await runAsync(
                `INSERT INTO print_jobs
                (job_id, store_id, sender_phone, source, file_count, total_pages, status, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                // We store the sender's email in sender_phone to reuse your schema
                [jobId, storeId, senderEmail, "email", files.length, totalPages, jobStatus, jobNotes]
            );
            await insertFileRecords(jobId, files);
            await runAsync("COMMIT");
        } catch (err) {
            await runAsync("ROLLBACK").catch(() => {});
            throw err;
        }

        const createdJob = {
            jobId,
            job_id: jobId,
            storeId,
            store_id: storeId,
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

        // Emit to the specific store's desktop client
        if (io) {
            io.to(`store-${storeId}`).emit("new-job", createdJob);
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