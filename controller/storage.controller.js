const crypto = require('crypto');
const { getPresignedUploadUrl, getPublicFileUrl } = require('../config/supabase.config');

const ALLOWED_TYPES = new Set([
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

async function createUploadUrl(req, res) {
    const { fileName, mimeType } = req.body || {};
    if (!fileName || !mimeType || !ALLOWED_TYPES.has(mimeType)) {
        return res.status(400).json({ success: false, message: 'A supported fileName and mimeType are required' });
    }

    const safeName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
    const fileKey = `stores/${req.storeId}/uploads/${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${safeName}`;
    try {
        const uploadUrl = await getPresignedUploadUrl(fileKey, mimeType);
        return res.status(201).json({ uploadUrl, fileKey, fileUrl: getPublicFileUrl(fileKey), expiresIn: 900 });
    } catch (error) {
        console.error('createUploadUrl error:', error);
        return res.status(500).json({ success: false, message: 'Unable to prepare file upload' });
    }
}

module.exports = { createUploadUrl };