const db = require("../config/sqlite.config");

// FIX: was db.run() which doesn't return rows — must use db.all() for SELECT
async function jobService(store_id) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT job_id,
                    customer_name,
                    sender_phone,
                    source,
                    file_count,
                    total_pages,
                    status,
                    cost_of_job,
                    created_at
             FROM print_jobs
             WHERE store_id = ?
             ORDER BY created_at DESC`,
            [store_id],
            (error, rows) => {
                if (error) {
                    console.error("jobService error:", error);
                    return reject(error);
                }
                return resolve({ jobs: rows || [] });
            }
        );
    });
}

module.exports = jobService;
