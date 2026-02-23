import { getDb } from "../db.mjs";

// UTC+8 offset in milliseconds
const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Get start-of-day timestamp in UTC+8.
 */
function startOfDayUTC8(now = Date.now()) {
  const shifted = now + UTC8_OFFSET_MS;
  const dayMs = shifted - (shifted % 86400000);
  return dayMs - UTC8_OFFSET_MS;
}

/**
 * Get start-of-month timestamp in UTC+8.
 */
function startOfMonthUTC8(now = Date.now()) {
  const d = new Date(now + UTC8_OFFSET_MS);
  const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  return monthStart - UTC8_OFFSET_MS;
}

/**
 * Record a usage event.
 */
export function recordUsage({ userId, username, endpoint, model, statusCode, requestId }) {
  const db = getDb();
  db.prepare(
    `INSERT INTO usage_records (user_id, username, endpoint, model, status_code, request_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, username, endpoint, model ?? null, statusCode, requestId ?? null, Date.now());
}

/**
 * Check if a user is within their quota limits.
 * Returns { allowed: true } or { allowed: false, message: string }.
 */
export function checkQuota(userId) {
  const db = getDb();
  const quota = db.prepare("SELECT monthly_limit, daily_limit FROM user_quotas WHERE user_id = ?").get(userId);

  const monthlyLimit = quota?.monthly_limit ?? -1;
  const dailyLimit = quota?.daily_limit ?? -1;

  // -1 means unlimited
  if (monthlyLimit === -1 && dailyLimit === -1) {
    return { allowed: true };
  }

  const now = Date.now();

  if (dailyLimit !== -1) {
    const dayStart = startOfDayUTC8(now);
    const dailyCount = db.prepare(
      `SELECT COUNT(*) AS cnt FROM usage_records
       WHERE user_id = ? AND created_at >= ? AND status_code >= 200 AND status_code < 300`
    ).get(userId, dayStart).cnt;
    if (dailyCount >= dailyLimit) {
      return { allowed: false, message: "已达到今日使用上限，请明天再试。" };
    }
  }

  if (monthlyLimit !== -1) {
    const monthStart = startOfMonthUTC8(now);
    const monthlyCount = db.prepare(
      `SELECT COUNT(*) AS cnt FROM usage_records
       WHERE user_id = ? AND created_at >= ? AND status_code >= 200 AND status_code < 300`
    ).get(userId, monthStart).cnt;
    if (monthlyCount >= monthlyLimit) {
      return { allowed: false, message: "已达到本月使用上限，请联系管理员。" };
    }
  }

  return { allowed: true };
}

/**
 * Get usage stats for a single user.
 */
export function getUserUsageStats(userId) {
  const db = getDb();
  const now = Date.now();
  const dayStart = startOfDayUTC8(now);
  const monthStart = startOfMonthUTC8(now);

  const today = db.prepare(
    `SELECT COUNT(*) AS cnt FROM usage_records
     WHERE user_id = ? AND created_at >= ? AND status_code >= 200 AND status_code < 300`
  ).get(userId, dayStart).cnt;

  const thisMonth = db.prepare(
    `SELECT COUNT(*) AS cnt FROM usage_records
     WHERE user_id = ? AND created_at >= ? AND status_code >= 200 AND status_code < 300`
  ).get(userId, monthStart).cnt;

  const total = db.prepare(
    `SELECT COUNT(*) AS cnt FROM usage_records
     WHERE user_id = ? AND status_code >= 200 AND status_code < 300`
  ).get(userId).cnt;

  const quota = db.prepare("SELECT monthly_limit, daily_limit FROM user_quotas WHERE user_id = ?").get(userId);

  return {
    today,
    thisMonth,
    total,
    dailyLimit: quota?.daily_limit ?? -1,
    monthlyLimit: quota?.monthly_limit ?? -1,
  };
}

/**
 * Get usage stats for all users (admin panel).
 */
export function getAllUsersUsageStats() {
  const db = getDb();
  const now = Date.now();
  const dayStart = startOfDayUTC8(now);
  const monthStart = startOfMonthUTC8(now);

  const users = db.prepare(
    `SELECT u.id, u.username, u.display_name AS displayName, u.created_at AS createdAt, u.updated_at AS updatedAt,
            (SELECT COUNT(*) FROM team_members tm WHERE tm.user_id = u.id) AS teamCount,
            (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS projectCount,
            COALESCE(q.monthly_limit, -1) AS monthlyLimit,
            COALESCE(q.daily_limit, -1) AS dailyLimit,
            (SELECT COUNT(*) FROM usage_records ur
             WHERE ur.user_id = u.id AND ur.created_at >= ? AND ur.status_code >= 200 AND ur.status_code < 300) AS today,
            (SELECT COUNT(*) FROM usage_records ur
             WHERE ur.user_id = u.id AND ur.created_at >= ? AND ur.status_code >= 200 AND ur.status_code < 300) AS thisMonth,
            (SELECT COUNT(*) FROM usage_records ur
             WHERE ur.user_id = u.id AND ur.status_code >= 200 AND ur.status_code < 300) AS total
     FROM users u
     LEFT JOIN user_quotas q ON q.user_id = u.id
     ORDER BY u.created_at DESC`
  ).all(dayStart, monthStart);

  return users;
}
