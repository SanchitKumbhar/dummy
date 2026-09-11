const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    orderId: { type: String, required: true, unique: true, index: true },
    paymentId: { type: String, sparse: true, index: true },
    machineId: { type: String, required: true, index: true },
    customerEmail: { type: String, required: true, trim: true, lowercase: true },
    amount: { type: Number, required: true, enum: [39900, 399900] },
    currency: { type: String, enum: ['INR'], default: 'INR' },
    planType: { type: String, required: true, enum: ['monthly', 'annual'] },
    status: { type: String, enum: ['created', 'attempted', 'captured', 'failed', 'refunded'], default: 'created' },
    rawWebhookPayload: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

module.exports = mongoose.model('Payment', paymentSchema);