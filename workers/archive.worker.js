// workers/archive.worker.js
// Processes archive-jobs queue: extracts ZIP/RAR files, then re-queues to whatsapp-jobs.
// Note: Meta's WhatsApp Cloud API does NOT deliver zip/rar as downloadable media,
// so this worker will only fire if archives arrive through an alternative path
// (e.g. direct upload, or a future non-WhatsApp channel).

const { Worker, Queue } = require("bullmq");
const Redis = require("ioredis");
const dotenv = require("dotenv");
const { prepareIncomingFiles, getTokenForStore } = require("../service/archive.service.js");

dotenv.config({ path: require("path").resolve(__dirname, "../.env") });

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
    console.error("REDIS_URL not set. Archive worker cannot start.");
    process.exit(1);
}

const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null
});

const messageQueue = new Queue("whatsapp-jobs", {
    connection: new Redis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false
    })
});

connection.on("connect", () => {
    console.log("Redis connected for archive worker");
});

connection.on("error", (err) => {
    console.error("Archive worker Redis connection error:", err.message);
});

const worker = new Worker(
    "archive-jobs",
    async (job) => {
        const { payload, storeId } = job.data;

        if (!payload || !payload.MessageSid) {
            throw new Error("Archive job payload is missing MessageSid");
        }

        const resolvedStoreId = storeId || 1;
        console.log(`Extracting archive for message ${payload.MessageSid} (store-${resolvedStoreId})`);

        const token = await getTokenForStore(resolvedStoreId);
        const preparedFiles = await prepareIncomingFiles(payload, token);

        if (!preparedFiles.length) {
            console.warn(`No files extracted from archive message ${payload.MessageSid}. ` +
                `This is expected if the file was a ZIP sent via WhatsApp (unsupported by Meta's Cloud API).`);
            // Still re-queue so the job gets recorded with 0 files and proper status
        }

        await messageQueue.add(
            "process-message",
            { payload, storeId: resolvedStoreId, preparedFiles },
            { jobId: payload.MessageSid }
        );

        return { jobId: payload.MessageSid, files: preparedFiles.length };
    },
    { connection }
);

worker.on("completed", (job) => {
    console.log("Archive job completed:", job.id);
});

worker.on("failed", (job, err) => {
    console.error("Archive job failed:", job?.id, err.message);
});