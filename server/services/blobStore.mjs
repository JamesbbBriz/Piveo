import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import sharp from "sharp";
import { getDb, getDataDir } from "../db.mjs";

const THUMB_MAX_DIM = 400;
const THUMB_QUALITY = 80;

const EXT_MAP = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
};

function getUploadsDir() {
  return path.join(getDataDir(), "uploads");
}

const WEBP_QUALITY = 99;
const CONVERTIBLE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

/**
 * Save a base64-encoded blob to disk and record it in the database.
 * Raster images (PNG/JPEG/GIF/WebP) are converted to WebP q99 before saving.
 * SVG and other types are stored as-is.
 * @param {string} userId
 * @param {string} base64Data - Raw base64 string (no data URI prefix)
 * @param {string} contentType - MIME type (e.g. "image/png")
 * @returns {Promise<{ id: string, filePath: string, sizeBytes: number }>}
 */
export async function saveBlob(userId, base64Data, contentType = "image/png") {
  const db = getDb();
  const id = uuidv4();
  const userDir = path.join(getUploadsDir(), userId);
  fs.mkdirSync(userDir, { recursive: true });

  const buffer = Buffer.from(base64Data, "base64");
  let finalBuffer = buffer;
  let finalContentType = contentType;
  let finalExt = EXT_MAP[contentType] || ".bin";

  if (CONVERTIBLE_TYPES.has(contentType)) {
    finalBuffer = await sharp(buffer).webp({ quality: WEBP_QUALITY }).toBuffer();
    finalContentType = "image/webp";
    finalExt = ".webp";
  }

  const fileName = `${id}${finalExt}`;
  const filePath = path.join(userDir, fileName);
  fs.writeFileSync(filePath, finalBuffer);

  const sizeBytes = finalBuffer.length;
  const now = Date.now();

  // Store relative path from data dir for portability
  const relPath = path.relative(getDataDir(), filePath);

  db.prepare(
    `INSERT INTO blobs (id, user_id, content_type, file_path, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, userId, finalContentType, relPath, sizeBytes, now);

  return { id, filePath: relPath, sizeBytes };
}

/**
 * Get blob metadata and absolute file path for streaming.
 * @param {string} blobId
 * @returns {{ filePath: string, contentType: string } | null}
 */
export function getBlob(blobId) {
  const db = getDb();
  const row = db
    .prepare("SELECT file_path, content_type FROM blobs WHERE id = ?")
    .get(blobId);
  if (!row) return null;

  const absPath = path.resolve(getDataDir(), row.file_path);
  if (!fs.existsSync(absPath)) return null;

  return { filePath: absPath, contentType: row.content_type };
}

/**
 * Delete a blob from disk and database.
 * @param {string} blobId
 * @returns {boolean} true if deleted
 */
export function deleteBlob(blobId) {
  const db = getDb();
  const row = db
    .prepare("SELECT file_path FROM blobs WHERE id = ?")
    .get(blobId);
  if (!row) return false;

  const absPath = path.resolve(getDataDir(), row.file_path);
  if (fs.existsSync(absPath)) {
    fs.unlinkSync(absPath);
  }
  // Clean up thumbnail if exists
  const thumbPath = thumbPathFor(absPath);
  if (fs.existsSync(thumbPath)) {
    fs.unlinkSync(thumbPath);
  }

  db.prepare("DELETE FROM blobs WHERE id = ?").run(blobId);
  return true;
}

// ---------- Thumbnails ----------

function thumbPathFor(absOriginalPath) {
  const dir = path.dirname(absOriginalPath);
  const base = path.basename(absOriginalPath, path.extname(absOriginalPath));
  return path.join(dir, `${base}_thumb.webp`);
}

/**
 * Get or lazily generate a WebP thumbnail for a blob.
 * Returns { filePath, contentType } or null if blob not found.
 */
export async function getThumbnail(blobId) {
  const original = getBlob(blobId);
  if (!original) return null;

  // Only generate thumbnails for raster images
  if (!/^image\/(png|jpe?g|webp|gif)$/i.test(original.contentType)) {
    return original; // serve original for SVG etc.
  }

  const thumbFile = thumbPathFor(original.filePath);
  if (fs.existsSync(thumbFile)) {
    return { filePath: thumbFile, contentType: "image/webp" };
  }

  // Generate thumbnail
  try {
    await sharp(original.filePath)
      .resize(THUMB_MAX_DIM, THUMB_MAX_DIM, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toFile(thumbFile);
    return { filePath: thumbFile, contentType: "image/webp" };
  } catch (e) {
    console.error(`[BLOB] thumbnail generation failed for ${blobId}:`, e.message);
    return original; // fallback to original
  }
}
