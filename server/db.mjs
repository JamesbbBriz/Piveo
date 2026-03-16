import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(
  process.env.DATA_DIR || path.join(__dirname, "..", "data")
);

const CURRENT_SCHEMA_VERSION = 10;

let db = null;

/**
 * Initialize the SQLite database. Creates the data directory and all tables
 * if they don't exist. Returns the database instance.
 */
export function initDatabase() {
  if (db) return db;

  // Ensure data directory exists
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const dbPath = path.join(DATA_DIR, "topseller.db");
  db = new Database(dbPath);

  // Enable WAL mode and foreign keys
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Schema version tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  const row = db.prepare("SELECT version FROM schema_version WHERE id = 1").get();
  const currentVersion = row ? row.version : 0;

  if (currentVersion < 1) applySchemaV1(db);
  if (currentVersion < 2) applySchemaV2(db);
  if (currentVersion < 3) applySchemaV3(db);
  if (currentVersion < 4) applySchemaV4(db);
  if (currentVersion < 5) applySchemaV5(db);
  if (currentVersion < 6) applySchemaV6(db);
  if (currentVersion < 7) applySchemaV7(db);
  if (currentVersion < 8) applySchemaV8(db);
  if (currentVersion < 9) applySchemaV9(db);
  if (currentVersion < 10) applySchemaV10(db);

  if (currentVersion < CURRENT_SCHEMA_VERSION) {
    db.prepare(
      "INSERT OR REPLACE INTO schema_version (id, version, updated_at) VALUES (1, ?, ?)"
    ).run(CURRENT_SCHEMA_VERSION, Date.now());
  }

  console.log(`[DB] SQLite initialized at ${dbPath} (schema v${CURRENT_SCHEMA_VERSION})`);
  return db;
}

/**
 * Get the singleton database instance. Throws if not initialized.
 */
export function getDb() {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

/**
 * Get the data directory path.
 */
export function getDataDir() {
  return DATA_DIR;
}

function applySchemaV1(db) {
  db.exec(`
    -- Image blobs (must be created before tables that reference it)
    CREATE TABLE IF NOT EXISTS blobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content_type TEXT DEFAULT 'image/png',
      file_path TEXT NOT NULL,
      size_bytes INTEGER,
      created_at INTEGER NOT NULL
    );

    -- Users (replacing env-var single user)
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Teams
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Team members
    CREATE TABLE IF NOT EXISTS team_members (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (team_id, user_id)
    );

    -- Projects (personal + team)
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      settings_json TEXT NOT NULL DEFAULT '{}',
      chat_history_json TEXT DEFAULT '[]',
      batch_config_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Generated images
    CREATE TABLE IF NOT EXISTS generated_images (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blob_id TEXT REFERENCES blobs(id),
      prompt TEXT,
      model TEXT,
      size TEXT,
      source TEXT DEFAULT 'generate',
      parent_image_id TEXT,
      slot_id TEXT,
      slot_title TEXT,
      is_primary INTEGER DEFAULT 0,
      action TEXT,
      tags_json TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL
    );

    -- Model characters
    CREATE TABLE IF NOT EXISTS model_characters (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      blob_id TEXT REFERENCES blobs(id),
      created_at INTEGER NOT NULL
    );

    -- Products
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      blob_id TEXT REFERENCES blobs(id),
      category TEXT,
      dimensions_json TEXT,
      size TEXT,
      description TEXT,
      created_at INTEGER NOT NULL
    );

    -- Templates
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      content TEXT NOT NULL
    );

    -- User preferences
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      default_image_model TEXT,
      aspect_ratio TEXT,
      product_scale TEXT,
      batch_count INTEGER DEFAULT 1,
      updated_at INTEGER NOT NULL
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_projects_team ON projects(team_id);
    CREATE INDEX IF NOT EXISTS idx_images_project ON generated_images(project_id);
    CREATE INDEX IF NOT EXISTS idx_images_user ON generated_images(user_id);
    CREATE INDEX IF NOT EXISTS idx_blobs_user ON blobs(user_id);
    CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_models_team ON model_characters(team_id);
    CREATE INDEX IF NOT EXISTS idx_products_team ON products(team_id);
    CREATE INDEX IF NOT EXISTS idx_templates_team ON templates(team_id);
  `);
}

function applySchemaV3(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      model TEXT,
      status_code INTEGER NOT NULL,
      request_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_user_time ON usage_records(user_id, created_at);

    CREATE TABLE IF NOT EXISTS user_quotas (
      user_id TEXT PRIMARY KEY,
      monthly_limit INTEGER NOT NULL DEFAULT -1,
      daily_limit INTEGER NOT NULL DEFAULT -1,
      updated_at INTEGER NOT NULL
    );
  `);
}

function applySchemaV4(db) {
  // Only stores activation state + cached model lists. URL/API Key live in env vars.
  db.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      is_active INTEGER NOT NULL DEFAULT 0,
      models_cache TEXT,
      models_fetched_at INTEGER
    );
  `);
}

function applySchemaV5(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS default_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

function applySchemaV6(db) {
  db.exec(`
    ALTER TABLE default_templates ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0;
  `);
}

function applySchemaV7(db) {
  db.exec(`
    ALTER TABLE providers ADD COLUMN allowed_models TEXT;
  `);
}

function applySchemaV8(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS brand_kits (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '默认品牌',
      description TEXT,
      style_keywords TEXT,
      color_palette_json TEXT,
      mood_keywords TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS brand_kit_images (
      id TEXT PRIMARY KEY,
      brand_kit_id TEXT NOT NULL REFERENCES brand_kits(id) ON DELETE CASCADE,
      blob_id TEXT REFERENCES blobs(id),
      image_type TEXT NOT NULL DEFAULT 'reference',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_brand_kits_user ON brand_kits(user_id);
    CREATE INDEX IF NOT EXISTS idx_brand_kit_images_kit ON brand_kit_images(brand_kit_id);
  `);
}

function applySchemaV9(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS brand_taste_ratings (
      id TEXT PRIMARY KEY,
      brand_kit_id TEXT NOT NULL REFERENCES brand_kits(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blob_id TEXT REFERENCES blobs(id),
      image_url TEXT,
      prompt TEXT,
      model TEXT,
      rating TEXT NOT NULL CHECK (rating IN ('on-brand', 'off-brand')),
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_taste_ratings_kit ON brand_taste_ratings(brand_kit_id);

    ALTER TABLE brand_kits ADD COLUMN taste_profile_json TEXT;
  `);
}

function applySchemaV10(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT 'veo-3.1',
      status TEXT NOT NULL DEFAULT 'pending',
      prompt TEXT NOT NULL DEFAULT '',
      start_blob_id TEXT REFERENCES blobs(id),
      end_blob_id TEXT REFERENCES blobs(id),
      aspect_ratio TEXT NOT NULL DEFAULT '16:9',
      resolution TEXT NOT NULL DEFAULT '720p',
      duration_sec INTEGER NOT NULL DEFAULT 8,
      candidate_count INTEGER NOT NULL DEFAULT 1,
      error_message TEXT,
      metadata_json TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generated_videos (
      id TEXT PRIMARY KEY,
      video_job_id TEXT NOT NULL REFERENCES video_jobs(id) ON DELETE CASCADE,
      blob_id TEXT REFERENCES blobs(id),
      source_url TEXT,
      duration_sec INTEGER NOT NULL DEFAULT 8,
      mime_type TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_video_jobs_user ON video_jobs(user_id);
    CREATE INDEX IF NOT EXISTS idx_video_jobs_team ON video_jobs(team_id);
    CREATE INDEX IF NOT EXISTS idx_video_jobs_updated ON video_jobs(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_generated_videos_job ON generated_videos(video_job_id, created_at DESC);
  `);
}

function applySchemaV2(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS batch_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
      project_id TEXT,
      product_id TEXT,
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      base_prompt TEXT NOT NULL DEFAULT '',
      reference_image_url TEXT,
      product_image_url TEXT,
      model_image_url TEXT,
      slots_json TEXT NOT NULL DEFAULT '[]',
      action_logs_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived_at INTEGER,
      deleted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_batch_jobs_user ON batch_jobs(user_id);
    CREATE INDEX IF NOT EXISTS idx_batch_jobs_status ON batch_jobs(status);
  `);
}
