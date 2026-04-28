import { BatchJob, ModelCharacter, ProductCatalogItem, Session, SystemTemplate, Project, GeneratedImage } from "../types";
import { DEFAULT_SYSTEM_TEMPLATES } from "../constants";
import { extractImagesFromSession } from "./projectUtils";

const SESSIONS_KEY = "nanobanana_sessions_v1";
const TEMPLATES_KEY = "nanobanana_templates_v1";
const MODELS_KEY = "nanobanana_models_v1";
const BATCH_JOBS_KEY = "nanobanana_batch_jobs_v1";
const PRODUCTS_KEY = "nanobanana_products_v1";
const PROJECTS_KEY = "nanobanana_projects_v1";
const MIGRATION_DONE_KEY = "nanobanana_project_migration_done";
const CURRENT_SESSION_ID_KEY_PREFIX = "nanobanana_current_session_id";
// per-user 同步备份：beforeunload/pagehide 同步落盘的最后一道防线，bootstrap 在 IDB 为空时优先读取这里
const EMERGENCY_BACKUP_PREFIX = "nanobanana_emergency_backup";
// per-user 待同步项目 ID 列表：sync 重试耗尽后写入，下次 bootstrap 重新提交
const PENDING_SYNC_PROJECTS_PREFIX = "nanobanana_pending_sync_projects";
const PENDING_SYNC_BATCH_JOBS_PREFIX = "nanobanana_pending_sync_batch_jobs";

const DB_NAME_PREFIX = "nanobanana_persistence_v2";
const DB_VERSION = 1;
const STORE_NAME = "kv";
const LOCAL_BACKUP_MAX_BYTES = 2 * 1024 * 1024;

type StoreKey = "sessions" | "templates" | "models" | "products" | "batch_jobs" | "projects";

let storageUserId: string | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

// ——— 配额异常上报 ———
// 重度用户的 IDB / localStorage 装满后，put / setItem 会 throw QuotaExceededError。
// 旧逻辑全部 catch{} 静默吞掉 → 用户以为保存成功，刷新发现没了。
// 模块级回调让 storage 层把 quota 错误冒泡到 UI 层显示红条。

let onQuotaExceededCb: (() => void) | null = null;
export const setOnStorageQuotaExceeded = (cb: (() => void) | null): void => {
  onQuotaExceededCb = cb;
};

const isQuotaExceeded = (e: any): boolean => {
  if (!e) return false;
  if (e.name === "QuotaExceededError") return true;
  if (e.name === "NS_ERROR_DOM_QUOTA_REACHED") return true;
  // localStorage 浏览器特定错误码
  if (typeof e.code === "number" && (e.code === 22 || e.code === 1014)) return true;
  return false;
};

const reportQuotaExceeded = (origin: string): void => {
  console.error(`[Storage] QuotaExceededError @ ${origin} — surfaced to UI`);
  if (onQuotaExceededCb) {
    try { onQuotaExceededCb(); } catch { /* swallow */ }
  }
};

/** Set user ID to namespace the IndexedDB database. Must be called before storage operations. */
export const setStorageUserId = async (userId: string): Promise<void> => {
  if (storageUserId === userId) return;
  // Close existing DB connection and await it before switching users
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch { /* ignore */ }
    resetDbPromise();
  }
  storageUserId = userId;
};

/** 当前选中的会话 ID 用 localStorage 而不是 IDB 存：体积极小、读写同步、bootstrap 拿到不阻塞。 */
const currentSessionIdKey = (): string =>
  storageUserId ? `${CURRENT_SESSION_ID_KEY_PREFIX}_${storageUserId}` : CURRENT_SESSION_ID_KEY_PREFIX;

export const saveCurrentSessionId = (id: string | null): void => {
  if (!hasWindow()) return;
  try {
    if (id) window.localStorage.setItem(currentSessionIdKey(), id);
    else window.localStorage.removeItem(currentSessionIdKey());
  } catch (e) {
    console.warn("[Storage] 写入 currentSessionId 失败：", e);
  }
};

export const loadCurrentSessionId = (): string | null => {
  if (!hasWindow()) return null;
  try {
    return window.localStorage.getItem(currentSessionIdKey()) || null;
  } catch {
    return null;
  }
};

const getDbName = (): string => {
  if (storageUserId) return `${DB_NAME_PREFIX}_${storageUserId}`;
  return DB_NAME_PREFIX;
};

const hasWindow = (): boolean => typeof window !== "undefined";

const safeLocalGet = <T>(key: string, fallback: T): T => {
  if (!hasWindow()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch (e) {
    console.error(`读取 localStorage 失败: ${key}`, e);
    return fallback;
  }
};

const safeLocalSet = (key: string, value: unknown) => {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    if (isQuotaExceeded(e)) reportQuotaExceeded(`safeLocalSet(${key})`);
    console.error(`写入 localStorage 失败: ${key}`, e);
  }
};

/** 重置连接缓存，下次操作会重新打开 */
const resetDbPromise = () => {
  dbPromise = null;
};

const openDb = async (): Promise<IDBDatabase | null> => {
  if (!hasWindow() || typeof indexedDB === "undefined") return null;
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(getDbName(), DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // 监听断连事件，清除缓存以便下次重新连接
        db.onclose = () => resetDbPromise();
        resolve(db);
      };
      req.onerror = () => reject(req.error || new Error("打开 IndexedDB 失败"));
    });
  }
  try {
    return await dbPromise;
  } catch (e) {
    console.error("IndexedDB 不可用，将退回 localStorage：", e);
    resetDbPromise();
    return null;
  }
};

const idbGet = async <T>(key: StoreKey): Promise<T | null> => {
  try {
    const db = await openDb();
    if (!db) return null;
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    console.error(`idbGet(${key}) 失败，重置连接：`, e);
    resetDbPromise();
    return null;
  }
};

const idbSet = async <T>(key: StoreKey, value: T): Promise<void> => {
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(value, key);
      // 单独监听 put 的 error，捕获 QuotaExceededError（tx.onerror 拿不到原始 error 对象）
      req.onerror = () => {
        if (isQuotaExceeded(req.error)) reportQuotaExceeded(`idbSet(${key})`);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        if (isQuotaExceeded(tx.error)) reportQuotaExceeded(`idbSet(${key}) tx`);
        resolve();
      };
      tx.onabort = () => {
        if (isQuotaExceeded(tx.error)) reportQuotaExceeded(`idbSet(${key}) abort`);
        resolve();
      };
    });
  } catch (e) {
    if (isQuotaExceeded(e)) reportQuotaExceeded(`idbSet(${key}) catch`);
    console.error(`idbSet(${key}) 失败，重置连接：`, e);
    resetDbPromise();
  }
};

/**
 * Read all data from the old shared DB (nanobanana_persistence_v2, without user suffix).
 * Read-only — does not modify or delete the old database.
 */
const readOldDb = async (): Promise<{
  sessions: Session[];
  templates: SystemTemplate[];
  models: ModelCharacter[];
  products: ProductCatalogItem[];
  batch_jobs: BatchJob[];
} | null> => {
  if (!hasWindow() || typeof indexedDB === "undefined") return null;
  // Only attempt if we're using a user-namespaced DB (old DB is the one without suffix)
  if (!storageUserId) return null;

  const oldDbName = DB_NAME_PREFIX; // "nanobanana_persistence_v2" without user suffix
  try {
    const oldDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(oldDbName, DB_VERSION);
      req.onupgradeneeded = () => {
        // Old DB doesn't exist — abort so we don't create an empty one
        req.transaction?.abort();
        reject(new Error("old_db_not_found"));
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (!oldDb.objectStoreNames.contains(STORE_NAME)) {
      oldDb.close();
      return null;
    }

    const readKey = <T>(key: string): Promise<T | null> =>
      new Promise((resolve) => {
        const tx = oldDb.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve((req.result as T) ?? null);
        req.onerror = () => resolve(null);
      });

    const [sessions, templates, models, products, batch_jobs] = await Promise.all([
      readKey<Session[]>("sessions"),
      readKey<SystemTemplate[]>("templates"),
      readKey<ModelCharacter[]>("models"),
      readKey<ProductCatalogItem[]>("products"),
      readKey<BatchJob[]>("batch_jobs"),
    ]);

    oldDb.close();

    // Return null if old DB was completely empty
    const hasSomething =
      (sessions && sessions.length > 0) ||
      (templates && templates.length > 0) ||
      (models && models.length > 0) ||
      (products && products.length > 0) ||
      (batch_jobs && batch_jobs.length > 0);

    if (!hasSomething) return null;

    return {
      sessions: sessions ?? [],
      templates: templates ?? [],
      models: models ?? [],
      products: products ?? [],
      batch_jobs: batch_jobs ?? [],
    };
  } catch (e: any) {
    if (e?.message === "old_db_not_found") {
      // Clean up the empty DB we may have created
      try { indexedDB.deleteDatabase(oldDbName); } catch { /* ignore */ }
    } else {
      console.warn("[Storage] 读取旧共享 DB 失败，跳过迁移：", e);
    }
    return null;
  }
};

const migrateLocalToIndexedDb = async () => {
  const db = await openDb();
  if (!db) return;

  const existingSessions = await idbGet<Session[]>("sessions");
  if (!existingSessions) {
    // Try old shared DB first, then fall back to localStorage
    const oldData = await readOldDb();
    if (oldData) {
      console.log("[Storage] 从旧共享 DB 迁移数据到用户命名空间 DB");
      if (oldData.sessions.length) await idbSet("sessions", oldData.sessions);
      if (oldData.templates.length) await idbSet("templates", oldData.templates);
      if (oldData.models.length) await idbSet("models", oldData.models);
      if (oldData.products.length) await idbSet("products", oldData.products);
      if (oldData.batch_jobs.length) await idbSet("batch_jobs", oldData.batch_jobs);
      return; // Old DB had data, skip localStorage fallback
    }

    // Fall back to localStorage
    const localSessions = safeLocalGet<Session[]>(SESSIONS_KEY, []);
    if (localSessions.length) await idbSet("sessions", localSessions);
  }

  const existingTemplates = await idbGet<SystemTemplate[]>("templates");
  if (!existingTemplates) {
    const localTemplates = safeLocalGet<SystemTemplate[]>(TEMPLATES_KEY, DEFAULT_SYSTEM_TEMPLATES);
    if (localTemplates.length) await idbSet("templates", localTemplates);
  }

  const existingModels = await idbGet<ModelCharacter[]>("models");
  if (!existingModels) {
    const localModels = safeLocalGet<ModelCharacter[]>(MODELS_KEY, []);
    if (localModels.length) await idbSet("models", localModels);
  }

  const existingBatchJobs = await idbGet<BatchJob[]>("batch_jobs");
  if (!existingBatchJobs) {
    const localBatchJobs = safeLocalGet<BatchJob[]>(BATCH_JOBS_KEY, []);
    if (localBatchJobs.length) await idbSet("batch_jobs", localBatchJobs);
  }

  const existingProducts = await idbGet<ProductCatalogItem[]>("products");
  if (!existingProducts) {
    const localProducts = safeLocalGet<ProductCatalogItem[]>(PRODUCTS_KEY, []);
    if (localProducts.length) await idbSet("products", localProducts);
  }
};

export const initPersistentStorage = async (): Promise<void> => {
  await migrateLocalToIndexedDb();
};

/** 延迟写入 localStorage 作为备份（不阻塞主流程） */
const deferLocalSet = (key: string, value: unknown) => {
  const cb = () => {
    if (!hasWindow()) return;
    try {
      const serialized = JSON.stringify(value);
      // sessions 可能包含大量 base64 图片，超大备份直接跳过，避免主线程卡顿。
      if (key === SESSIONS_KEY && serialized.length > LOCAL_BACKUP_MAX_BYTES) {
        console.warn(`跳过 localStorage 备份：${key} 体积过大 (${serialized.length} bytes)`);
        return;
      }
      window.localStorage.setItem(key, serialized);
    } catch (e) {
      if (isQuotaExceeded(e)) reportQuotaExceeded(`deferLocalSet(${key})`);
      console.error(`写入 localStorage 失败: ${key}`, e);
    }
  };
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(cb);
  } else {
    setTimeout(cb, 0);
  }
};

const writeSessionsBackupSync = (sessions: Session[]) => {
  if (!hasWindow()) return;
  try {
    const serialized = JSON.stringify(sessions);
    if (serialized.length > LOCAL_BACKUP_MAX_BYTES) {
      return;
    }
    window.localStorage.setItem(SESSIONS_KEY, serialized);
  } catch (e) {
    if (isQuotaExceeded(e)) reportQuotaExceeded("writeSessionsBackupSync");
    console.error("同步写入 sessions 备份失败：", e);
  }
};

export const backupSessionsSync = (sessions: Session[]) => {
  writeSessionsBackupSync(sessions);
};

// ——— 同步紧急备份（per-user）———
// beforeunload / pagehide 时同步落盘，async 的 IDB 写在浏览器关闭瞬间不保证完成。
// 这是"刷新前 2 秒生成的图丢"这一类问题的最后一道防线。

const emergencyKey = (kind: "sessions" | "batch_jobs"): string =>
  storageUserId
    ? `${EMERGENCY_BACKUP_PREFIX}_${kind}_${storageUserId}`
    : `${EMERGENCY_BACKUP_PREFIX}_${kind}`;

export const backupSessionsEmergency = (sessions: Session[]): void => {
  if (!hasWindow()) return;
  try {
    const serialized = JSON.stringify(sessions);
    if (serialized.length > LOCAL_BACKUP_MAX_BYTES) {
      // 体积超限直接放弃这一项备份，宁可丢也不让 setItem 抛 quota exceeded 拖累整个 unload
      return;
    }
    window.localStorage.setItem(emergencyKey("sessions"), serialized);
  } catch (e) {
    if (isQuotaExceeded(e)) reportQuotaExceeded("backupSessionsEmergency");
    // unload 路径上不能再做更多
  }
};

export const backupBatchJobsEmergency = (jobs: BatchJob[]): void => {
  if (!hasWindow()) return;
  try {
    const serialized = JSON.stringify(jobs);
    if (serialized.length > LOCAL_BACKUP_MAX_BYTES) return;
    window.localStorage.setItem(emergencyKey("batch_jobs"), serialized);
  } catch (e) {
    if (isQuotaExceeded(e)) reportQuotaExceeded("backupBatchJobsEmergency");
    // ignore
  }
};

export const loadEmergencySessionsBackup = (): Session[] | null => {
  if (!hasWindow()) return null;
  try {
    const raw = window.localStorage.getItem(emergencyKey("sessions"));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const loadEmergencyBatchJobsBackup = (): BatchJob[] | null => {
  if (!hasWindow()) return null;
  try {
    const raw = window.localStorage.getItem(emergencyKey("batch_jobs"));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** Bootstrap 成功用上服务器/IDB 数据后清空紧急备份，避免下次启动用陈旧数据覆盖。 */
export const clearEmergencyBackups = (): void => {
  if (!hasWindow()) return;
  try {
    window.localStorage.removeItem(emergencyKey("sessions"));
    window.localStorage.removeItem(emergencyKey("batch_jobs"));
  } catch {
    // ignore
  }
};

// ——— 待同步项目 ID 注册表（per-user）———
// sync 队列重试耗尽后把 project ID / batch job ID 写到这里。
// 下次 bootstrap 完成时 / 周期性轮询时，从最新 React state 中找到对应实体重新发送。

const pendingSyncKey = (kind: "projects" | "batch_jobs"): string => {
  const prefix = kind === "projects" ? PENDING_SYNC_PROJECTS_PREFIX : PENDING_SYNC_BATCH_JOBS_PREFIX;
  return storageUserId ? `${prefix}_${storageUserId}` : prefix;
};

const readPendingSet = (kind: "projects" | "batch_jobs"): Set<string> => {
  if (!hasWindow()) return new Set();
  try {
    const raw = window.localStorage.getItem(pendingSyncKey(kind));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((v) => typeof v === "string") : []);
  } catch {
    return new Set();
  }
};

const writePendingSet = (kind: "projects" | "batch_jobs", set: Set<string>): void => {
  if (!hasWindow()) return;
  try {
    if (set.size === 0) {
      window.localStorage.removeItem(pendingSyncKey(kind));
    } else {
      window.localStorage.setItem(pendingSyncKey(kind), JSON.stringify(Array.from(set)));
    }
  } catch {
    // ignore
  }
};

export const addPendingSyncId = (kind: "projects" | "batch_jobs", id: string): void => {
  const set = readPendingSet(kind);
  set.add(id);
  writePendingSet(kind, set);
};

export const removePendingSyncId = (kind: "projects" | "batch_jobs", id: string): void => {
  const set = readPendingSet(kind);
  if (set.delete(id)) {
    writePendingSet(kind, set);
  }
};

export const getPendingSyncIds = (kind: "projects" | "batch_jobs"): string[] => {
  return Array.from(readPendingSet(kind));
};

export const saveSessions = async (sessions: Session[]): Promise<void> => {
  // Merge: for sessions whose messages haven't been lazy-loaded yet,
  // preserve the existing cached messages from IndexedDB to avoid data loss.
  const hasUnloaded = sessions.some((s) => (s as any).messagesLoaded === false);
  if (hasUnloaded) {
    const existing = await loadSessions();
    if (existing.length > 0) {
      const existingMap = new Map(existing.map((s) => [s.id, s]));
      sessions = sessions.map((s) => {
        if ((s as any).messagesLoaded === false) {
          const cached = existingMap.get(s.id);
          if (cached?.messages?.length) {
            return { ...s, messages: cached.messages, messagesLoaded: true } as Session;
          }
        }
        return s;
      });
    }
  }
  await idbSet("sessions", sessions);
  deferLocalSet(SESSIONS_KEY, sessions);
};

export const loadSessions = async (): Promise<Session[]> => {
  const idbData = await idbGet<Session[]>("sessions");
  if (Array.isArray(idbData)) return idbData;
  return safeLocalGet<Session[]>(SESSIONS_KEY, []);
};

export const saveTemplates = async (templates: SystemTemplate[]): Promise<void> => {
  await idbSet("templates", templates);
  deferLocalSet(TEMPLATES_KEY, templates);
};

export const loadTemplates = async (): Promise<SystemTemplate[]> => {
  const idbData = await idbGet<SystemTemplate[]>("templates");
  if (Array.isArray(idbData) && idbData.length > 0) return idbData;
  return safeLocalGet<SystemTemplate[]>(TEMPLATES_KEY, DEFAULT_SYSTEM_TEMPLATES);
};

export const saveModels = async (models: ModelCharacter[]): Promise<void> => {
  await idbSet("models", models);
  deferLocalSet(MODELS_KEY, models);
};

export const loadModels = async (): Promise<ModelCharacter[]> => {
  const idbData = await idbGet<ModelCharacter[]>("models");
  if (Array.isArray(idbData)) return idbData;
  return safeLocalGet<ModelCharacter[]>(MODELS_KEY, []);
};

export const saveProducts = async (products: ProductCatalogItem[]): Promise<void> => {
  await idbSet("products", products);
  deferLocalSet(PRODUCTS_KEY, products);
};

export const loadProducts = async (): Promise<ProductCatalogItem[]> => {
  const idbData = await idbGet<ProductCatalogItem[]>("products");
  if (Array.isArray(idbData)) return idbData;
  return safeLocalGet<ProductCatalogItem[]>(PRODUCTS_KEY, []);
};

export const saveBatchJobs = async (jobs: BatchJob[]): Promise<void> => {
  await idbSet("batch_jobs", jobs);
  deferLocalSet(BATCH_JOBS_KEY, jobs);
};

export const loadBatchJobs = async (): Promise<BatchJob[]> => {
  const idbData = await idbGet<BatchJob[]>("batch_jobs");
  const rawJobs = Array.isArray(idbData) ? idbData : safeLocalGet<BatchJob[]>(BATCH_JOBS_KEY, []);
  // 数据兼容：确保新字段存在（productImageUrl, modelImageUrl）
  return rawJobs.map((job) => ({
    ...job,
    productImageUrl: job.productImageUrl ?? undefined,
    modelImageUrl: job.modelImageUrl ?? undefined,
  }));
};

// === Project persistence ===

export const saveProjects = async (projects: Project[]): Promise<void> => {
  await idbSet("projects", projects);
  deferLocalSet(PROJECTS_KEY, projects);
};

export const loadProjects = async (): Promise<Project[]> => {
  const idbData = await idbGet<Project[]>("projects");
  if (Array.isArray(idbData)) return idbData;
  return safeLocalGet<Project[]>(PROJECTS_KEY, []);
};

/**
 * Migrate existing Sessions + BatchJobs into unified Project model.
 * Only runs once per user (guards with localStorage flag).
 */
export const migrateToProjectModel = async (): Promise<Project[]> => {
  // Check if migration already done
  const migrationKey = storageUserId
    ? `${MIGRATION_DONE_KEY}_${storageUserId}`
    : MIGRATION_DONE_KEY;
  if (hasWindow() && window.localStorage.getItem(migrationKey) === "1") {
    return await loadProjects();
  }

  const sessions = await loadSessions();
  const batchJobs = await loadBatchJobs();
  const userId = storageUserId || "default";

  const projects: Project[] = [];

  // Convert each Session to a Project
  for (const session of sessions) {
    const images = extractImagesFromSession(session);
    const earliestTimestamp = session.messages.length > 0
      ? Math.min(...session.messages.map((m) => m.timestamp))
      : Date.now();

    const project: Project = {
      id: session.id,
      title: session.title,
      createdAt: earliestTimestamp,
      updatedAt: session.updatedAt,
      userId,
      settings: { ...session.settings },
      productImage: session.settings.productImage || null,
      modelImage: null,
      referenceImage: null,
      images,
      chatHistory: session.messages,
    };
    projects.push(project);
  }

  // Convert BatchJobs to Projects (or merge if matching)
  for (const job of batchJobs) {
    if (job.status === "deleted") continue;

    // Extract images from batch slots
    const batchImages: GeneratedImage[] = [];
    for (const slot of job.slots) {
      for (const version of slot.versions) {
        if (!version.imageUrl) continue;
        batchImages.push({
          id: version.id,
          imageUrl: version.imageUrl,
          prompt: version.promptUsed,
          model: version.model,
          size: version.size,
          createdAt: version.createdAt,
          source: 'batch',
          slotId: slot.id,
          slotTitle: slot.title,
          isPrimary: version.isPrimary,
        });
      }
    }

    // Create a new project for each batch job
    const batchProject: Project = {
      id: `batch-${job.id}`,
      title: job.title || `矩阵任务`,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      userId,
      settings: {
        systemPrompt: '',
        aspectRatio: 'auto' as any,
        selectedModelId: null,
        productScale: 'Standard' as any,
        responseFormat: 'url',
        batchCount: 1,
        batchSizes: [],
        autoUseLastImage: false,
        productImage: null,
      },
      productImage: null,
      modelImage: job.modelImageUrl || null,
      referenceImage: job.referenceImageUrl || null,
      images: batchImages,
      chatHistory: [],
      batchConfig: {
        basePrompt: job.basePrompt,
        referenceImageUrl: job.referenceImageUrl,
        productImageUrl: job.productImageUrl,
        modelImageUrl: job.modelImageUrl,
        slots: job.slots,
      },
    };
    projects.push(batchProject);
  }

  // Save migrated projects
  await saveProjects(projects);

  // Mark migration as done
  if (hasWindow()) {
    try {
      window.localStorage.setItem(migrationKey, "1");
    } catch {
      // ignore
    }
  }

  return projects;
};

/** 清除所有应用数据（IndexedDB + localStorage），供登出时调用 */
export const clearAll = async (): Promise<void> => {
  // 清除 localStorage
  if (hasWindow()) {
    try {
      window.localStorage.removeItem(SESSIONS_KEY);
      window.localStorage.removeItem(TEMPLATES_KEY);
      window.localStorage.removeItem(MODELS_KEY);
      window.localStorage.removeItem(BATCH_JOBS_KEY);
      window.localStorage.removeItem(PRODUCTS_KEY);
    } catch (e) {
      console.error("清除 localStorage 失败：", e);
    }
  }

  // 清除 IndexedDB：删除整个数据库并重置连接缓存
  try {
    const db = await openDb();
    if (db) {
      db.close();
    }
  } catch {
    // 忽略
  }
  resetDbPromise();

  if (hasWindow() && typeof indexedDB !== "undefined") {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(getDbName());
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error || new Error("删除 IndexedDB 失败"));
        req.onblocked = () => resolve(); // 被阻塞时也继续
      });
    } catch (e) {
      console.error("删除 IndexedDB 失败：", e);
    }
  }
};
