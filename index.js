const express = require("express");
const dotenv = require("dotenv");
const http = require("http");
const path = require("path");
const cors = require("cors");
const cookieParser = require("cookie-parser");

dotenv.config({
    path: path.join(__dirname, ".env"),
    override: true
});

const { createAdapter } = require("@socket.io/redis-adapter");
const { Queue } = require("bullmq");
const Redis = require("ioredis"); // Replaced "redis" with "ioredis"

const pendingJobsSync = require("./router/pending.sync.route");
const printwebhook = require("./router/print.webhook.route");
const userRoutes = require("./router/user.auth");
const orderRoute = require("./router/order.route");
const storeRoute = require("./router/store.route");
const customerRoute = require("./router/customer.route");
const emailRoutes = require("./router/email.routes.js");
const whatsappRoute = require("./router/token.route");

const {
    createstoretable,
    createjobtable,
    createjobfilestable,
    createcustomertable,
    migrations
} = require("./model/store.init.model");

const db = require("./config/sqlite.config");

const app = express();
const server = http.createServer(app);

// ---- Socket.IO ----
const io = require("socket.io")(server, {
    cors: { origin: "*" }
});
app.set("io", io);

// ---- MIDDLEWARE ----
app.use(cors({ origin: "*", credentials: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---- STATIC FILES (uploaded print files) ----
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ---- SOCKET.IO ----
io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);
    socket.on("register-store", ({ storeId }) => {
        socket.join(`store-${storeId}`);
        console.log(`Socket ${socket.id} joined room store-${storeId}`);
    });
    socket.on("disconnect", (reason) => {
        console.log("Socket disconnected:", socket.id, reason);
    });
});

// ---- DATABASE INIT ----
function runDbStatement(sql) {
    return new Promise((resolve) => {
        db.run(sql, (err) => {
            if (err
                && !err.message.includes("duplicate column")
                && !err.message.includes("already exists")
            ) {
                console.warn("DB migration warning:", err.message.substring(0, 120));
            }
            resolve();
        });
    });
}

async function initDatabase() {
    await runDbStatement(createstoretable);
    await runDbStatement(createjobtable);
    await runDbStatement(createjobfilestable);
    await runDbStatement(createcustomertable);
    for (const migration of migrations) {
        await runDbStatement(migration);
    }
    console.log("Database ready.");
}

// ---- ROUTES ----
app.use("/api/email", emailRoutes);
app.use("/api/printwebhook", printwebhook);
app.use("/api/pending-job", pendingJobsSync);
app.use("/api/user-auth", userRoutes);
app.use("/api/orders", orderRoute);
app.use("/api/print-job", printwebhook);
app.use("/api/store", storeRoute);
app.use("/api/customers", customerRoute);
app.use("/api/whatsapp", whatsappRoute);

// ---- META WEBHOOK VERIFICATION ----
app.get("/webhook", (req, res) => {
    const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
    const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

app.post("/webhook", async (req, res) => {
    try {
        const body = req.body;
        if (body.object === "whatsapp_business_account") {
            for (const entry of body.entry || []) {
                const changes = entry.changes?.[0]?.value;
                if (changes?.messages?.length > 0) {
                    const message = changes.messages[0];
                    const senderPhone = changes.contacts?.[0]?.wa_id;
                    console.log(`WhatsApp ${message.type} from ${senderPhone}`);

                    const mq = req.app.get("messageQueue");
                    if (mq) {
                        await mq.add("process-meta-message", {
                            payload: changes,
                            storeId: 1
                        });
                    }
                }
            }
            res.sendStatus(200);
        } else {
            res.sendStatus(404);
        }
    } catch (error) {
        console.error("Webhook error:", error);
        res.sendStatus(500);
    }
});

// ---- HEALTH CHECK ----
app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ---- TRY REDIS (one-shot, no auto-reconnect) ----
async function tryConnectRedis() {
    const redisUrl = process.env.REDIS_URL;

    if (!redisUrl) {
        console.warn("REDIS_URL not set. Running in standalone Socket.IO mode only.");
        app.set("messageQueue", null);
        app.set("archiveQueue", null);
        return false;
    }

    try {
        // 1. Setup BullMQ Queues First (Critical for Webhooks)
        const bullRedis = new Redis(redisUrl, {
            maxRetriesPerRequest: null,
            enableReadyCheck: false
        });
        bullRedis.on("error", (err) => console.error("BullMQ Redis error:", err.message));

        const messageQueue = new Queue("whatsapp-jobs", {
            connection: bullRedis
        });
        const archiveQueue = new Queue("archive-jobs", {
            connection: new Redis(redisUrl, {
                maxRetriesPerRequest: null,
                enableReadyCheck: false
            })
        });

        app.set("messageQueue", messageQueue);
        app.set("archiveQueue", archiveQueue);

        // 2. Setup Socket.IO pub/sub via ioredis
        const pubClient = new Redis(redisUrl);
        const subClient = new Redis(redisUrl);
        const evtClient = new Redis(redisUrl);

        pubClient.on("error", () => {});
        subClient.on("error", () => {});
        evtClient.on("error", () => {});

        // Wire Socket.IO Redis adapter
        io.adapter(createAdapter(pubClient, subClient));

        // Bridge Redis pub/sub events → Socket.IO rooms using ioredis syntax
        evtClient.subscribe("store-events", (err) => {
            if (err) console.error("Redis subscribe error:", err.message);
        });

        evtClient.on("message", (channel, message) => {
            if (channel === "store-events") {
                try {
                    const { storeId, event, data } = JSON.parse(message);
                    io.to(`store-${storeId}`).emit(event, data);
                } catch (e) {
                    console.error("Redis bridge error:", e.message);
                }
            }
        });

        // Start archive worker in-process (job worker runs separately)
        require("./workers/archive.worker");
        console.log("Archive worker started.");

        console.log("Redis connected. Socket.IO adapter + BullMQ queues ready.");
        return true;
    } catch (err) {
        console.warn(`Redis unavailable (${err.message}). Running in standalone mode.`);
        app.set("messageQueue", null);
        app.set("archiveQueue", null);
        return false;
    }
}

// ---- START ----
const PORT = process.env.PORT || 5000;

(async () => {
    try {
        await initDatabase();
        await tryConnectRedis();

        server.listen(PORT, () => {
            console.log(`PrintFlow backend running on http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error("Fatal startup error:", err);
        process.exit(1);
    }
})();