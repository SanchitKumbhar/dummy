require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const mongoose = require('mongoose');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const connectMongoDB = require('../config/mongo.config');
const { supabaseS3Client, getPublicFileUrl } = require('../config/supabase.config');
const Store = require('../model/store.model');
const Job = require('../model/job.model');

const databasePath = process.env.SQLITE_MIGRATION_PATH || path.join(__dirname, '..', 'database2.db');
const uploadsPath = process.env.LEGACY_UPLOADS_PATH || path.join(__dirname, '..', 'uploads');
const batchSize = 250;

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
}

async function optionalAll(db, sql) {
    try { return await all(db, sql); } catch (_) { return []; }
}

async function uploadLegacyFile(fileName) {
    const filePath = path.isAbsolute(fileName) ? fileName : path.join(uploadsPath, fileName);
    const key = `legacy/${fileName}`;
    await supabaseS3Client.send(new PutObjectCommand({
        Bucket: process.env.SUPABASE_BUCKET_NAME,
        Key: key,
        Body: fs.createReadStream(filePath)
    }));
    return { fileName, r2Key: key, fileUrl: getPublicFileUrl(key) };
}

async function bulkInBatches(collection, operations) {
    for (let offset = 0; offset < operations.length; offset += batchSize) {
        await collection.bulkWrite(operations.slice(offset, offset + batchSize), { ordered: false });
        console.log(`  ${Math.min(offset + batchSize, operations.length)}/${operations.length}`);
    }
}

async function prepareStoreIndexes() {
    try { await Store.collection.dropIndex('email_1'); } catch (error) {
        if (error.codeName !== 'IndexNotFound') throw error;
    }
    await Store.collection.createIndex(
        { email: 1 },
        { unique: true, partialFilterExpression: { email: { $type: 'string' } } }
    );
}

async function migrate() {
    if (!process.env.MONGODB_URI || !process.env.SUPABASE_BUCKET_NAME) throw new Error('MONGODB_URI and SUPABASE_BUCKET_NAME are required');
    const db = new sqlite3.Database(databasePath);
    try {
        await connectMongoDB();
        const stores = await all(db, 'SELECT * FROM stores');
        await prepareStoreIndexes();
        const storeOperations = stores.map((store) => ({ updateOne: {
            filter: { legacyStoreId: store.store_id },
            update: {
                $set: {
                    legacyStoreId: store.store_id, storeName: store.store_name,
                    phoneNumber: store.phone_number, password: store.password,
                    district: store.district, state: store.state, address: store.address,
                    ...(store.email ? { email: store.email.trim().toLowerCase() } : {})
                },
                ...(store.email ? {} : { $unset: { email: 1 } })
            }, upsert: true
        } }));
        if (storeOperations.length) {
            Store.schema.add({ legacyStoreId: { type: Number, unique: true, sparse: true } });
            await bulkInBatches(Store.collection, storeOperations);
        }
        console.log(`Migrated stores: ${stores.length}`);

        const users = await optionalAll(db, 'SELECT * FROM users');
        if (users.length) await bulkInBatches(mongoose.connection.collection('legacy_users'), users.map((user) => ({ updateOne: { filter: { legacyId: user.user_id || user.id }, update: { $set: { ...user, legacyId: user.user_id || user.id } }, upsert: true } })));
        const settings = await optionalAll(db, 'SELECT * FROM settings');
        if (settings.length) await bulkInBatches(mongoose.connection.collection('legacy_settings'), settings.map((setting) => ({ updateOne: { filter: { legacyId: setting.id || setting.setting_id }, update: { $set: { ...setting, legacyId: setting.id || setting.setting_id } }, upsert: true } })));
        console.log(`Migrated legacy users: ${users.length}; settings: ${settings.length}`);

        const files = await all(db, 'SELECT * FROM print_job_files');
        const uploaded = new Map();
        for (const file of files) {
            if (!file.file_path || !fs.existsSync(file.file_path)) continue;
            const name = path.basename(file.file_path);
            if (!uploaded.has(name)) uploaded.set(name, await uploadLegacyFile(name));
        }
        console.log(`Uploaded legacy files: ${uploaded.size}`);

        const jobs = await all(db, 'SELECT * FROM print_jobs');
        const jobFiles = new Map();
        for (const file of files) {
            const name = path.basename(file.file_path || '');
            if (!uploaded.has(name)) continue;
            if (!jobFiles.has(file.job_id)) jobFiles.set(file.job_id, []);
            jobFiles.get(file.job_id).push({ ...uploaded.get(name), fileType: file.file_type, pages: file.pages || 0 });
        }
        const jobOperations = jobs.map((job) => ({ updateOne: {
            filter: { jobId: job.job_id },
            update: { $set: {
                jobId: job.job_id, legacyStoreId: job.store_id, customerName: job.customer_name,
                senderPhone: job.sender_phone, source: job.source, totalPages: job.total_pages || 0,
                status: job.status || 'pending', costOfJob: job.cost_of_job || 0, notes: job.notes,
                files: jobFiles.get(job.job_id) || [], createdAt: job.created_at, updatedAt: job.updated_at
            } }, upsert: true
        } }));
        if (jobOperations.length) {
            Job.schema.add({ legacyStoreId: Number, customerName: String, costOfJob: Number });
            await bulkInBatches(Job.collection, jobOperations);
        }
        console.log(`Migrated jobs: ${jobs.length}`);
        console.log('Migration complete.');
    } finally {
        db.close();
        await mongoose.connection.close();
    }
}

migrate().catch((error) => { console.error('Migration failed:', error); process.exitCode = 1; });