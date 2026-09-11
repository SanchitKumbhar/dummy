const express = require('express');
const dotenv = require('dotenv');
const http = require('http');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');

dotenv.config({ path: path.join(__dirname, '.env'), override: true });

const { createAdapter } = require('@socket.io/redis-adapter');
const { Queue } = require('bullmq');
const Redis = require('ioredis');
const pendingJobsSync = require('./router/pending.sync.route');
const printwebhook = require('./router/print.webhook.route');
const userRoutes = require('./router/user.auth');
const orderRoute = require('./router/order.route');
const storeRoute = require('./router/store.route');
const customerRoute = require('./router/customer.route');
const whatsappRoute = require('./router/token.route');
const { router: paymentRoute, licenseRouter } = require('./router/payment.route');
const storageRoute = require('./router/storage.route');
const connectMongoDB = require('./config/mongo.config');

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, { cors: { origin: '*' } });
app.set('io', io);

app.use(cors({ origin: '*', credentials: true }));
app.use(cookieParser());
app.use('/api/v1/payment', paymentRoute);
app.use('/api/v1/license', licenseRouter);
app.use('/api/v1/storage', storageRoute);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);
    socket.on('register-store', ({ storeId }) => socket.join(`store-${storeId}`));
    socket.on('disconnect', (reason) => console.log('Socket disconnected:', socket.id, reason));
});

app.use('/api/printwebhook', printwebhook);
app.use('/api/pending-job', pendingJobsSync);
app.use('/api/user-auth', userRoutes);
app.use('/api/orders', orderRoute);
app.use('/api/print-job', printwebhook);
app.use('/api/store', storeRoute);
app.use('/api/customers', customerRoute);
app.use('/api/whatsapp', whatsappRoute);

app.get('/webhook', (req, res) => {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    res.status(mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN ? 200 : 403).send(mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN ? challenge : 'Forbidden');
});

app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

async function tryConnectRedis() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) return false;
    try {
        const bullRedis = new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
        bullRedis.on('error', (error) => console.error('BullMQ Redis error:', error.message));
        app.set('messageQueue', new Queue('whatsapp-jobs', { connection: bullRedis }));
        app.set('archiveQueue', new Queue('archive-jobs', { connection: new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false }) }));
        const pubClient = new Redis(redisUrl);
        const subClient = new Redis(redisUrl);
        const eventClient = new Redis(redisUrl);
        io.adapter(createAdapter(pubClient, subClient));
        await eventClient.subscribe('store-events');
        eventClient.on('message', (channel, message) => {
            if (channel !== 'store-events') return;
            try {
                const { storeId, event, data } = JSON.parse(message);
                io.to(`store-${storeId}`).emit(event, data);
            } catch (error) {
                console.error('Redis bridge error:', error.message);
            }
        });
        console.log('Redis connected.');
        return true;
    } catch (error) {
        console.warn(`Redis unavailable (${error.message}). Running without queues.`);
        app.set('messageQueue', null);
        app.set('archiveQueue', null);
        return false;
    }
}

const PORT = process.env.PORT || 5000;
(async () => {
    try {
        await connectMongoDB();
        await tryConnectRedis();
        server.listen(PORT, () => console.log(`PrintFlow backend running on http://localhost:${PORT}`));
    } catch (error) {
        console.error('Fatal startup error:', error);
        process.exit(1);
    }
})();
