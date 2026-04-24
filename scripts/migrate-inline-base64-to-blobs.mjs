#!/usr/bin/env node
// One-shot migration: strip inline `data:image/...;base64,...` URLs from
// `projects.chat_history_json` and `batch_jobs.slots_json`, save the bytes to
// the blobs table, and replace the inline strings with `/api/data/blobs/<id>`.
//
// Why: messages originally stored generated images as data URLs inline in
// chat_history_json. When a session accumulated 10+ images (especially after
// matrix/batch runs), the column swelled to tens of megabytes. GET
// /api/data/projects/:id/messages could time out or the client could fail to
// parse. On failure the client used to fall back to `messages: []`, so the
// user saw "single images disappeared after refresh".
//
// New code paths always upload to the blob API at generation time, but
// existing data in the DB still carries the inline bytes. This script is
// the one-shot backfill.
//
// Usage (inside the app container):
//   DATA_DIR=./data node scripts/migrate-inline-base64-to-blobs.mjs            # dry run
//   DATA_DIR=./data node scripts/migrate-inline-base64-to-blobs.mjs --apply    # actually write
//
// Idempotent: re-running only processes rows that still contain data URLs.

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import sharp from "sharp";

const DRY_RUN = !process.argv.includes("--apply");
const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
const DB_PATH = path.join(DATA_DIR, "topseller.db");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

if (!fs.existsSync(DB_PATH)) {
  console.error(`DB not found at ${DB_PATH}. Set DATA_DIR.`);
  process.exit(1);
}

const EXT_MAP = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};
const CONVERTIBLE = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif"]);
const WEBP_QUALITY = 99;

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Insert a blob row and return `/api/data/blobs/<id>`. Mirrors saveBlob() in
// server/services/blobStore.mjs to keep storage layout identical.
async function saveBlob(userId, base64Data, contentType) {
  const id = uuidv4();
  const userDir = path.join(UPLOADS_DIR, userId);
  if (!DRY_RUN) fs.mkdirSync(userDir, { recursive: true });

  const buffer = Buffer.from(base64Data, "base64");
  let finalBuffer = buffer;
  let finalContentType = contentType;
  let finalExt = EXT_MAP[contentType] || ".bin";

  if (CONVERTIBLE.has(contentType)) {
    try {
      finalBuffer = await sharp(buffer).webp({ quality: WEBP_QUALITY }).toBuffer();
      finalContentType = "image/webp";
      finalExt = ".webp";
    } catch (e) {
      console.warn(`  [sharp] skip convert (${contentType}): ${e.message}`);
    }
  }

  const fileName = `${id}${finalExt}`;
  const filePath = path.join(userDir, fileName);
  const relPath = path.relative(DATA_DIR, filePath);

  if (!DRY_RUN) {
    fs.writeFileSync(filePath, finalBuffer);
    db.prepare(
      "INSERT INTO blobs (id, user_id, content_type, file_path, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, userId, finalContentType, relPath, finalBuffer.length, Date.now());
  }

  return { id, url: `/api/data/blobs/${id}`, bytes: finalBuffer.length };
}

// Extract all `data:image/...;base64,<payload>` occurrences from a string.
// Returns array of {match, contentType, base64Data}. Non-greedy and correctly
// handles the base64 charset [A-Za-z0-9+/=].
function extractDataUrls(jsonStr) {
  const out = [];
  const re = /data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/gi;
  let m;
  while ((m = re.exec(jsonStr)) !== null) {
    out.push({ match: m[0], contentType: m[1].toLowerCase(), base64Data: m[2] });
  }
  return out;
}

async function migrateRow({ table, idCol, jsonCol, row }) {
  const originalJson = row[jsonCol];
  if (typeof originalJson !== "string" || originalJson.length === 0) return null;

  // Quick check before expensive regex scan
  if (!originalJson.includes("data:image/")) return null;

  const urls = extractDataUrls(originalJson);
  if (urls.length === 0) return null;

  // Dedupe identical base64 strings so we only upload each unique image once
  const uniqueMap = new Map(); // base64Data → {contentType, blobUrl}
  let uploadedCount = 0;
  let failedCount = 0;

  for (const { match, contentType, base64Data } of urls) {
    if (uniqueMap.has(base64Data)) continue;
    try {
      const { url, bytes } = await saveBlob(row.user_id, base64Data, contentType);
      uniqueMap.set(base64Data, { contentType, blobUrl: url, bytes, originalMatch: match });
      uploadedCount += 1;
    } catch (e) {
      console.warn(`  [upload] ${table} ${row[idCol]} skip one image: ${e.message}`);
      failedCount += 1;
    }
  }

  if (uniqueMap.size === 0) return { skipped: true, failedCount };

  // Replace every occurrence of the inline data URL with its blob URL
  let newJson = originalJson;
  for (const [base64Data, { contentType, blobUrl }] of uniqueMap) {
    // Use a unique sentinel to avoid matching the same base64 inside JSON
    // string escapes — data URLs appear as `"data:image/...;base64,XXX..."`
    // in JSON with no special escaping, so plain replaceAll is safe.
    const needle = `data:${contentType};base64,${base64Data}`;
    // replaceAll throws if needle contains regex specials when pattern is a
    // string? Actually String.prototype.replaceAll with a string pattern is
    // a literal replacement — no regex interpretation — safe here.
    newJson = newJson.split(needle).join(blobUrl);
  }

  const shrunk = originalJson.length - newJson.length;

  if (!DRY_RUN) {
    db.prepare(`UPDATE ${table} SET ${jsonCol} = ? WHERE ${idCol} = ?`).run(newJson, row[idCol]);
  }

  return {
    uploadedCount,
    failedCount,
    uniqueImages: uniqueMap.size,
    beforeBytes: originalJson.length,
    afterBytes: newJson.length,
    shrunk,
  };
}

async function main() {
  console.log(`[migrate] mode: ${DRY_RUN ? "DRY RUN (use --apply to write)" : "APPLY"}`);
  console.log(`[migrate] DB: ${DB_PATH}`);
  console.log(`[migrate] uploads dir: ${UPLOADS_DIR}`);
  console.log("");

  const targets = [
    {
      table: "projects",
      idCol: "id",
      jsonCol: "chat_history_json",
      label: "projects.chat_history_json",
    },
    {
      table: "batch_jobs",
      idCol: "id",
      jsonCol: "slots_json",
      label: "batch_jobs.slots_json",
    },
  ];

  const totals = {
    rowsTouched: 0,
    uploaded: 0,
    failed: 0,
    uniqueImages: 0,
    beforeBytes: 0,
    afterBytes: 0,
  };

  for (const t of targets) {
    console.log(`[${t.label}] scanning...`);
    const rows = db
      .prepare(
        `SELECT ${t.idCol} AS id, user_id, ${t.jsonCol} AS ${t.jsonCol}
         FROM ${t.table}
         WHERE ${t.jsonCol} IS NOT NULL
           AND INSTR(${t.jsonCol}, 'data:image/') > 0
         ORDER BY LENGTH(${t.jsonCol}) DESC`
      )
      .all();

    console.log(`  ${rows.length} row(s) contain inline data URLs`);

    for (const row of rows) {
      const label = `${t.table}/${row.id}`;
      process.stdout.write(`  ${label} ... `);
      try {
        const result = await migrateRow({
          table: t.table,
          idCol: t.idCol,
          jsonCol: t.jsonCol,
          row,
        });
        if (!result) {
          process.stdout.write("no-op\n");
          continue;
        }
        if (result.skipped) {
          process.stdout.write(`skipped (all ${result.failedCount} upload failed)\n`);
          totals.failed += result.failedCount;
          continue;
        }
        const mbBefore = (result.beforeBytes / 1024 / 1024).toFixed(2);
        const mbAfter = (result.afterBytes / 1024 / 1024).toFixed(2);
        process.stdout.write(
          `uploaded ${result.uploadedCount} img (${result.uniqueImages} unique), ${mbBefore}MB → ${mbAfter}MB\n`
        );
        totals.rowsTouched += 1;
        totals.uploaded += result.uploadedCount;
        totals.failed += result.failedCount;
        totals.uniqueImages += result.uniqueImages;
        totals.beforeBytes += result.beforeBytes;
        totals.afterBytes += result.afterBytes;
      } catch (e) {
        process.stdout.write(`ERROR: ${e.message}\n`);
      }
    }
    console.log("");
  }

  const savedMb = ((totals.beforeBytes - totals.afterBytes) / 1024 / 1024).toFixed(1);
  console.log("========================================");
  console.log(`rows touched:   ${totals.rowsTouched}`);
  console.log(`images uploaded:${totals.uploaded}  (unique: ${totals.uniqueImages})`);
  console.log(`upload failed:  ${totals.failed}`);
  console.log(`JSON bytes before: ${totals.beforeBytes.toLocaleString()}`);
  console.log(`JSON bytes after : ${totals.afterBytes.toLocaleString()}`);
  console.log(`reclaimed:      ${savedMb} MB`);
  if (DRY_RUN) console.log("(dry run — pass --apply to write)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.close());
