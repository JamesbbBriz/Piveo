import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { getDb, getDataDir } from "../db.mjs";

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

/**
 * Save a base64-encoded blob to disk and record it in the database.
 * @param {string} userId
 * @param {string} base64Data - Raw base64 string (no data URI prefix)
 * @param {string} contentType - MIME type (e.g. "image/png")
 * @returns {{ id: string, filePath: string, sizeBytes: number }}
 */
export function saveBlob(userId, base64Data, contentType = "image/png") {
  const db = getDb();
  const id = uuidv4();
  const ext = EXT_MAP[contentType] || ".bin";
  const userDir = path.join(getUploadsDir(), userId);
  fs.mkdirSync(userDir, { recursive: true });

  const fileName = `${id}${ext}`;
  const filePath = path.join(userDir, fileName);
  const buffer = Buffer.from(base64Data, "base64");
  fs.writeFileSync(filePath, buffer);

  const sizeBytes = buffer.length;
  const now = Date.now();

  // Store relative path from data dir for portability
  const relPath = path.relative(getDataDir(), filePath);

  db.prepare(
    `INSERT INTO blobs (id, user_id, content_type, file_path, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, userId, contentType, relPath, sizeBytes, now);

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

  db.prepare("DELETE FROM blobs WHERE id = ?").run(blobId);
  return true;
}
