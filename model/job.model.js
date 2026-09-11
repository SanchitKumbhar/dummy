const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
    fileName: { type: String, required: true },
    fileType: String,
    pages: { type: Number, default: 0 },
    r2Key: { type: String, required: true }, 
    fileUrl: { type: String, required: true }
});

const jobSchema = new mongoose.Schema({
    jobId: { type: String, required: true, unique: true },
    storeId: { type: mongoose.Schema.Types.Mixed, ref: 'Store' },
    legacyStoreId: { type: Number, index: true },
    customerName: { type: String },
    senderPhone: { type: String, required: true },
    source: { type: String, required: true },
    status: { 
        type: String, 
        enum: ['pending', 'processing', 'completed', 'failed', 'printing', 'paused', 'cancelled'], 
        default: 'pending' 
    },
    costOfJob: { type: Number, default: 0 },
    
    // Razorpay Integration
    paymentStatus: { 
        type: String, 
        enum: ['pending', 'paid', 'failed', 'refunded'], 
        default: 'pending' 
    },
    razorpayOrderId: { type: String, sparse: true },
    razorpayPaymentId: { type: String, sparse: true },
    razorpaySignature: { type: String },

    totalPages: { type: Number, default: 0 },
    notes: String,
    files: [fileSchema],
}, { timestamps: true });

// TTL Index: Auto-expire jobs 30 days after they are updated to 'completed' or 'failed'
jobSchema.index(
    { updatedAt: 1 }, 
    { 
        expireAfterSeconds: 30 * 24 * 60 * 60, 
        partialFilterExpression: { status: { $in: ['completed', 'failed', 'cancelled'] } } 
    }
);

jobSchema.index({ storeId: 1 });
jobSchema.index({ status: 1 });
jobSchema.index({ storeId: 1, status: 1 });

module.exports = mongoose.model('Job', jobSchema);
