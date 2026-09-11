const mongoose = require('mongoose');
const Store = require('../model/store.model');

function storeFilter(storeId) {
    return mongoose.isValidObjectId(storeId) ? { _id: storeId } : { legacyStoreId: Number(storeId) };
}

function toProfile(store) {
    return {
        store_id: store._id.toString(),
        store_name: store.storeName,
        phone_number: store.phoneNumber,
        email: store.email || null,
        district: store.district || null,
        state: store.state || null,
        address: store.address || null,
        cache_folder: store.cacheFolder || null,
        created_at: store.createdAt
    };
}

async function getProfileService(storeId) {
    const store = await Store.findOne(storeFilter(storeId)).lean();
    return store ? { status: 200, profile: toProfile(store) } : { status: 404, message: 'Store not found' };
}

async function updateProfileService(storeId, payload) {
    const update = {
        storeName: String(payload.store_name || '').trim(),
        email: payload.email || undefined,
        district: payload.district || undefined,
        state: payload.state || undefined,
        address: payload.address || undefined,
        cacheFolder: payload.cache_folder || undefined
    };
    try {
        const store = await Store.findOneAndUpdate(storeFilter(storeId), { $set: update }, { new: true, runValidators: true }).lean();
        return store ? { status: 200 } : { status: 404, message: 'Store not found' };
    } catch (error) {
        if (error.code === 11000) return { status: 409, message: 'Email already registered' };
        throw error;
    }
}

module.exports = { getProfileService, updateProfileService };
