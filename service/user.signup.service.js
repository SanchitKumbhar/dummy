const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Store = require("../model/store.model");
require("dotenv").config();

async function generateToken(storeId, phoneNumber) {
    return jwt.sign(
        { storeId, phoneNumber },
        (process.env.JWT_SECRET || "").trim(),
        { expiresIn: process.env.JWT_EXPIRES_IN || "5h" }
    );
}

async function signupService(name, phonenumber, password, email, district, state, address, cache_folder) {
    if (!name || !phonenumber || !password) return { status: 400, message: "Name, phone number and password are required" };
    const hash = await bcrypt.hash(password, 10);
    try {
        const store = await Store.create({ storeName: name, phoneNumber: phonenumber, password: hash, email: email || undefined, district, state, address, cacheFolder: cache_folder });
        return { status: 201, token: await generateToken(store._id.toString(), phonenumber), storeId: store._id.toString() };
    } catch (error) {
        if (error.code === 11000) return { status: 409, message: "Phone number or email already registered" };
        throw error;
    }
}

module.exports = signupService;