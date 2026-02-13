import { BatchJob, ModelCharacter, Session, SystemTemplate } from "../types";
import { DEFAULT_SYSTEM_TEMPLATES } from "../constants";

const SESSIONS_KEY = "nanobanana_sessions_v1";
const TEMPLATES_KEY = "nanobanana_templates_v1";
const MODELS_KEY = "nanobanana_models_v1";
const BATCH_JOBS_KEY = "nanobanana_batch_jobs_v1";

const DB_NAME = "nanobanana_persistence_v2";
const DB_VERSION = 1;
const STORE_NAME = "kv";
const LOCAL_BACKUP_MAX_BYTES = 2 * 1024 * 1024;

type StoreKey = "sessions" | "templates" | "models" | "batch_jobs";

let dbPromise: Promise<IDBDatabase> | null = null;

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
      const req = indexedDB.open(DB_NAME, DB_VERSION);
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
      store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch (e) {
    console.error(`idbSet(${key}) 失败，重置连接：`, e);
    resetDbPromise();
  }
};

const migrateLocalToIndexedDb = async () => {
  const db = await openDb();
  if (!db) return;

  const existingSessions = await idbGet<Session[]>("sessions");
  if (!existingSessions) {
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
    console.error("同步写入 sessions 备份失败：", e);
  }
};

export const backupSessionsSync = (sessions: Session[]) => {
  writeSessionsBackupSync(sessions);
};

export const saveSessions = async (sessions: Session[]): Promise<void> => {
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

export const saveBatchJobs = async (jobs: BatchJob[]): Promise<void> => {
  await idbSet("batch_jobs", jobs);
  deferLocalSet(BATCH_JOBS_KEY, jobs);
};

export const loadBatchJobs = async (): Promise<BatchJob[]> => {
  const idbData = await idbGet<BatchJob[]>("batch_jobs");
  if (Array.isArray(idbData)) return idbData;
  return safeLocalGet<BatchJob[]>(BATCH_JOBS_KEY, []);
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
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error || new Error("删除 IndexedDB 失败"));
        req.onblocked = () => resolve(); // 被阻塞时也继续
      });
    } catch (e) {
      console.error("删除 IndexedDB 失败：", e);
    }
  }
};
