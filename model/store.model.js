const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
    legacyStoreId: { type: Number, unique: true, sparse: true, index: true },
    storeName: { type: String, required: true },
    email: { type: String, trim: true, lowercase: true },
    phoneNumber: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    district: String,
    state: String,
    address: String,
    cacheFolder: String,
    whatsapp: {
        phoneNumberId: String,
        accessToken: String,
        wabaId: String,
        businessId: String,
        displayPhoneNumber: String,
        verifiedName: String,
        connectedAt: Date
    },
    printSettings: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

storeSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });

module.exports = mongoose.model('Store', storeSchema);
