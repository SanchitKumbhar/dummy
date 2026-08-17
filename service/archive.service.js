const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { exec, execFile } = require("child_process");
const util = require("util");
const db = require("../config/sqlite.config");

const execPromise = util.promisify(exec);
const execFilePromise = util.promisify(execFile);

// Resolve uploads relative to the backend root (not process.cwd())
const BACKEND_ROOT = path.resolve(__dirname, "..");
const UPLOADS_DIR = path.join(BACKEND_ROOT, "uploads");

const GRAPH_API_VERSION = process.env.WHATSAPP_API_VERSION || "v21.0";
const DEFAULT_WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || "EAAWCYtNJ9HYBSAxZBYRFbVRJTSlWS8fdyqIfpc1kwZBPlmZAlJhxO9TzPreceBSPZC7DXpHMQLK3IRfzBajF4XILcBD8Fq1TPV1n4freZAvGlvI7W5VIULtzY4dTWdaHOWzamZC7L6Omjaf8ZC8HxsPC8XnX0uZCoQ3cVKVZCeNZBS1wJZAI3xOp4saHhzmJCvrHwZDZD"
const MIME_BY_EXTENSION = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".txt": "text/plain",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

// Supported media types Meta's WhatsApp Cloud API actually delivers as downloadable media
const SUPPORTED_MEDIA_EXTENSIONS = [
    ".pdf", ".jpg", ".jpeg", ".png", ".webp",
    ".doc", ".docx", ".pptx", ".xlsx",
    ".mp4", ".3gp", ".amr", ".aac", ".mp3", ".ogg"
];

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function sanitizeSegment(value) {
    return String(value || "archive")
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .replace(/^_+|_+$/g, "") || "archive";
}

/**
 * Check if a filename/content-type indicates an archive (zip/rar).
 * Note: Meta's WhatsApp Cloud API does NOT deliver zip/rar as downloadable
 * media at all — this is primarily for detection and user notification.
 */
function isArchiveAttachment(contentType = "", fileName = "") {
    const normalizedType = String(contentType || "").toLowerCase();
    const normalizedName = String(fileName || "").toLowerCase();

    return (
        normalizedType.includes("zip") ||
        normalizedType.includes("rar") ||
        normalizedType.includes("x-7z") ||
        normalizedName.endsWith(".zip") ||
        normalizedName.endsWith(".rar") ||
        normalizedName.endsWith(".7z")
    );
}

/**
 * Check if a filename represents an unsupported media type for WhatsApp Cloud API.
 */
function isUnsupportedMediaType(fileName = "") {
    if (!fileName) return false;
    const ext = path.extname(fileName).toLowerCase();
    if (!ext) return false;
    return !SUPPORTED_MEDIA_EXTENSIONS.includes(ext);
}

function getExtensionFromMedia(contentType = "", fileName = "") {
    const normalizedName = String(fileName || "").toLowerCase();
    const nameExt = path.extname(normalizedName);
    if (nameExt) return nameExt.replace(".", "");

    const normalizedType = String(contentType || "").toLowerCase();
    if (normalizedType.includes("pdf")) return "pdf";
    if (normalizedType.includes("jpeg") || normalizedType.includes("jpg")) return "jpg";
    if (normalizedType.includes("png")) return "png";
    if (normalizedType.includes("webp")) return "webp";
    if (normalizedType.includes("zip")) return "zip";
    if (normalizedType.includes("rar")) return "rar";

    return "bin";
}

/**
 * Looks up the WhatsApp permanent access token for a given store/tenant.
 * ASSUMES a `stores` table with a `whatsapp_access_token` column, populated
 * once that tenant completes Embedded Signup + the code->token exchange.
 * Falls back to the global env token during early development/single-WABA testing.
 * Shared by both job.worker.js and archive.worker.js so token logic lives in one place.
 */
function getTokenForStore(storeId) {
    return new Promise((resolve) => {
        db.get(
            `SELECT whatsapp_access_token FROM stores WHERE store_id = ?`,
            [storeId],
            (err, row) => {
                if (err || !row?.whatsapp_access_token) {
                    return resolve(DEFAULT_WHATSAPP_TOKEN);
                }
                resolve(row.whatsapp_access_token);
            }
        );
    });
}

/**
 * Downloads a single media item from Meta's Graph API.
 * Two-step process:
 *   1. GET /{media-id} with Bearer auth -> returns a short-lived { url, mime_type, file_size }
 *   2. GET that url with Bearer auth (not Basic auth) -> raw bytes
 * The URL expires within minutes, so it's always resolved fresh right before download.
 */
async function downloadMetaMedia(mediaId, fileNameHint, token) {
    ensureDir(UPLOADS_DIR);

    const metaRes = await axios.get(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`,
        {
            headers: { Authorization: `Bearer ${token}` },
            validateStatus: () => true
        }
    );

    if (metaRes.status < 200 || metaRes.status >= 300 || !metaRes.data?.url) {
        throw new Error(
            `Failed to resolve Meta media URL for ${mediaId} (HTTP ${metaRes.status}): ` +
            `${JSON.stringify(metaRes.data).slice(0, 300)}`
        );
    }

    const { url, mime_type: mimeType } = metaRes.data;
    const extension = getExtensionFromMedia(mimeType, fileNameHint);

    const fileRes = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: "stream",
        timeout: 30000,
        validateStatus: () => true
    });

    if (fileRes.status < 200 || fileRes.status >= 300) {
        let errBody = "";
        try {
            for await (const chunk of fileRes.data) {
                errBody += chunk.toString("utf8");
                if (errBody.length > 500) break;
            }
        } catch (_) {}
        throw new Error(
            `Meta media download failed (HTTP ${fileRes.status}) for ${mediaId}. ` +
            `Response: ${errBody.slice(0, 300)}`
        );
    }

    const safeFileName = `${mediaId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${extension}`;
    const filePath = path.join(UPLOADS_DIR, safeFileName);
    const writer = fs.createWriteStream(filePath);

    await new Promise((resolve, reject) => {
        fileRes.data.pipe(writer);
        writer.on("finish", resolve);
        writer.on("error", reject);
        fileRes.data.on("error", reject);
    });

    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
        fs.unlinkSync(filePath);
        throw new Error(`Downloaded file is empty (0 bytes): ${filePath}`);
    }

    return { filePath, mimeType };
}

/**
 * Get page count for a PDF using pdfinfo (poppler-utils).
 * Returns 1 for non-PDF or on failure.
 */
async function getPageCount(filePath, mimeType) {
    if (mimeType === "application/pdf") {
        try {
            const { stdout } = await execPromise(`pdfinfo "${filePath}"`);
            const match = stdout.match(/Pages:\s+(\d+)/);
            if (match && match[1]) {
                return parseInt(match[1], 10);
            }
        } catch (error) {
            console.warn(`pdfinfo failed for ${filePath}; defaulting to 1.`, error.message);
        }
    }

    return 1;
}

function guessMimeType(filePath) {
    return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function walkFiles(dirPath) {
    const entries = [];
    if (!fs.existsSync(dirPath)) return entries;

    const children = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const child of children) {
        const fullPath = path.join(dirPath, child.name);
        if (child.isDirectory()) {
            entries.push(...walkFiles(fullPath));
        } else {
            entries.push(fullPath);
        }
    }

    return entries;
}

function makeUniqueUploadPath(sourceName, archivePrefix) {
    ensureDir(UPLOADS_DIR);

    const baseName = path.basename(sourceName, path.extname(sourceName));
    const extension = path.extname(sourceName) || ".bin";
    const safeBaseName = sanitizeSegment(baseName);
    const safePrefix = sanitizeSegment(archivePrefix || "archive");

    return path.join(
        UPLOADS_DIR,
        `${safePrefix}_${safeBaseName}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${extension}`
    );
}

async function findSevenZipExecutable() {
    const candidates = [
        process.env.SEVEN_ZIP_PATH,
        "C:\\Program Files\\7-Zip\\7z.exe",
        "C:\\Program Files (x86)\\7-Zip\\7z.exe",
        "7z"
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (candidate === "7z") return candidate;
        if (fs.existsSync(candidate)) return candidate;
    }

    return null;
}

/**
 * Extract an archive file (ZIP or RAR) and return an array of file descriptors.
 * Kept for future use / local file upload support — Meta's Cloud API does not
 * deliver zip/rar as downloadable media, so this only fires via alternative paths.
 */
async function extractArchiveFile(archivePath, archiveFileName, extractedRootDir) {
    const resolvedArchiveName = archiveFileName || archivePath;
    const archiveExt = path.extname(resolvedArchiveName).toLowerCase() || path.extname(archivePath).toLowerCase();
    const archiveBaseName = sanitizeSegment(path.basename(resolvedArchiveName, archiveExt));
    const outputDir = path.join(extractedRootDir, archiveBaseName);
    ensureDir(outputDir);

    if (archiveExt === ".zip") {
        const quotedArchive = archivePath.replace(/'/g, "''");
        const quotedOutput = outputDir.replace(/'/g, "''");
        await execFilePromise("powershell.exe", [
            "-NoProfile",
            "-Command",
            `Expand-Archive -LiteralPath '${quotedArchive}' -DestinationPath '${quotedOutput}' -Force`
        ]);
    } else if (archiveExt === ".rar" || archiveExt === ".7z") {
        const sevenZip = await findSevenZipExecutable();
        if (!sevenZip) {
            throw new Error("RAR/7z extraction requires 7-Zip (7z.exe). Set SEVEN_ZIP_PATH or install 7-Zip.");
        }

        await execFilePromise(sevenZip, ["x", `-o${outputDir}`, "-y", archivePath]);
    } else {
        throw new Error(`Unsupported archive format: ${archiveExt || "unknown"}`);
    }

    const files = walkFiles(outputDir);
    return Promise.all(files.map(async (filePath) => {
        const uploadPath = makeUniqueUploadPath(filePath, archiveBaseName);
        fs.copyFileSync(filePath, uploadPath);
        const contentType = guessMimeType(filePath);
        return {
            localPath: uploadPath,
            fileName: path.basename(filePath),
            contentType,
            pages: await getPageCount(uploadPath, contentType)
        };
    }));
}

/**
 * Main entry point: prepare incoming files from a normalized (Twilio-shaped)
 * WhatsApp webhook payload, downloading media via Meta's Graph API.
 *
 * Returns an array of file descriptors: { localPath, fileName, contentType, pages }
 *
 * `token` is the per-tenant WhatsApp access token (from getTokenForStore),
 * required because media download URLs are scoped to the app/token that
 * owns the WABA the message arrived on.
 */
async function prepareIncomingFiles(payload, token) {
    const resolvedToken = token || DEFAULT_WHATSAPP_TOKEN;
    const messageSid = payload.MessageSid || `archive-${Date.now()}`;
    const extractedRootDir = path.join(UPLOADS_DIR, "archive-temp", sanitizeSegment(messageSid));
    ensureDir(extractedRootDir);

    const files = [];
    const mediaCount = Number(payload.NumMedia || 0);

    for (let i = 0; i < mediaCount; i++) {
        const mediaId = payload[`MediaId${i}`];
        const contentType = payload[`MediaContentType${i}`] || "";
        const fileName = payload[`MediaFilename${i}`] || `${messageSid}_${i}`;

        if (!mediaId) continue;

        try {
            const { filePath: downloadedPath, mimeType } = await downloadMetaMedia(mediaId, fileName, resolvedToken);
            const resolvedContentType = contentType || mimeType || guessMimeType(downloadedPath);

            if (isArchiveAttachment(resolvedContentType, fileName)) {
                const extractedFiles = await extractArchiveFile(downloadedPath, fileName, extractedRootDir);
                files.push(...extractedFiles);
                continue;
            }

            files.push({
                localPath: downloadedPath,
                fileName: path.basename(fileName),
                contentType: resolvedContentType,
                pages: await getPageCount(downloadedPath, resolvedContentType)
            });
        } catch (err) {
            console.error(`Failed to process media ${i} (${mediaId}) for message ${messageSid}:`, err.message);
        }
    }

    return files;
}

module.exports = {
    isArchiveAttachment,
    isUnsupportedMediaType,
    prepareIncomingFiles,
    downloadMetaMedia,
    getTokenForStore,
    getPageCount,
    UPLOADS_DIR
};