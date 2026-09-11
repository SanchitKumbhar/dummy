const dns = require('dns');
const mongoose = require('mongoose');
let shutdownRegistered = false;

const dnsServers = (process.env.MONGODB_DNS_SERVERS || '1.1.1.1,8.8.8.8')
    .split(',')
    .map((server) => server.trim())
    .filter(Boolean);

if (dnsServers.length) dns.setServers(dnsServers);

const connectMongoDB = async () => {
    try {
        const uri = process.env.MONGODB_URI;
        if (!uri) throw new Error("MONGODB_URI is missing in .env");

        await mongoose.connect(uri, {
            maxPoolSize: 15,
            minPoolSize: 2,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });
        console.log("Connected to MongoDB Atlas");
        registerShutdownHandlers();
    } catch (err) {
        console.error("MongoDB connection error:", err);
        process.exit(1);
    }
};

function registerShutdownHandlers() {
    if (shutdownRegistered) return;
    shutdownRegistered = true;

    const shutdown = async (signal) => {
        try {
            await mongoose.connection.close();
            console.log(`MongoDB connection closed after ${signal}`);
            process.exit(0);
        } catch (error) {
            console.error("MongoDB shutdown error:", error);
            process.exit(1);
        }
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = connectMongoDB;
