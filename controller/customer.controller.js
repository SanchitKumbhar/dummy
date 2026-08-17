const db = require("../config/sqlite.config");

/**
 * GET /api/customers/v1/list
 * Returns all customers for the authenticated store.
 */
const customerController = async (req, res) => {
    try {
        const storeId = req.storeId;
        if (!storeId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const customers = await new Promise((resolve, reject) => {
            db.all(
                `SELECT 
                    c.customer_id,
                    c.phone_number,
                    c.total_orders,
                    c.total_spent,
                    (SELECT MAX(p.created_at) FROM print_jobs p WHERE p.sender_phone = c.phone_number AND p.store_id = c.store_id) AS last_order_at
                 FROM customers c
                 WHERE c.store_id = ?
                 ORDER BY c.total_orders DESC`,
                [storeId],
                (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows || []);
                }
            );
        });

        return res.status(200).json({ success: true, data: customers });
    } catch (error) {
        console.error("customerController error:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

module.exports = { customerController };