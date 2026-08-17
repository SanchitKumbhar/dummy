const db = require("../config/sqlite.config");

function getProfileService(storeId) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT store_id, store_name, phone_number, email, district, state, address, cache_folder, created_at
             FROM stores
             WHERE store_id = ?`,
            [storeId],
            (err, row) => {
                if (err) return reject(err);
                if (!row) return resolve({ status: 404, message: "Store not found" });
                return resolve({ status: 200, profile: row });
            }
        );
    });
}

function updateProfileService(storeId, payload) {
    const {
        store_name,
        email,
        district,
        state,
        address,
        cache_folder
    } = payload;

    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE stores
             SET store_name = ?,
                 email = ?,
                 district = ?,
                 state = ?,
                 address = ?,
                 cache_folder = ?
             WHERE store_id = ?`,
            [
                String(store_name || "").trim(),
                email || null,
                district || null,
                state || null,
                address || null,
                cache_folder || null,
                storeId
            ],
            function (err) {
                if (err) {
                    if (err.code === "SQLITE_CONSTRAINT") {
                        return resolve({ status: 409, message: "Email already registered" });
                    }
                    return reject(err);
                }
                if (this.changes === 0) {
                    return resolve({ status: 404, message: "Store not found" });
                }
                return resolve({ status: 200 });
            }
        );
    });
}

module.exports = {
    getProfileService,
    updateProfileService
};
