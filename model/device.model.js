const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
    machineId: { type: String, required: true, unique: true, index: true, trim: true },
    trialStartedAt: Date,
    trialExpiresAt: Date,
    lastPingAt: Date,
    isRevoked: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Device', deviceSchema);