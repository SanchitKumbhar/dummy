const db = require("../config/sqlite.config");

// FIX: was db.run() (no rows), wrong columns, broken promise, bad SQL quote on 'pending'
async function pendingJobsSyncService(storeId) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT job_id, sender_phone, file_path, source, total_pages, status, created_at
             FROM print_jobs
             JOIN print_job_files USING (job_id)
             WHERE print_jobs.store_id = ?
               AND print_jobs.status = 'pending'`,
            [storeId],
            (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            }
        );
    });
}

module.exports = pendingJobsSyncService;
