const db = require("../config/sqlite.config");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
require("dotenv").config();

async function generateToken(storeId, phoneNumber) {
    return jwt.sign(
        { storeId, phoneNumber },
        (process.env.JWT_SECRET || "").trim(),
        { expiresIn: process.env.JWT_EXPIRES_IN || "5h" }
    );
}

function signupService(name, phonenumber, password, email, district, state, address, cache_folder) {
    return new Promise(async (resolve, reject) => {
        try {
            const hash = await bcrypt.hash(password, 10);

            // whatsapp_phone_number_id is intentionally NULL here — it doesn't
            // exist yet at signup. It gets populated later once this store
            // completes WhatsApp Embedded Signup/Coexistence, at which point
            // you UPDATE this row with the phone_number_id Meta returns.
            db.run(
                `INSERT INTO stores (store_name, whatsapp_phone_number_id, phone_number, password, email, district, state, address, cache_folder)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [name, null, phonenumber, hash, email || null, district, state, address, cache_folder],
                async function (err) {
                    if (err) {
                        // UNIQUE constraint on phone_number or email
                        if (err.code === "SQLITE_CONSTRAINT") {
                            return resolve({
                                status: 409,
                                message: "Phone number or email already registered"
                            });
                        }
                        return reject(err);
                    }

                    const token = await generateToken(this.lastID, phonenumber);
                    resolve({ status: 201, token });
                }
            );
        } catch (err) {
            reject(err);
        }
    });
}

module.exports = signupService;