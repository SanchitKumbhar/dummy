const path = require("path");
const sqlite3 = require("sqlite3").verbose();

// ALWAYS point to single DB file
const dbPath = path.join(__dirname, "../database2.db");

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("DB connection error:", err.message);
    } else {
        console.log("Connected to shared SQLite DB:", dbPath);
    }
});

module.exports = db;