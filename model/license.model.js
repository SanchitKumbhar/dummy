const mongoose = require('mongoose');

const activatedDeviceSchema = new mongoose.Schema({
    machineId: { type: String, required: true },
    activatedAt: { type: Date, default: Date.now },
    lastValidatedAt: { type: Date, default: Date.now }
}, { _id: false });

const licenseSchema = new mongoose.Schema({
    licenseKey: { type: String, required: true, unique: true, index: true },
    customerEmail: { type: String, required: true, lowercase: true, trim: true },
    planType: { type: String, required: true, enum: ['monthly', 'annual'] },
    status: { type: String, enum: ['active', 'expired', 'revoked'], default: 'active' },
    paymentId: { type: String, ref: 'Payment', required: true },
    expiresAt: { type: Date, required: true },
    activatedDevices: { type: [activatedDeviceSchema], default: [] }
}, { timestamps: true });

licenseSchema.index({ 'activatedDevices.machineId': 1, status: 1 });
licenseSchema.index({ expiresAt: 1 });

module.exports = mongoose.model('License', licenseSchema);
