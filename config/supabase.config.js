const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

function required(name) {
    if (!process.env[name]) throw new Error(`${name} is missing in .env`);
    return process.env[name];
}

const supabaseS3Client = new S3Client({
    region: 'us-east-1',
    endpoint: required('SUPABASE_S3_ENDPOINT'),
    forcePathStyle: true,
    credentials: {
        accessKeyId: required('SUPABASE_S3_ACCESS_KEY_ID'),
        secretAccessKey: required('SUPABASE_S3_SECRET_ACCESS_KEY')
    }
});

const getBucketName = () => required('SUPABASE_BUCKET_NAME');

async function getPresignedUploadUrl(fileKey, mimeType) {
    const command = new PutObjectCommand({
        Bucket: getBucketName(),
        Key: fileKey,
        ContentType: mimeType || 'application/octet-stream'
    });
    return getSignedUrl(supabaseS3Client, command, { expiresIn: 900 });
}

function getPublicFileUrl(fileKey) {
    const baseUrl = process.env.SUPABASE_PUBLIC_URL;
    return baseUrl ? `${baseUrl.replace(/\/$/, '')}/${getBucketName()}/${fileKey.split('/').map(encodeURIComponent).join('/')}` : fileKey;
}

module.exports = { supabaseS3Client, getPresignedUploadUrl, getPublicFileUrl };