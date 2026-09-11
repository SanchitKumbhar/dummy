const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Store = require("../model/store.model");
require("dotenv").config();

async function generateToken(storeId, phoneNumber) {
    const payload = {
        storeId: storeId,
        phoneNumber: phoneNumber
    };
    const token = jwt.sign(
        payload,
        (process.env.JWT_SECRET || "").trim(),
        { expiresIn: process.env.JWT_EXPIRES_IN || "5h" }
    );
    return token;
}

async function checkPassword(plainPassword, hashedPassword) {
    return bcrypt.compare(plainPassword, hashedPassword);
}

async function getStoreByPhone(phoneNumber) { return Store.findOne({ phoneNumber }).lean(); }

async function userloginService(phoneNumber, password) {
    try {
        const user = await getStoreByPhone(phoneNumber);

        if (!user) {
            return { status: 401, message: "Invalid phone number or password" };
        }

        const passwordMatch = await checkPassword(password, user.password);
        if (!passwordMatch) {
            return { status: 401, message: "Invalid phone number or password" };
        }

        // FIX: was result.id — SQLite returns store_id
        const token = await generateToken(user._id.toString(), phoneNumber);

        return {
            status: 201,
            token,
            storeId: user._id.toString(),
            storeName: user.storeName
        };
    } catch (error) {
        console.error("Login service error:", error);
        return { status: 500, message: "Database error" };
    }
}

module.exports = userloginService;
