import { Session, SystemTemplate, ModelCharacter } from "../types";
import { DEFAULT_SYSTEM_TEMPLATES } from "../constants";

const SESSIONS_KEY = "nanobanana_sessions_v1";
const TEMPLATES_KEY = "nanobanana_templates_v1";
const MODELS_KEY = "nanobanana_models_v1";

const DB_NAME = "nanobanana_persistence_v2";
const DB_VERSION = 1;
const STORE_NAME = "kv";

type StoreKey = "sessions" | "templates" | "models";

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
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("打开 IndexedDB 失败"));
    });
  }
  try {
    return await dbPromise;
  } catch (e) {
    console.error("IndexedDB 不可用，将退回 localStorage：", e);
    return null;
  }
};

const idbGet = async <T>(key: StoreKey): Promise<T | null> => {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => resolve(null);
  });
};

const idbSet = async <T>(key: StoreKey, value: T): Promise<void> => {
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
};

export const initPersistentStorage = async (): Promise<void> => {
  await migrateLocalToIndexedDb();
};

export const saveSessions = async (sessions: Session[]): Promise<void> => {
  safeLocalSet(SESSIONS_KEY, sessions);
  await idbSet("sessions", sessions);
};

export const loadSessions = async (): Promise<Session[]> => {
  const idbData = await idbGet<Session[]>("sessions");
  if (Array.isArray(idbData)) return idbData;
  return safeLocalGet<Session[]>(SESSIONS_KEY, []);
};

export const saveTemplates = async (templates: SystemTemplate[]): Promise<void> => {
  safeLocalSet(TEMPLATES_KEY, templates);
  await idbSet("templates", templates);
};

export const loadTemplates = async (): Promise<SystemTemplate[]> => {
  const idbData = await idbGet<SystemTemplate[]>("templates");
  if (Array.isArray(idbData) && idbData.length > 0) return idbData;
  return safeLocalGet<SystemTemplate[]>(TEMPLATES_KEY, DEFAULT_SYSTEM_TEMPLATES);
};

export const saveModels = async (models: ModelCharacter[]): Promise<void> => {
  safeLocalSet(MODELS_KEY, models);
  await idbSet("models", models);
};

export const loadModels = async (): Promise<ModelCharacter[]> => {
  const idbData = await idbGet<ModelCharacter[]>("models");
  if (Array.isArray(idbData)) return idbData;
  return safeLocalGet<ModelCharacter[]>(MODELS_KEY, []);
};

