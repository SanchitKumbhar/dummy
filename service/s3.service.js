const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const fs = require("fs");

const s3Client = new S3Client({
    forcePathStyle: true,
    region: process.env.SUPABASE_REGION || "ap-south-1",
    endpoint: process.env.SUPABASE_S3_ENDPOINT,
    credentials: {
        accessKeyId: process.env.SUPABASE_S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.SUPABASE_S3_SECRET_ACCESS_KEY,
    }
});

/**
 * Uploads a local file to Supabase S3 and deletes the local copy.
 * @param {string} localFilePath - Path to the local file
 * @param {string} originalName - Original file name
 * @param {string} mimeType - MIME type of the file
 * @returns {Promise<{fileUrl: string, r2Key: string}>}
 */
const uploadFileToS3 = async (localFilePath, originalName, mimeType) => {
    try {
        const fileStream = fs.createReadStream(localFilePath);
        const bucketName = process.env.SUPABASE_BUCKET_NAME || 'yellowqueue-files';
        
        // Generate a unique object key
        const uniqueKey = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}_${(originalName || "file").replace(/[^a-zA-Z0-9.-]/g, "_")}`;

        const uploadParams = {
            Bucket: bucketName,
            Key: uniqueKey,
            Body: fileStream,
            ContentType: mimeType || 'application/octet-stream',
        };

        const command = new PutObjectCommand(uploadParams);
        await s3Client.send(command);

        // Delete the local file to save space
        try {
            if (fs.existsSync(localFilePath)) {
                fs.unlinkSync(localFilePath);
            }
        } catch (err) {
            console.warn(`Failed to delete local file after upload: ${localFilePath}`, err.message);
        }

        // Construct public URL
        const publicUrlBase = process.env.SUPABASE_PUBLIC_URL || '';
        const fileUrl = `${publicUrlBase}/${bucketName}/${uniqueKey}`;
        
        return {
            fileUrl,
            r2Key: uniqueKey
        };
    } catch (error) {
        console.error("S3 Upload Error:", error);
        throw error;
    }
};

module.exports = {
    uploadFileToS3,
    s3Client
};
