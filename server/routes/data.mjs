import fs from "node:fs";
import path from "node:path";
import express from "express";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { getDb, getDataDir } from "../db.mjs";
import { requireAuth, isSuperAdmin } from "./auth.mjs";
import { saveBlob, getBlob, deleteBlob, getThumbnail } from "../services/blobStore.mjs";
import { getAllUsersUsageStats, getUserUsageStats } from "../services/usageTracker.mjs";
import * as providerStore from "../services/providerStore.mjs";

const router = express.Router();

// All data routes require authentication
router.use("/api/data", express.json({ limit: "20mb" }), requireAuth);

// ---------- Helpers ----------

function getUserId(username) {
  const db = getDb();
  const row = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  return row ? row.id : null;
}

function assertTeamAccess(userId, teamId, requiredRole) {
  const db = getDb();
  const member = db
    .prepare("SELECT role FROM team_members WHERE team_id = ? AND user_id = ?")
    .get(teamId, userId);
  if (!member) return false;
  if (requiredRole === "admin" && member.role !== "admin") return false;
  return true;
}

// ---------- Users (super admin only) ----------

router.get("/api/data/users", (req, res) => {
  if (!isSuperAdmin(req.authUser)) {
    return res.status(403).json({ ok: false, message: "无权限。" });
  }
  const users = getAllUsersUsageStats();
  res.json({ ok: true, users });
});

router.post("/api/data/users", async (req, res) => {
  if (!isSuperAdmin(req.authUser)) {
    return res.status(403).json({ ok: false, message: "无权限。" });
  }

  const { username, password, displayName } = req.body;
  if (!username || typeof username !== "string" || !/^[a-zA-Z0-9_-]{2,32}$/.test(username)) {
    return res.status(400).json({ ok: false, message: "用户名须为 2-32 位字母数字下划线或连字符。" });
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ ok: false, message: "密码至少 6 位。" });
  }

  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) {
    return res.status(409).json({ ok: false, message: "用户名已存在。" });
  }

  const hash = await bcrypt.hash(password, 10);
  const id = uuidv4();
  const now = Date.now();
  db.prepare(
    "INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, username, hash, displayName || username, now, now);

  res.json({ ok: true, user: { id, username, displayName: displayName || username } });
});

router.put("/api/data/users/:id/quota", (req, res) => {
  if (!isSuperAdmin(req.authUser)) {
    return res.status(403).json({ ok: false, message: "无权限。" });
  }

  const { monthlyLimit, dailyLimit } = req.body;
  const ml = typeof monthlyLimit === "number" ? monthlyLimit : -1;
  const dl = typeof dailyLimit === "number" ? dailyLimit : -1;

  const db = getDb();
  db.prepare(
    "INSERT OR REPLACE INTO user_quotas (user_id, monthly_limit, daily_limit, updated_at) VALUES (?, ?, ?, ?)"
  ).run(req.params.id, ml, dl, Date.now());

  res.json({ ok: true });
});

// Admin: backfill usage records for a user
router.post("/api/data/users/:id/usage-backfill", (req, res) => {
  if (!isSuperAdmin(req.authUser)) {
    return res.status(403).json({ ok: false, message: "无权限。" });
  }

  const { count, model, endpoint } = req.body;
  const n = Math.max(0, Math.min(Number(count) || 0, 10000));
  if (n === 0) return res.status(400).json({ ok: false, message: "count 必须为正整数（上限 10000）。" });

  const db = getDb();
  const user = db.prepare("SELECT id, username FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ ok: false, message: "用户不存在。" });

  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO usage_records (user_id, username, endpoint, model, status_code, request_id, created_at)
     VALUES (?, ?, ?, ?, 200, ?, ?)`
  );

  db.transaction(() => {
    for (let i = 0; i < n; i++) {
      insert.run(
        user.id,
        user.username,
        endpoint || "/v1/images/generations",
        model || null,
        `backfill-${now}-${i}`,
        now
      );
    }
  })();

  res.json({ ok: true, inserted: n });
});

router.get("/api/data/usage/me", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const stats = getUserUsageStats(userId);

  const toPercent = (used, limit) => {
    if (limit === -1) return -1;
    if (limit === 0) return 100;
    return Math.min(100, Math.round((used / limit) * 100));
  };

  res.json({
    ok: true,
    usage: {
      monthlyPercent: toPercent(stats.thisMonth, stats.monthlyLimit),
      dailyPercent: toPercent(stats.today, stats.dailyLimit),
    },
  });
});

// ---------- Blobs ----------

router.post("/api/data/blobs", async (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const { data, contentType } = req.body;
  if (!data) return res.status(400).json({ ok: false, message: "缺少 data 字段。" });

  try {
    const blob = await saveBlob(userId, data, contentType || "image/png");
    res.json({ ok: true, id: blob.id, url: `/api/data/blobs/${blob.id}` });
  } catch (e) {
    console.error("[DATA] blob save error:", e.message);
    res.status(500).json({ ok: false, message: "文件保存失败。" });
  }
});

router.get("/api/data/blobs/:id", (req, res) => {
  const blob = getBlob(req.params.id);
  if (!blob) return res.status(404).json({ ok: false, message: "文件不存在。" });

  res.setHeader("Content-Type", blob.contentType);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  fs.createReadStream(blob.filePath).pipe(res);
});

router.get("/api/data/blobs/:id/thumb", async (req, res) => {
  try {
    const thumb = await getThumbnail(req.params.id);
    if (!thumb) return res.status(404).json({ ok: false, message: "文件不存在。" });

    res.setHeader("Content-Type", thumb.contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    fs.createReadStream(thumb.filePath).pipe(res);
  } catch (e) {
    console.error("[DATA] thumbnail error:", e.message);
    res.status(500).json({ ok: false, message: "缩略图生成失败。" });
  }
});

// ---------- Teams ----------

router.get("/api/data/teams", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const db = getDb();
  const all = req.query.all === "true" && isSuperAdmin(req.authUser);

  let teams;
  if (all) {
    teams = db.prepare("SELECT t.* FROM teams t ORDER BY t.created_at DESC").all();
  } else {
    teams = db
      .prepare(
        `SELECT t.* FROM teams t
         INNER JOIN team_members tm ON t.id = tm.team_id
         WHERE tm.user_id = ?
         ORDER BY t.created_at DESC`
      )
      .all(userId);
  }

  // Attach members to each team
  const memberStmt = db.prepare(
    `SELECT u.id AS userId, u.username, u.display_name AS displayName, tm.role, tm.joined_at AS joinedAt
     FROM team_members tm
     INNER JOIN users u ON tm.user_id = u.id
     WHERE tm.team_id = ?
     ORDER BY tm.joined_at`
  );
  for (const team of teams) {
    team.members = memberStmt.all(team.id);
  }

  res.json({ ok: true, teams });
});

router.post("/api/data/teams", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const { name } = req.body;
  if (!name) return res.status(400).json({ ok: false, message: "缺少团队名称。" });

  const db = getDb();
  const id = uuidv4();
  const now = Date.now();

  const insertTeam = db.prepare(
    "INSERT INTO teams (id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  );
  const insertMember = db.prepare(
    "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'admin', ?)"
  );

  db.transaction(() => {
    insertTeam.run(id, name, userId, now, now);
    insertMember.run(id, userId, now);
  })();

  res.json({ ok: true, team: { id, name, created_by: userId, created_at: now, updated_at: now } });
});

router.put("/api/data/teams/:id", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  if (!assertTeamAccess(userId, req.params.id, "admin")) {
    return res.status(403).json({ ok: false, message: "无权限操作此团队。" });
  }

  const { name } = req.body;
  if (!name) return res.status(400).json({ ok: false, message: "缺少团队名称。" });

  const db = getDb();
  db.prepare("UPDATE teams SET name = ?, updated_at = ? WHERE id = ?").run(name, Date.now(), req.params.id);
  res.json({ ok: true });
});

router.delete("/api/data/teams/:id", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  if (!isSuperAdmin(req.authUser) && !assertTeamAccess(userId, req.params.id, "admin")) {
    return res.status(403).json({ ok: false, message: "无权限操作此团队。" });
  }

  const db = getDb();
  db.prepare("DELETE FROM teams WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- Team Members ----------

router.get("/api/data/teams/:id/members", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  if (!isSuperAdmin(req.authUser) && !assertTeamAccess(userId, req.params.id)) {
    return res.status(403).json({ ok: false, message: "无权限查看此团队。" });
  }

  const db = getDb();
  const members = db
    .prepare(
      `SELECT u.id AS userId, u.username, u.display_name AS displayName, tm.role, tm.joined_at AS joinedAt
       FROM team_members tm
       INNER JOIN users u ON tm.user_id = u.id
       WHERE tm.team_id = ?
       ORDER BY tm.joined_at`
    )
    .all(req.params.id);
  res.json({ ok: true, members });
});

router.post("/api/data/teams/:id/members", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  if (!isSuperAdmin(req.authUser) && !assertTeamAccess(userId, req.params.id, "admin")) {
    return res.status(403).json({ ok: false, message: "仅管理员可添加成员。" });
  }

  const { username, role } = req.body;
  if (!username) return res.status(400).json({ ok: false, message: "缺少用户名。" });

  const db = getDb();
  const targetUser = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (!targetUser) return res.status(404).json({ ok: false, message: "用户不存在。" });

  const existing = db
    .prepare("SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?")
    .get(req.params.id, targetUser.id);
  if (existing) return res.status(409).json({ ok: false, message: "用户已是团队成员。" });

  db.prepare(
    "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)"
  ).run(req.params.id, targetUser.id, role || "member", Date.now());

  res.json({ ok: true });
});

router.delete("/api/data/teams/:id/members/:uid", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const targetUid = req.params.uid;
  // Allow self-removal, admin removal, or super admin
  const isSelf = targetUid === userId;
  if (!isSelf && !isSuperAdmin(req.authUser) && !assertTeamAccess(userId, req.params.id, "admin")) {
    return res.status(403).json({ ok: false, message: "无权限操作。" });
  }

  const db = getDb();
  db.prepare("DELETE FROM team_members WHERE team_id = ? AND user_id = ?").run(
    req.params.id,
    targetUid
  );
  res.json({ ok: true });
});

// ---------- Projects ----------

router.get("/api/data/projects", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const db = getDb();
  const teamId = req.query.team_id;
  const all = req.query.all === "true" && isSuperAdmin(req.authUser);

  let projects;
  if (all) {
    projects = db
      .prepare(
        `SELECT p.*, u.username AS owner_username
         FROM projects p
         LEFT JOIN users u ON p.user_id = u.id
         ORDER BY p.updated_at DESC`
      )
      .all();
  } else if (teamId) {
    if (!assertTeamAccess(userId, teamId)) {
      return res.status(403).json({ ok: false, message: "无权限查看此团队项目。" });
    }
    projects = db
      .prepare("SELECT * FROM projects WHERE team_id = ? ORDER BY updated_at DESC")
      .all(teamId);
  } else {
    // Personal projects + all team projects where user is member
    projects = db
      .prepare(
        `SELECT p.* FROM projects p
         WHERE p.user_id = ?
            OR p.team_id IN (SELECT team_id FROM team_members WHERE user_id = ?)
         ORDER BY p.updated_at DESC`
      )
      .all(userId, userId);
  }
  res.json({ ok: true, projects });
});

router.get("/api/data/projects/:id", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const db = getDb();
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
  if (!project) return res.status(404).json({ ok: false, message: "项目不存在。" });

  // Access check: owner or team member
  if (project.user_id !== userId) {
    if (!project.team_id || !assertTeamAccess(userId, project.team_id)) {
      return res.status(403).json({ ok: false, message: "无权限查看此项目。" });
    }
  }

  const images = db
    .prepare("SELECT * FROM generated_images WHERE project_id = ? ORDER BY created_at DESC")
    .all(req.params.id);

  res.json({ ok: true, project, images });
});

router.put("/api/data/projects/:id", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const { title, settings_json, chat_history_json, batch_config_json, team_id } = req.body;
  const now = Date.now();
  const db = getDb();

  // Check if project exists
  const existing = db.prepare("SELECT user_id, team_id, created_at FROM projects WHERE id = ?").get(req.params.id);

  if (existing) {
    // Update: check access
    if (existing.user_id !== userId) {
      if (!existing.team_id || !assertTeamAccess(userId, existing.team_id)) {
        return res.status(403).json({ ok: false, message: "无权限修改此项目。" });
      }
    }
    db.prepare(
      `UPDATE projects SET title = ?, settings_json = ?, chat_history_json = ?,
       batch_config_json = ?, team_id = ?, updated_at = ? WHERE id = ?`
    ).run(
      title ?? "",
      settings_json ?? "{}",
      chat_history_json ?? "[]",
      batch_config_json ?? null,
      team_id ?? null,
      now,
      req.params.id
    );
  } else {
    // Insert new project
    if (team_id && !assertTeamAccess(userId, team_id)) {
      return res.status(403).json({ ok: false, message: "无权限在此团队创建项目。" });
    }
    db.prepare(
      `INSERT INTO projects (id, user_id, team_id, title, settings_json, chat_history_json, batch_config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.params.id,
      userId,
      team_id ?? null,
      title ?? "",
      settings_json ?? "{}",
      chat_history_json ?? "[]",
      batch_config_json ?? null,
      now,
      now
    );
  }

  res.json({ ok: true });
});

router.delete("/api/data/projects/:id", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const db = getDb();
  const project = db.prepare("SELECT user_id, team_id FROM projects WHERE id = ?").get(req.params.id);
  if (!project) return res.status(404).json({ ok: false, message: "项目不存在。" });

  if (project.user_id !== userId && !isSuperAdmin(req.authUser)) {
    if (!project.team_id || !assertTeamAccess(userId, project.team_id, "admin")) {
      return res.status(403).json({ ok: false, message: "无权限删除此项目。" });
    }
  }

  db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- Model Characters ----------

router.get("/api/data/models", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const db = getDb();
  const teamId = req.query.team_id;

  let models;
  if (teamId) {
    if (!assertTeamAccess(userId, teamId)) {
      return res.status(403).json({ ok: false, message: "无权限查看。" });
    }
    models = db.prepare("SELECT * FROM model_characters WHERE team_id = ? ORDER BY created_at DESC").all(teamId);
  } else {
    models = db
      .prepare(
        `SELECT * FROM model_characters
         WHERE user_id = ?
            OR team_id IN (SELECT team_id FROM team_members WHERE user_id = ?)
         ORDER BY created_at DESC`
      )
      .all(userId, userId);
  }
  res.json({ ok: true, models });
});

router.put("/api/data/models/:id", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const { name, blob_id, team_id } = req.body;
  if (!name) return res.status(400).json({ ok: false, message: "缺少名称。" });

  const db = getDb();
  const existing = db.prepare("SELECT user_id, team_id FROM model_characters WHERE id = ?").get(req.params.id);

  if (existing) {
    if (existing.user_id !== userId) {
      if (!existing.team_id || !assertTeamAccess(userId, existing.team_id, "admin")) {
        return res.status(403).json({ ok: false, message: "无权限修改。" });
      }
    }
    db.prepare("UPDATE model_characters SET name = ?, blob_id = ?, team_id = ? WHERE id = ?").run(
      name, blob_id ?? null, team_id ?? null, req.params.id
    );
  } else {
    if (team_id && !assertTeamAccess(userId, team_id)) {
      return res.status(403).json({ ok: false, message: "无权限。" });
    }
    db.prepare(
      "INSERT INTO model_characters (id, user_id, team_id, name, blob_id, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(req.params.id, userId, team_id ?? null, name, blob_id ?? null, Date.now());
  }
  res.json({ ok: true });
});

router.delete("/api/data/models/:id", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const db = getDb();
  const model = db.prepare("SELECT user_id, team_id FROM model_characters WHERE id = ?").get(req.params.id);
  if (!model) return res.status(404).json({ ok: false, message: "模特不存在。" });

  if (model.user_id !== userId) {
    if (!model.team_id || !assertTeamAccess(userId, model.team_id, "admin")) {
      return res.status(403).json({ ok: false, message: "无权限删除。" });
    }
  }

  db.prepare("DELETE FROM model_characters WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- Products ----------

router.get("/api/data/products", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const db = getDb();
  const teamId = req.query.team_id;

  let products;
  if (teamId) {
    if (!assertTeamAccess(userId, teamId)) {
      return res.status(403).json({ ok: false, message: "无权限查看。" });
    }
    products = db.prepare("SELECT * FROM products WHERE team_id = ? ORDER BY created_at DESC").all(teamId);
  } else {
    products = db
      .prepare(
        `SELECT * FROM products
         WHERE user_id = ?
            OR team_id IN (SELECT team_id FROM team_members WHERE user_id = ?)
         ORDER BY created_at DESC`
      )
      .all(userId, userId);
  }
  res.json({ ok: true, products });
});

router.put("/api/data/products/:id", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const { name, blob_id, team_id, category, dimensions_json, size, description } = req.body;
  if (!name) return res.status(400).json({ ok: false, message: "缺少名称。" });

  const db = getDb();
  const existing = db.prepare("SELECT user_id, team_id FROM products WHERE id = ?").get(req.params.id);

  if (existing) {
    if (existing.user_id !== userId) {
      if (!existing.team_id || !assertTeamAccess(userId, existing.team_id, "admin")) {
        return res.status(403).json({ ok: false, message: "无权限修改。" });
      }
    }
    db.prepare(
      `UPDATE products SET name = ?, blob_id = ?, team_id = ?, category = ?,
       dimensions_json = ?, size = ?, description = ? WHERE id = ?`
    ).run(name, blob_id ?? null, team_id ?? null, category ?? null, dimensions_json ?? null, size ?? null, description ?? null, req.params.id);
  } else {
    if (team_id && !assertTeamAccess(userId, team_id)) {
      return res.status(403).json({ ok: false, message: "无权限。" });
    }
    db.prepare(
      `INSERT INTO products (id, user_id, team_id, name, blob_id, category, dimensions_json, size, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(req.params.id, userId, team_id ?? null, name, blob_id ?? null, category ?? null, dimensions_json ?? null, size ?? null, description ?? null, Date.now());
  }
  res.json({ ok: true });
});

router.delete("/api/data/products/:id", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const db = getDb();
  const product = db.prepare("SELECT user_id, team_id FROM products WHERE id = ?").get(req.params.id);
  if (!product) return res.status(404).json({ ok: false, message: "产品不存在。" });

  if (product.user_id !== userId) {
    if (!product.team_id || !assertTeamAccess(userId, product.team_id, "admin")) {
      return res.status(403).json({ ok: false, message: "无权限删除。" });
    }
  }

  db.prepare("DELETE FROM products WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- Brand Kits ----------

router.get("/api/data/brand-kits", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const db = getDb();
  const kits = db
    .prepare(
      `SELECT * FROM brand_kits
       WHERE user_id = ?
          OR team_id IN (SELECT team_id FROM team_members WHERE user_id = ?)
       ORDER BY updated_at DESC`
    )
    .all(userId, userId);

  const imgStmt = db.prepare(
    `SELECT bki.*, b.id AS _blob_id FROM brand_kit_images bki
     LEFT JOIN blobs b ON bki.blob_id = b.id
     WHERE bki.brand_kit_id = ?
     ORDER BY bki.sort_order ASC`
  );
  for (const kit of kits) {
    kit.images = imgStmt.all(kit.id);
  }

  res.json({ ok: true, brandKits: kits });
});

router.get("/api/data/brand-kits/:id", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const db = getDb();
  const kit = db.prepare("SELECT * FROM brand_kits WHERE id = ?").get(req.params.id);
  if (!kit) return res.status(404).json({ ok: false, message: "品牌套件不存在。" });

  if (kit.user_id !== userId) {
    if (!kit.team_id || !assertTeamAccess(userId, kit.team_id)) {
      return res.status(403).json({ ok: false, message: "无权限查看。" });
    }
  }

  kit.images = db
    .prepare("SELECT * FROM brand_kit_images WHERE brand_kit_id = ? ORDER BY sort_order ASC")
    .all(kit.id);

  res.json({ ok: true, brandKit: kit });
});

router.put("/api/data/brand-kits/:id", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const { name, description, style_keywords, color_palette_json, mood_keywords, is_active, team_id } = req.body;
  const now = Date.now();
  const db = getDb();

  const existing = db.prepare("SELECT user_id, team_id FROM brand_kits WHERE id = ?").get(req.params.id);

  if (existing) {
    if (existing.user_id !== userId) {
      if (!existing.team_id || !assertTeamAccess(userId, existing.team_id)) {
        return res.status(403).json({ ok: false, message: "无权限修改。" });
      }
    }
    db.prepare(
      `UPDATE brand_kits SET name = ?, description = ?, style_keywords = ?,
       color_palette_json = ?, mood_keywords = ?, is_active = ?, team_id = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      name ?? "默认品牌", description ?? null, style_keywords ?? null,
      color_palette_json ?? null, mood_keywords ?? null,
      typeof is_active === "number" ? is_active : 0,
      team_id ?? null, now, req.params.id
    );
  } else {
    if (team_id && !assertTeamAccess(userId, team_id)) {
      return res.status(403).json({ ok: false, message: "无权限。" });
    }
    db.prepare(
      `INSERT INTO brand_kits (id, user_id, team_id, name, description, style_keywords,
       color_palette_json, mood_keywords, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.params.id, userId, team_id ?? null,
      name ?? "默认品牌", description ?? null, style_keywords ?? null,
      color_palette_json ?? null, mood_keywords ?? null,
      typeof is_active === "number" ? is_active : 0,
      now, now
    );
  }

  res.json({ ok: true });
});

router.delete("/api/data/brand-kits/:id", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const db = getDb();
  const kit = db.prepare("SELECT user_id, team_id FROM brand_kits WHERE id = ?").get(req.params.id);
  if (!kit) return res.status(404).json({ ok: false, message: "品牌套件不存在。" });

  if (kit.user_id !== userId) {
    if (!kit.team_id || !assertTeamAccess(userId, kit.team_id, "admin")) {
      return res.status(403).json({ ok: false, message: "无权限删除。" });
    }
  }

  db.prepare("DELETE FROM brand_kits WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.post("/api/data/brand-kits/:id/activate", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const db = getDb();
  const kit = db.prepare("SELECT user_id, team_id FROM brand_kits WHERE id = ?").get(req.params.id);
  if (!kit) return res.status(404).json({ ok: false, message: "品牌套件不存在。" });

  if (kit.user_id !== userId) {
    if (!kit.team_id || !assertTeamAccess(userId, kit.team_id)) {
      return res.status(403).json({ ok: false, message: "无权限。" });
    }
  }

  db.transaction(() => {
    db.prepare("UPDATE brand_kits SET is_active = 0 WHERE user_id = ?").run(userId);
    db.prepare("UPDATE brand_kits SET is_active = 1, updated_at = ? WHERE id = ?").run(Date.now(), req.params.id);
  })();

  res.json({ ok: true });
});

router.put("/api/data/brand-kits/:id/images", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const db = getDb();
  const kit = db.prepare("SELECT user_id, team_id FROM brand_kits WHERE id = ?").get(req.params.id);
  if (!kit) return res.status(404).json({ ok: false, message: "品牌套件不存在。" });

  if (kit.user_id !== userId) {
    if (!kit.team_id || !assertTeamAccess(userId, kit.team_id)) {
      return res.status(403).json({ ok: false, message: "无权限。" });
    }
  }

  const { images } = req.body;
  if (!Array.isArray(images)) {
    return res.status(400).json({ ok: false, message: "images 必须为数组。" });
  }

  const now = Date.now();
  db.transaction(() => {
    db.prepare("DELETE FROM brand_kit_images WHERE brand_kit_id = ?").run(req.params.id);
    const insert = db.prepare(
      "INSERT INTO brand_kit_images (id, brand_kit_id, blob_id, image_type, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    for (const img of images) {
      insert.run(img.id || uuidv4(), req.params.id, img.blob_id ?? null, img.image_type ?? "reference", img.sort_order ?? 0, now);
    }
    db.prepare("UPDATE brand_kits SET updated_at = ? WHERE id = ?").run(now, req.params.id);
  })();

  res.json({ ok: true });
});

// ---------- Brand Taste Ratings ----------

router.get("/api/data/brand-kits/:id/ratings", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const db = getDb();
  const kit = db.prepare("SELECT user_id, team_id FROM brand_kits WHERE id = ?").get(req.params.id);
  if (!kit) return res.status(404).json({ ok: false, message: "品牌套件不存在。" });

  if (kit.user_id !== userId) {
    if (!kit.team_id || !assertTeamAccess(userId, kit.team_id)) {
      return res.status(403).json({ ok: false, message: "无权限查看。" });
    }
  }

  const ratings = db
    .prepare("SELECT * FROM brand_taste_ratings WHERE brand_kit_id = ? ORDER BY created_at DESC")
    .all(req.params.id);

  res.json({ ok: true, ratings });
});

router.put("/api/data/brand-kits/:id/ratings/:ratingId", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const db = getDb();
  const kit = db.prepare("SELECT user_id, team_id FROM brand_kits WHERE id = ?").get(req.params.id);
  if (!kit) return res.status(404).json({ ok: false, message: "品牌套件不存在。" });

  if (kit.user_id !== userId) {
    if (!kit.team_id || !assertTeamAccess(userId, kit.team_id)) {
      return res.status(403).json({ ok: false, message: "无权限。" });
    }
  }

  const { blob_id, image_url, prompt, model, rating } = req.body;
  if (!rating || !["on-brand", "off-brand"].includes(rating)) {
    return res.status(400).json({ ok: false, message: "rating 必须为 on-brand 或 off-brand。" });
  }

  const existing = db.prepare("SELECT id FROM brand_taste_ratings WHERE id = ?").get(req.params.ratingId);
  const now = Date.now();

  if (existing) {
    db.prepare(
      "UPDATE brand_taste_ratings SET blob_id = ?, image_url = ?, prompt = ?, model = ?, rating = ? WHERE id = ?"
    ).run(blob_id ?? null, image_url ?? null, prompt ?? null, model ?? null, rating, req.params.ratingId);
  } else {
    db.prepare(
      `INSERT INTO brand_taste_ratings (id, brand_kit_id, user_id, blob_id, image_url, prompt, model, rating, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(req.params.ratingId, req.params.id, userId, blob_id ?? null, image_url ?? null, prompt ?? null, model ?? null, rating, now);
  }

  res.json({ ok: true });
});

router.delete("/api/data/brand-kits/:id/ratings/:ratingId", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const db = getDb();
  const kit = db.prepare("SELECT user_id, team_id FROM brand_kits WHERE id = ?").get(req.params.id);
  if (!kit) return res.status(404).json({ ok: false, message: "品牌套件不存在。" });

  if (kit.user_id !== userId) {
    if (!kit.team_id || !assertTeamAccess(userId, kit.team_id)) {
      return res.status(403).json({ ok: false, message: "无权限。" });
    }
  }

  db.prepare("DELETE FROM brand_taste_ratings WHERE id = ? AND brand_kit_id = ?").run(req.params.ratingId, req.params.id);
  res.json({ ok: true });
});

router.put("/api/data/brand-kits/:id/taste-profile", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const db = getDb();
  const kit = db.prepare("SELECT user_id, team_id FROM brand_kits WHERE id = ?").get(req.params.id);
  if (!kit) return res.status(404).json({ ok: false, message: "品牌套件不存在。" });

  if (kit.user_id !== userId) {
    if (!kit.team_id || !assertTeamAccess(userId, kit.team_id)) {
      return res.status(403).json({ ok: false, message: "无权限。" });
    }
  }

  const { taste_profile_json } = req.body;
  const now = Date.now();

  db.prepare("UPDATE brand_kits SET taste_profile_json = ?, updated_at = ? WHERE id = ?")
    .run(taste_profile_json ?? null, now, req.params.id);

  res.json({ ok: true });
});

// ---------- Batch Jobs ----------

router.get("/api/data/batch-jobs", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const db = getDb();
  const batchJobs = db
    .prepare(
      `SELECT * FROM batch_jobs
       WHERE (user_id = ? OR team_id IN (SELECT team_id FROM team_members WHERE user_id = ?))
         AND (status != 'deleted' OR status IS NULL)
       ORDER BY updated_at DESC`
    )
    .all(userId, userId);
  res.json({ ok: true, batchJobs });
});

router.get("/api/data/batch-jobs/:id", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const db = getDb();
  const job = db.prepare("SELECT * FROM batch_jobs WHERE id = ?").get(req.params.id);
  if (!job) return res.status(404).json({ ok: false, message: "矩阵任务不存在。" });

  if (job.user_id !== userId) {
    if (!job.team_id || !assertTeamAccess(userId, job.team_id)) {
      return res.status(403).json({ ok: false, message: "无权限查看此矩阵任务。" });
    }
  }

  res.json({ ok: true, batchJob: job });
});

router.put("/api/data/batch-jobs/:id", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const {
    title, project_id, product_id, status, base_prompt,
    reference_image_url, product_image_url, model_image_url,
    slots_json, action_logs_json, tags_json, team_id,
    archived_at, deleted_at,
  } = req.body;
  const now = Date.now();
  const db = getDb();

  const existing = db.prepare("SELECT user_id, team_id, created_at FROM batch_jobs WHERE id = ?").get(req.params.id);

  if (existing) {
    if (existing.user_id !== userId) {
      if (!existing.team_id || !assertTeamAccess(userId, existing.team_id)) {
        return res.status(403).json({ ok: false, message: "无权限修改此矩阵任务。" });
      }
    }
    db.prepare(
      `UPDATE batch_jobs SET title = ?, project_id = ?, product_id = ?, status = ?,
       base_prompt = ?, reference_image_url = ?, product_image_url = ?, model_image_url = ?,
       slots_json = ?, action_logs_json = ?, tags_json = ?, team_id = ?,
       archived_at = ?, deleted_at = ?, updated_at = ? WHERE id = ?`
    ).run(
      title ?? "", project_id ?? null, product_id ?? null, status ?? "draft",
      base_prompt ?? "", reference_image_url ?? null, product_image_url ?? null, model_image_url ?? null,
      slots_json ?? "[]", action_logs_json ?? "[]", tags_json ?? "[]", team_id ?? null,
      archived_at ?? null, deleted_at ?? null, now, req.params.id
    );
  } else {
    if (team_id && !assertTeamAccess(userId, team_id)) {
      return res.status(403).json({ ok: false, message: "无权限在此团队创建矩阵任务。" });
    }
    db.prepare(
      `INSERT INTO batch_jobs (id, user_id, team_id, project_id, product_id, title, status,
       base_prompt, reference_image_url, product_image_url, model_image_url,
       slots_json, action_logs_json, tags_json, created_at, updated_at, archived_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.params.id, userId, team_id ?? null, project_id ?? null, product_id ?? null,
      title ?? "", status ?? "draft", base_prompt ?? "",
      reference_image_url ?? null, product_image_url ?? null, model_image_url ?? null,
      slots_json ?? "[]", action_logs_json ?? "[]", tags_json ?? "[]",
      now, now, archived_at ?? null, deleted_at ?? null
    );
  }

  res.json({ ok: true });
});

router.delete("/api/data/batch-jobs/:id", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const db = getDb();
  const job = db.prepare("SELECT user_id, team_id FROM batch_jobs WHERE id = ?").get(req.params.id);
  if (!job) return res.status(404).json({ ok: false, message: "矩阵任务不存在。" });

  if (job.user_id !== userId) {
    if (!job.team_id || !assertTeamAccess(userId, job.team_id, "admin")) {
      return res.status(403).json({ ok: false, message: "无权限删除此矩阵任务。" });
    }
  }

  db.prepare("DELETE FROM batch_jobs WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- Templates ----------

router.get("/api/data/templates", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const db = getDb();
  const teamId = req.query.team_id;

  let templates;
  if (teamId) {
    if (!assertTeamAccess(userId, teamId)) {
      return res.status(403).json({ ok: false, message: "无权限查看。" });
    }
    templates = db.prepare("SELECT * FROM templates WHERE team_id = ?").all(teamId);
  } else {
    templates = db
      .prepare(
        `SELECT * FROM templates
         WHERE user_id = ?
            OR team_id IN (SELECT team_id FROM team_members WHERE user_id = ?)
         ORDER BY name`
      )
      .all(userId, userId);
  }
  res.json({ ok: true, templates });
});

router.put("/api/data/templates", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const { templates, team_id } = req.body;
  if (!Array.isArray(templates)) {
    return res.status(400).json({ ok: false, message: "templates 必须为数组。" });
  }

  const db = getDb();

  if (team_id) {
    if (!assertTeamAccess(userId, team_id, "admin")) {
      return res.status(403).json({ ok: false, message: "无权限。" });
    }
  }

  const deleteStmt = team_id
    ? db.prepare("DELETE FROM templates WHERE team_id = ?")
    : db.prepare("DELETE FROM templates WHERE user_id = ? AND team_id IS NULL");

  const insertStmt = db.prepare(
    "INSERT INTO templates (id, user_id, team_id, name, content) VALUES (?, ?, ?, ?, ?)"
  );

  db.transaction(() => {
    if (team_id) {
      deleteStmt.run(team_id);
    } else {
      deleteStmt.run(userId);
    }
    for (const t of templates) {
      insertStmt.run(t.id || uuidv4(), userId, team_id ?? null, t.name || "", t.content || "");
    }
  })();

  res.json({ ok: true });
});

// ---------- Preferences ----------

router.get("/api/data/preferences", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const db = getDb();
  const prefs = db.prepare("SELECT * FROM user_preferences WHERE user_id = ?").get(userId);
  res.json({ ok: true, preferences: prefs || null });
});

router.put("/api/data/preferences", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const { default_image_model, aspect_ratio, product_scale, batch_count } = req.body;
  const db = getDb();

  db.prepare(
    `INSERT OR REPLACE INTO user_preferences (user_id, default_image_model, aspect_ratio, product_scale, batch_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, default_image_model ?? null, aspect_ratio ?? null, product_scale ?? null, batch_count ?? 1, Date.now());

  res.json({ ok: true });
});

// ---------- Providers (super admin only) ----------
// Config (URL, API key) lives in env vars — DB only stores activation state + model cache.

const maskApiKey = (key) => {
  if (!key || key.length <= 8) return "****";
  return "****" + key.slice(-4);
};

// Must be registered before /api/data/providers/:id routes to avoid "allowed-models" matching as :id
router.get("/api/data/providers/allowed-models", (req, res) => {
  const models = providerStore.getAllAllowedModels();
  res.json({ ok: true, models });
});

router.get("/api/data/providers", (req, res) => {
  if (!isSuperAdmin(req.authUser)) {
    return res.status(403).json({ ok: false, message: "无权限。" });
  }
  const providers = providerStore.getAll().map((p) => ({
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    apiKey: maskApiKey(p.apiKey),
    isActive: p.isActive,
    modelsCache: p.modelsCache,
    modelsFetchedAt: p.modelsFetchedAt,
    allowedModels: p.allowedModels,
  }));
  res.json({ ok: true, providers });
});

router.post("/api/data/providers/:id/activate", (req, res) => {
  if (!isSuperAdmin(req.authUser)) {
    return res.status(403).json({ ok: false, message: "无权限。" });
  }
  try {
    providerStore.activate(req.params.id);
    console.info(`[DATA] Super admin ${req.authUser} activated provider ${req.params.id}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, message: e.message });
  }
});

router.post("/api/data/providers/:id/models", async (req, res) => {
  if (!isSuperAdmin(req.authUser)) {
    return res.status(403).json({ ok: false, message: "无权限。" });
  }
  try {
    const models = await providerStore.fetchModelsFromUpstream(req.params.id);
    res.json({ ok: true, models });
  } catch (e) {
    res.status(502).json({ ok: false, message: e.message });
  }
});

router.put("/api/data/providers/:id/allowed-models", (req, res) => {
  if (!isSuperAdmin(req.authUser)) {
    return res.status(403).json({ ok: false, message: "无权限。" });
  }
  const { models } = req.body || {};
  if (!Array.isArray(models)) {
    return res.status(400).json({ ok: false, message: "models 必须为数组。" });
  }
  try {
    providerStore.updateAllowedModels(req.params.id, models);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, message: e.message });
  }
});

// ---------- Default Templates (admin-managed system defaults) ----------

router.get("/api/data/default-templates", (req, res) => {
  const db = getDb();
  const templates = db
    .prepare("SELECT id, name, content, sort_order, is_featured FROM default_templates ORDER BY sort_order ASC, created_at ASC")
    .all();
  res.json({ ok: true, templates });
});

router.get("/api/data/admin/default-templates", (req, res) => {
  if (!isSuperAdmin(req.authUser)) {
    return res.status(403).json({ ok: false, message: "无权限。" });
  }
  const db = getDb();
  const templates = db
    .prepare("SELECT * FROM default_templates ORDER BY sort_order ASC, created_at ASC")
    .all();
  res.json({ ok: true, templates });
});

router.put("/api/data/admin/default-templates", (req, res) => {
  if (!isSuperAdmin(req.authUser)) {
    return res.status(403).json({ ok: false, message: "无权限。" });
  }

  const { templates } = req.body;
  if (!Array.isArray(templates)) {
    return res.status(400).json({ ok: false, message: "templates 必须为数组。" });
  }

  const db = getDb();
  const now = Date.now();

  db.transaction(() => {
    db.prepare("DELETE FROM default_templates").run();
    const insert = db.prepare(
      "INSERT INTO default_templates (id, name, content, sort_order, is_featured, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    for (let i = 0; i < templates.length; i++) {
      const t = templates[i];
      insert.run(
        t.id || uuidv4(),
        t.name || "",
        t.content || "",
        typeof t.sort_order === "number" ? t.sort_order : i,
        t.is_featured ? 1 : 0,
        t.created_at || now,
        now
      );
    }
  })();

  res.json({ ok: true });
});

router.post("/api/data/admin/default-templates", (req, res) => {
  if (!isSuperAdmin(req.authUser)) {
    return res.status(403).json({ ok: false, message: "无权限。" });
  }

  const { name, content, sort_order, is_featured } = req.body;
  if (!name) return res.status(400).json({ ok: false, message: "缺少模板名称。" });

  const db = getDb();
  const id = uuidv4();
  const now = Date.now();

  // Default sort_order to max + 1
  const maxOrder = db.prepare("SELECT MAX(sort_order) as m FROM default_templates").get().m ?? -1;
  const featured = is_featured ? 1 : 0;

  db.prepare(
    "INSERT INTO default_templates (id, name, content, sort_order, is_featured, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, name, content || "", typeof sort_order === "number" ? sort_order : maxOrder + 1, featured, now, now);

  res.json({ ok: true, template: { id, name, content: content || "", sort_order: typeof sort_order === "number" ? sort_order : maxOrder + 1, is_featured: featured, created_at: now, updated_at: now } });
});

router.delete("/api/data/admin/default-templates/:id", (req, res) => {
  if (!isSuperAdmin(req.authUser)) {
    return res.status(403).json({ ok: false, message: "无权限。" });
  }

  const db = getDb();
  const existing = db.prepare("SELECT id FROM default_templates WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ ok: false, message: "模板不存在。" });

  db.prepare("DELETE FROM default_templates WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- Admin: batch thumbnail generation ----------

router.post("/api/data/admin/generate-thumbnails", async (req, res) => {
  if (!isSuperAdmin(req.authUser)) {
    return res.status(403).json({ ok: false, message: "无权限。" });
  }

  const db = getDb();
  const blobs = db
    .prepare("SELECT id, file_path, content_type FROM blobs")
    .all();

  let generated = 0;
  let existed = 0;
  let missing = 0;
  let skipped = 0;
  let failed = 0;

  for (const blob of blobs) {
    // Skip non-raster images
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(blob.content_type)) {
      skipped++;
      continue;
    }

    const absPath = path.resolve(getDataDir(), blob.file_path);
    if (!fs.existsSync(absPath)) {
      missing++;
      continue;
    }

    // Check if thumbnail already exists
    const base = path.basename(absPath, path.extname(absPath));
    const thumbPath = path.join(path.dirname(absPath), `${base}_thumb.webp`);
    if (fs.existsSync(thumbPath)) {
      existed++;
      continue;
    }

    try {
      await getThumbnail(blob.id);
      generated++;
    } catch {
      failed++;
    }
  }

  console.info(
    `[ADMIN] Thumbnail batch: ${generated} new, ${existed} existed, ${missing} missing, ${skipped} skipped, ${failed} failed (total ${blobs.length})`
  );
  res.json({ ok: true, total: blobs.length, generated, existed, missing, skipped, failed });
});

// ---------- Sync ----------

router.get("/api/data/sync", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const db = getDb();

  const projectsTs = db
    .prepare(
      `SELECT MAX(updated_at) as ts FROM projects
       WHERE user_id = ? OR team_id IN (SELECT team_id FROM team_members WHERE user_id = ?)`
    )
    .get(userId, userId);

  const modelsTs = db
    .prepare(
      `SELECT MAX(created_at) as ts FROM model_characters
       WHERE user_id = ? OR team_id IN (SELECT team_id FROM team_members WHERE user_id = ?)`
    )
    .get(userId, userId);

  const productsTs = db
    .prepare(
      `SELECT MAX(created_at) as ts FROM products
       WHERE user_id = ? OR team_id IN (SELECT team_id FROM team_members WHERE user_id = ?)`
    )
    .get(userId, userId);

  // Templates don't have timestamps, use 0
  res.json({
    ok: true,
    projects: projectsTs?.ts || 0,
    models: modelsTs?.ts || 0,
    products: productsTs?.ts || 0,
    templates: 0,
  });
});

router.post("/api/data/sync/pull", (req, res) => {
  const userId = getUserId(req.authUser);
  if (!userId) return res.status(401).json({ ok: false, message: "用户不存在。" });

  const since = Number(req.body.since || 0);
  const db = getDb();

  const projects = db
    .prepare(
      `SELECT * FROM projects
       WHERE updated_at > ?
         AND (user_id = ? OR team_id IN (SELECT team_id FROM team_members WHERE user_id = ?))
       ORDER BY updated_at DESC`
    )
    .all(since, userId, userId);

  const models = db
    .prepare(
      `SELECT * FROM model_characters
       WHERE created_at > ?
         AND (user_id = ? OR team_id IN (SELECT team_id FROM team_members WHERE user_id = ?))
       ORDER BY created_at DESC`
    )
    .all(since, userId, userId);

  const products = db
    .prepare(
      `SELECT * FROM products
       WHERE created_at > ?
         AND (user_id = ? OR team_id IN (SELECT team_id FROM team_members WHERE user_id = ?))
       ORDER BY created_at DESC`
    )
    .all(since, userId, userId);

  // Templates: always return all (no timestamp)
  const templates = db
    .prepare(
      `SELECT * FROM templates
       WHERE user_id = ? OR team_id IN (SELECT team_id FROM team_members WHERE user_id = ?)`
    )
    .all(userId, userId);

  res.json({ ok: true, projects, models, products, templates });
});

export default router;
