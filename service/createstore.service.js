const bcrypt = require("bcrypt");
const Store = require("../model/store.model");

async function createstoreservice(storename, phonenumber, password) {
    if (!password) {
        return { status: 400, message: "Password is required" };
    }

    const hash = await bcrypt.hash(password, 10);

    try {
        const store = await Store.create({ storeName: storename, phoneNumber: phonenumber, password: hash });
        return { status: 201, storeId: store._id.toString() };
    } catch (error) {
        if (error.code === 11000) return { status: 409, message: "Phone number already registered" };
        throw error;
    }
}

module.exports = createstoreservice;