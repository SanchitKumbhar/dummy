const db = require("../config/sqlite.config");
const { v4: uuidv4 } = require("uuid");

// FIX: was hardcoded [1] — now uses dynamic store_id
function ordersService(store_id) {
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
                    created_at,
                    updated_at
             FROM print_jobs
             WHERE store_id = ?
             ORDER BY created_at DESC`,
            [store_id],
            (err, rows) => {
                if (err) {
                    console.error("ordersService error:", err);
                    return reject(err);
                }
                return resolve({ status: 200, order: rows || [] });
            }
        );
    });
}

// storeId is always required to prevent cross-tenant access (IDOR)
async function costService(jobId, cost, storeId) {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE print_jobs
             SET cost_of_job = ?, updated_at = CURRENT_TIMESTAMP
             WHERE job_id = ? AND store_id = ?`,
            [cost, jobId, storeId],
            function (err) {
                if (err) {
                    console.error("costService error:", err);
                    return reject(err);
                }
                if (this.changes === 0) {
                    return resolve({ status: 404, message: "Job not found or access denied" });
                }
                return resolve({ status: 200 });
            }
        );
    });
}

async function updateStatusService(jobId, status, storeId) {
    const validStatuses = ["pending", "printing", "paused", "completed", "cancelled"];
    if (!validStatuses.includes(status)) {
        return { status: 400, message: "Invalid status value" };
    }
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE print_jobs
             SET status = ?, updated_at = CURRENT_TIMESTAMP
             WHERE job_id = ? AND store_id = ?`,
            [status, jobId, storeId],
            function (err) {
                if (err) {
                    console.error("updateStatusService error:", err);
                    return reject(err);
                }
                if (this.changes === 0) {
                    return resolve({ status: 404, message: "Job not found or access denied" });
                }
                return resolve({ status: 200 });
            }
        );
    });
}

async function getJobFilesService(jobId, storeId) {
    return new Promise((resolve, reject) => {
        // JOIN with print_jobs to enforce tenant ownership
        db.all(
            `SELECT f.id, f.job_id, f.file_name, f.file_path, f.file_type, f.pages
             FROM print_job_files f
             INNER JOIN print_jobs j ON j.job_id = f.job_id
             WHERE f.job_id = ? AND j.store_id = ?`,
            [jobId, storeId],
            (err, rows) => {
                if (err) {
                    console.error("getJobFilesService error:", err);
                    return reject(err);
                }
                return resolve({ status: 200, files: rows || [] });
            }
        );
    });
}

async function createManualJobService(storeId, jobData) {
    const { customer_name, sender_phone, pages, source, notes } = jobData;
    const jobId = `MAN-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO print_jobs
                (job_id, store_id, customer_name, sender_phone, source, file_count, total_pages, status, cost_of_job)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0)`,
            [
                jobId,
                storeId,
                customer_name || "Walk-in Customer",
                sender_phone || "manual",
                source || "manual",
                0,
                parseInt(pages) || 1
            ],
            function (err) {
                if (err) {
                    console.error("createManualJobService error:", err);
                    return reject(err);
                }
                return resolve({
                    status: 201,
                    job: {
                        job_id: jobId,
                        store_id: storeId,
                        customer_name: customer_name || "Walk-in Customer",
                        sender_phone: sender_phone || "manual",
                        source: source || "manual",
                        file_count: 0,
                        total_pages: parseInt(pages) || 1,
                        status: "pending",
                        cost_of_job: 0,
                        created_at: new Date().toISOString()
                    }
                });
            }
        );
    });
}

async function getDashboardSummaryService(storeId) {
    const countsRow = await new Promise((resolve, reject) => {
        db.get(
            `SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN status = 'printing' THEN 1 ELSE 0 END) AS printing,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
                COALESCE(SUM(cost_of_job), 0) AS revenue
             FROM print_jobs
             WHERE store_id = ?`,
            [storeId],
            (err, row) => {
                if (err) return reject(err);
                resolve(row || {});
            }
        );
    });

    const incomingJobs = await new Promise((resolve, reject) => {
        db.all(
            `SELECT job_id, sender_phone, customer_name, source, total_pages, file_count, status, created_at
             FROM print_jobs
             WHERE store_id = ?
             ORDER BY datetime(created_at) DESC
             LIMIT 5`,
            [storeId],
            (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            }
        );
    });

    const recentActivity = await new Promise((resolve, reject) => {
        db.all(
            `SELECT job_id, status, sender_phone, customer_name, updated_at, created_at
             FROM print_jobs
             WHERE store_id = ?
             ORDER BY datetime(COALESCE(updated_at, created_at)) DESC
             LIMIT 8`,
            [storeId],
            (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            }
        );
    });

    const total = Number(countsRow.total || 0);
    const pending = Number(countsRow.pending || 0);
    const queueLoad = total > 0 ? Math.min(100, Math.round((pending / total) * 100)) : 0;

    return {
        status: 200,
        summary: {
            total,
            pending,
            printing: Number(countsRow.printing || 0),
            completed: Number(countsRow.completed || 0),
            revenue: Number(countsRow.revenue || 0),
            queueLoad,
            incomingJobs,
            recentActivity
        }
    };
}

module.exports = {
    ordersService,
    costService,
    updateStatusService,
    getJobFilesService,
    createManualJobService,
    getDashboardSummaryService
};
