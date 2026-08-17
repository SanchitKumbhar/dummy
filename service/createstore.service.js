const db = require("../config/sqlite.config");
const bcrypt = require("bcrypt");

async function createstoreservice(storename, phonenumber, password) {
    const hash = password ? await bcrypt.hash(password, 10) : await bcrypt.hash("default123", 10);

    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO stores (store_name, phone_number, password) VALUES (?, ?, ?)`,
            [storename, phonenumber, hash],
            function (err) {
                if (err) {
                    if (err.code === "SQLITE_CONSTRAINT") {
                        return resolve({ status: 409, message: "Phone number already registered" });
                    }
                    console.error("createstoreservice error:", err);
                    return reject(err);
                }
                console.log("Store created with ID:", this.lastID);
                return resolve({ status: 201, storeId: this.lastID });
            }
        );
    });
}

module.exports = createstoreservice;