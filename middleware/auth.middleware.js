const jwt = require("jsonwebtoken");
require("dotenv").config();

function verifyToken(req, res, next) {
    try {
        let token =
            req.header("Authorization") || req.cookies.token;

        if (!token) {
            return res.status(401).json({ error: "Access denied" });
        }

        // Handle Bearer token
        if (token.startsWith("Bearer ")) {
            token = token.split(" ")[1];
        }

        // Trim whitespace from JWT_SECRET to prevent signing/verification mismatch
        const secret = (process.env.JWT_SECRET || "").trim();
        if (!secret) {
            console.error("JWT_SECRET is not configured");
            return res.status(500).json({ error: "Server configuration error" });
        }

        const decoded = jwt.verify(token, secret);

        req.storeId = decoded.storeId;
        next();

    } catch (error) {
        return res.status(401).json({ error: "Invalid token" });
    }
}

module.exports = verifyToken;