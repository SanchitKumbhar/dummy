const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    orderId: { type: String, required: true, unique: true, index: true },
    storeId: { type: mongoose.Schema.Types.Mixed, index: true },
    machineId: { type: String, index: true },
    status: { type: String, enum: ['pending', 'paid', 'fulfilled', 'cancelled'], default: 'pending' },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
    fileUrl: String,
    r2Key: String,
    completedAt: Date
}, { timestamps: true });

orderSchema.index({ completedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60, partialFilterExpression: { status: 'fulfilled' } });

module.exports = mongoose.model('Order', orderSchema);