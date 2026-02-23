import React, { createContext, useContext, useReducer, useEffect, useRef, Dispatch } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { projectReducer, projectInitialState, ProjectState, ProjectAction } from './projectReducer';
import { batchReducer, batchInitialState, BatchState, BatchAction } from './batchReducer';
import { libraryReducer, libraryInitialState, LibraryState, LibraryAction } from './libraryReducer';
import { teamReducer, teamInitialState, TeamState, TeamAction } from './teamReducer';
import { uiReducer, UIState, UIAction } from './uiReducer';
import { getEffectiveApiConfig } from '@/services/apiConfig';
import { loadDefaultPreferences } from '@/components/SettingsPanel';
import {
  initPersistentStorage,
  loadSessions,
  loadBatchJobs,
  loadTemplates,
  loadModels,
  loadProducts,
  saveSessions,
  saveBatchJobs,
  saveTemplates,
  saveModels,
  saveProducts,
  backupSessionsSync,
  setStorageUserId,
} from '@/services/storage';
import { syncService } from '@/services/sync';
import { getSession as getAuthSession } from '@/services/auth';
import { onQueueStateChange } from '@/services/generationQueue';
import {
  SET_SESSIONS,
  SET_CURRENT_SESSION_ID,
  SET_BATCH_JOBS,
  SET_SELECTED_BATCH_JOB_ID,
  SET_TEMPLATES,
  SET_MODELS,
  SET_PRODUCTS,
  SET_TEAMS,
  SET_AUTH_USER,
  SET_AUTH_READY,
  SET_QUEUE_STATS,
  SET_IS_SUPER_ADMIN,
} from './actions';
import type { Session, SessionSettings, BatchJob } from '@/types';
import { DEFAULT_ASPECT_RATIO } from '@/constants';
import { getSupportedAspectRatios, getSupportedSizeForAspect } from '@/services/sizeUtils';
import { AspectRatio, ProductScale } from '@/types';

// ——— Helpers ———

const normalizeSessionSettings = (raw: any, defaultTemplate: string): SessionSettings => {
  const aspectRatioValues = getSupportedAspectRatios();
  const productScaleValues = Object.values(ProductScale);
  const aspectRatio = aspectRatioValues.includes(raw?.aspectRatio) ? raw.aspectRatio : DEFAULT_ASPECT_RATIO;
  const batchCountRaw = typeof raw?.batchCount === "number" ? raw.batchCount : 1;
  const batchCount = Math.min(Math.max(Math.round(batchCountRaw), 1), 10);
  const batchSizes = [getSupportedSizeForAspect(aspectRatio)];
  return {
    systemPrompt: typeof raw?.systemPrompt === "string" ? raw.systemPrompt : defaultTemplate,
    aspectRatio,
    selectedModelId: typeof raw?.selectedModelId === "string" ? raw.selectedModelId : null,
    productScale: productScaleValues.includes(raw?.productScale) ? raw.productScale : ProductScale.Standard,
    responseFormat: "url",
    batchCount,
    batchSizes,
    autoUseLastImage: typeof raw?.autoUseLastImage === "boolean" ? raw.autoUseLastImage : true,
    productImage: raw?.productImage ?? null,
  };
};

const localizeLegacyText = (t: string): string => {
  const s = String(t || "").trim();
  if (!s) return s;
  if (s === "An error occurred. Please verify your API settings.") return "发生错误：请检查模型、令牌或网络配置。";
  if (s === "Failed to generate model.") return "生成模特失败。";
  if (s.startsWith("Failed to generate model:")) return `生成模特失败：${s.replace("Failed to generate model:", "").trim()}`;
  return t;
};

function mapServerProjectsToSessions(serverProjects: any[], defaultTemplate: string): Session[] {
  return serverProjects.map((p) => ({
    id: p.id,
    title: p.title ?? "",
    messages: p.chat_history_json ? JSON.parse(p.chat_history_json) : [],
    updatedAt: p.updated_at ?? Date.now(),
    settings: normalizeSessionSettings(
      p.settings_json ? JSON.parse(p.settings_json) : {},
      defaultTemplate,
    ),
  }));
}

function mapServerBatchJobsToFrontend(serverJobs: any[]): BatchJob[] {
  return serverJobs.map((row) => ({
    id: row.id,
    title: row.title ?? "",
    projectId: row.project_id ?? undefined,
    productId: row.product_id ?? undefined,
    status: row.status ?? "draft",
    basePrompt: row.base_prompt ?? "",
    referenceImageUrl: row.reference_image_url ?? undefined,
    productImageUrl: row.product_image_url ?? undefined,
    modelImageUrl: row.model_image_url ?? undefined,
    slots: row.slots_json ? JSON.parse(row.slots_json) : [],
    actionLogs: row.action_logs_json ? JSON.parse(row.action_logs_json) : [],
    tags: row.tags_json ? JSON.parse(row.tags_json) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
  }));
}

function normalizeSessions(sessions: Session[], defaultTemplate: string): Session[] {
  return sessions.map((s) => ({
    ...s,
    settings: normalizeSessionSettings(s.settings, defaultTemplate),
    messages: Array.isArray(s.messages)
      ? s.messages.map((m: any) => ({
          ...m,
          parts: Array.isArray(m?.parts)
            ? m.parts.map((p: any) =>
                p?.type === "text" && typeof p?.text === "string" ? { ...p, text: localizeLegacyText(p.text) } : p
              )
            : [],
        }))
      : [],
  }));
}

function mapServerTemplates(serverTemplates: any[]) {
  return serverTemplates.map((t: any) => ({
    id: t.id,
    name: t.name ?? "",
    content: t.content ?? "",
  }));
}

function mapServerModels(serverModels: any[]) {
  return serverModels.map((m: any) => ({
    id: m.id,
    name: m.name ?? "",
    imageUrl: m.blob_id ? `/api/data/blobs/${m.blob_id}` : "",
  }));
}

function mapServerProducts(serverProducts: any[]) {
  return serverProducts.map((p: any) => ({
    id: p.id,
    name: p.name ?? "",
    imageUrl: p.blob_id ? `/api/data/blobs/${p.blob_id}` : "",
    category: p.category ?? undefined,
    dimensions: p.dimensions_json ? JSON.parse(p.dimensions_json) : undefined,
    size: p.size ?? undefined,
    description: p.description ?? undefined,
    createdAt: p.created_at ?? Date.now(),
  }));
}

function mapServerTeams(serverTeams: any[]) {
  return serverTeams.map((t: any) => ({
    id: t.id,
    name: t.name,
    createdBy: t.created_by,
    members: Array.isArray(t.members)
      ? t.members.map((m: any) => ({
          userId: m.userId || m.id,
          username: m.username,
          displayName: m.displayName || m.display_name || m.username,
          role: m.role || 'member',
          joinedAt: m.joinedAt || m.joined_at || Date.now(),
        }))
      : [],
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  }));
}

const ADVANCED_PANEL_STORAGE_KEY = "topseller.ui.advanced_panel_open";

// ——— Initial UI state ———

const uiInitialState: UIState = {
  isGenerating: false,
  generationStage: null,
  generationProgress: null,
  isEnhancing: false,
  previewImageUrl: null,
  errorDetails: null,
  maskEditContext: null,
  maskHistoryItems: [],
  isAdvancedPanelOpen: (() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(ADVANCED_PANEL_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  })(),
  queueStats: null,
  currentView: 'chat',
  inputText: '',
  selectedImage: null,
  referenceIntent: 'all' as const,
  apiConfig: getEffectiveApiConfig(),
  defaultPreferences: loadDefaultPreferences(),
  authUser: null,
  authReady: false,
  authLoading: false,
  isSuperAdmin: false,
};

// ——— Context Type ———

export interface AppContextType {
  project: ProjectState;
  projectDispatch: Dispatch<ProjectAction>;
  batch: BatchState;
  batchDispatch: Dispatch<BatchAction>;
  library: LibraryState;
  libraryDispatch: Dispatch<LibraryAction>;
  team: TeamState;
  teamDispatch: Dispatch<TeamAction>;
  ui: UIState;
  uiDispatch: Dispatch<UIAction>;
  hasHydratedStorage: boolean;
}

const AppContext = createContext<AppContextType | null>(null);

// ——— Provider ———

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [project, projectDispatch] = useReducer(projectReducer, projectInitialState);
  const [batch, batchDispatch] = useReducer(batchReducer, batchInitialState);
  const [library, libraryDispatch] = useReducer(libraryReducer, libraryInitialState);
  const [team, teamDispatch] = useReducer(teamReducer, teamInitialState);
  const [ui, uiDispatch] = useReducer(uiReducer, uiInitialState);

  const [hasHydratedStorage, setHasHydratedStorage] = React.useState(false);

  // Refs for debounced persistence
  const saveSessionsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSessionsRef = useRef<Session[] | null>(null);
  const latestSessionsRef = useRef<Session[]>([]);
  const prevSessionsRef = useRef<Session[]>([]);
  const saveBatchJobsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBatchJobsRef = useRef<BatchJob[] | null>(null);
  const latestBatchJobsRef = useRef<BatchJob[]>([]);
  const prevBatchJobsRef = useRef<BatchJob[]>([]);

  // Auth check on mount
  useEffect(() => {
    let cancelled = false;
    const checkAuth = async () => {
      const session = await getAuthSession();
      if (cancelled) return;
      uiDispatch({ type: SET_AUTH_USER, payload: session?.username || null });
      uiDispatch({ type: SET_IS_SUPER_ADMIN, payload: session?.isSuperAdmin || false });
      uiDispatch({ type: SET_AUTH_READY, payload: true });
    };
    void checkAuth();
    return () => { cancelled = true; };
  }, []);

  // Queue stats subscription
  useEffect(() => {
    const unsubscribe = onQueueStateChange((stats) => {
      uiDispatch({ type: SET_QUEUE_STATS, payload: stats });
    });
    return unsubscribe;
  }, []);

  // Bootstrap data after auth — server-first with IndexedDB fallback
  useEffect(() => {
    if (!ui.authReady || !ui.authUser) return;
    let cancelled = false;

    const bootstrap = async () => {
      // Namespace storage per user and initialize
      setStorageUserId(ui.authUser!);
      await initPersistentStorage();
      syncService.init(ui.authUser!);

      // Try server-first pull with 5s timeout
      let serverData: Awaited<ReturnType<typeof syncService.pullAll>> | null = null;
      try {
        serverData = await Promise.race([
          syncService.pullAll(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("pullAll timeout")), 5000)),
        ]);
      } catch (err) {
        console.warn("[Bootstrap] 服务端拉取失败，回退到 IndexedDB:", err);
      }

      if (cancelled) return;

      const defaultTemplate = (() => {
        if (serverData && serverData.templates.length > 0) {
          return serverData.templates[0].content ?? "";
        }
        return "";
      })();

      if (serverData) {
        // ——— Server-first path: dispatch server data ———
        console.log("[Bootstrap] 使用服务端数据");

        // Templates
        const mappedTemplates = serverData.templates.length > 0
          ? mapServerTemplates(serverData.templates)
          : [];
        if (mappedTemplates.length > 0) {
          libraryDispatch({ type: SET_TEMPLATES, payload: mappedTemplates });
        }

        // Models
        const mappedModels = serverData.models.length > 0
          ? mapServerModels(serverData.models)
          : [];
        if (mappedModels.length > 0) {
          libraryDispatch({ type: SET_MODELS, payload: mappedModels });
        }

        // Products
        const mappedProducts = serverData.products.length > 0
          ? mapServerProducts(serverData.products)
          : [];
        if (mappedProducts.length > 0) {
          libraryDispatch({ type: SET_PRODUCTS, payload: mappedProducts });
        }

        // Teams
        if (serverData.teams.length > 0) {
          teamDispatch({ type: SET_TEAMS, payload: mapServerTeams(serverData.teams) });
        }

        // Sessions (projects → sessions)
        const resolvedDefaultTemplate = mappedTemplates.length > 0 ? mappedTemplates[0].content : defaultTemplate;
        if (serverData.projects.length > 0) {
          const mappedSessions = mapServerProjectsToSessions(serverData.projects, resolvedDefaultTemplate);
          const normalized = normalizeSessions(mappedSessions, resolvedDefaultTemplate);
          projectDispatch({ type: SET_SESSIONS, payload: normalized });
          projectDispatch({ type: SET_CURRENT_SESSION_ID, payload: normalized[0].id });
          prevSessionsRef.current = normalized;
          // Write to IndexedDB as cache
          void saveSessions(normalized);
        } else {
          // Server has no projects — check local for one-time migration
          const localSessions = await loadSessions();
          if (localSessions.length > 0) {
            const normalized = normalizeSessions(localSessions, resolvedDefaultTemplate);
            projectDispatch({ type: SET_SESSIONS, payload: normalized });
            projectDispatch({ type: SET_CURRENT_SESSION_ID, payload: normalized[0].id });
            prevSessionsRef.current = normalized;
            // Push local data to server
            console.log("[Sync] 服务端无项目数据，推送本地项目到服务端");
            for (const s of normalized) {
              syncService.saveProject(s);
            }
          } else {
            // Create empty session
            const prefs = loadDefaultPreferences();
            const ar = prefs.aspectRatio ?? DEFAULT_ASPECT_RATIO;
            const newSession: Session = {
              id: uuidv4(),
              title: '新项目',
              messages: [],
              updatedAt: Date.now(),
              settings: {
                aspectRatio: ar,
                systemPrompt: resolvedDefaultTemplate,
                selectedModelId: null,
                productScale: prefs.productScale ?? ProductScale.Standard,
                responseFormat: "url",
                batchCount: prefs.batchCount ?? 1,
                batchSizes: [getSupportedSizeForAspect(ar)],
                autoUseLastImage: true,
                productImage: null,
              },
            };
            projectDispatch({ type: SET_SESSIONS, payload: [newSession] });
            projectDispatch({ type: SET_CURRENT_SESSION_ID, payload: newSession.id });
            prevSessionsRef.current = [newSession];
          }
        }

        // Batch Jobs
        if (serverData.batchJobs.length > 0) {
          const mappedBatchJobs = mapServerBatchJobsToFrontend(serverData.batchJobs);
          batchDispatch({ type: SET_BATCH_JOBS, payload: mappedBatchJobs });
          batchDispatch({ type: SET_SELECTED_BATCH_JOB_ID, payload: mappedBatchJobs[0]?.id || null });
          prevBatchJobsRef.current = mappedBatchJobs;
          void saveBatchJobs(mappedBatchJobs);
        } else {
          // Check local for one-time migration
          const localBatchJobs = await loadBatchJobs();
          if (localBatchJobs.length > 0) {
            batchDispatch({ type: SET_BATCH_JOBS, payload: localBatchJobs });
            batchDispatch({ type: SET_SELECTED_BATCH_JOB_ID, payload: localBatchJobs[0]?.id || null });
            prevBatchJobsRef.current = localBatchJobs;
            console.log("[Sync] 服务端无套图数据，推送本地套图到服务端");
            for (const j of localBatchJobs) {
              syncService.saveBatchJob(j);
            }
          }
        }

        // One-time migration for models/products/templates
        if (serverData.models.length === 0) {
          const localModels = await loadModels();
          if (localModels.length > 0) {
            libraryDispatch({ type: SET_MODELS, payload: localModels });
            console.log("[Sync] 服务端无模特数据，推送本地模特到服务端");
            for (const m of localModels) syncService.saveModel(m);
          }
        }
        if (serverData.products.length === 0) {
          const localProducts = await loadProducts();
          if (localProducts.length > 0) {
            libraryDispatch({ type: SET_PRODUCTS, payload: localProducts });
            console.log("[Sync] 服务端无产品数据，推送本地产品到服务端");
            for (const p of localProducts) syncService.saveProduct(p);
          }
        }
        if (serverData.templates.length === 0) {
          const localTemplates = await loadTemplates();
          if (localTemplates.length > 0) {
            libraryDispatch({ type: SET_TEMPLATES, payload: localTemplates });
            console.log("[Sync] 服务端无模板数据，推送本地模板到服务端");
            syncService.saveTemplates(localTemplates);
          }
        }
      } else {
        // ——— Fallback path: load from IndexedDB ———
        console.log("[Bootstrap] 使用本地 IndexedDB 数据");

        const [loadedTemplates, loadedModels, loadedProducts, loadedSessions, loadedBatchJobs] = await Promise.all([
          loadTemplates(),
          loadModels(),
          loadProducts(),
          loadSessions(),
          loadBatchJobs(),
        ]);
        if (cancelled) return;

        libraryDispatch({ type: SET_TEMPLATES, payload: loadedTemplates });
        libraryDispatch({ type: SET_MODELS, payload: loadedModels });
        libraryDispatch({ type: SET_PRODUCTS, payload: loadedProducts });

        if (loadedSessions.length > 0) {
          const fallbackDefaultTemplate = loadedTemplates.length > 0 ? loadedTemplates[0].content : "";
          const normalized = normalizeSessions(loadedSessions, fallbackDefaultTemplate);
          projectDispatch({ type: SET_SESSIONS, payload: normalized });
          projectDispatch({ type: SET_CURRENT_SESSION_ID, payload: normalized[0].id });
        } else {
          const fallbackDefaultTemplate = loadedTemplates.length > 0 ? loadedTemplates[0].content : '';
          const prefs = loadDefaultPreferences();
          const ar = prefs.aspectRatio ?? DEFAULT_ASPECT_RATIO;
          const newSession: Session = {
            id: uuidv4(),
            title: '新项目',
            messages: [],
            updatedAt: Date.now(),
            settings: {
              aspectRatio: ar,
              systemPrompt: fallbackDefaultTemplate,
              selectedModelId: null,
              productScale: prefs.productScale ?? ProductScale.Standard,
              responseFormat: "url",
              batchCount: prefs.batchCount ?? 1,
              batchSizes: [getSupportedSizeForAspect(ar)],
              autoUseLastImage: true,
              productImage: null,
            },
          };
          projectDispatch({ type: SET_SESSIONS, payload: [newSession] });
          projectDispatch({ type: SET_CURRENT_SESSION_ID, payload: newSession.id });
        }

        if (Array.isArray(loadedBatchJobs)) {
          batchDispatch({ type: SET_BATCH_JOBS, payload: loadedBatchJobs });
          batchDispatch({ type: SET_SELECTED_BATCH_JOB_ID, payload: loadedBatchJobs[0]?.id || null });
          prevBatchJobsRef.current = loadedBatchJobs;
        }

        prevSessionsRef.current = loadedSessions;
      }

      setHasHydratedStorage(true);
    };
    void bootstrap();
    return () => { cancelled = true; };
  }, [ui.authReady, ui.authUser]);

  // Keep latest refs in sync
  useEffect(() => {
    latestSessionsRef.current = project.sessions;
  }, [project.sessions]);

  useEffect(() => {
    latestBatchJobsRef.current = batch.batchJobs;
  }, [batch.batchJobs]);

  // Debounced session save
  useEffect(() => {
    if (!hasHydratedStorage) return;
    pendingSessionsRef.current = project.sessions;
    if (saveSessionsTimerRef.current) clearTimeout(saveSessionsTimerRef.current);
    saveSessionsTimerRef.current = setTimeout(() => {
      saveSessionsTimerRef.current = null;
      if (pendingSessionsRef.current) {
        void saveSessions(pendingSessionsRef.current);
        // Sync changed sessions to server
        const prev = prevSessionsRef.current;
        const prevMap = new Map<string, Session>(prev.map((s) => [s.id, s]));
        for (const s of pendingSessionsRef.current) {
          const old = prevMap.get(s.id);
          if (!old || old.updatedAt !== s.updatedAt) {
            syncService.saveProject(s);
          }
        }
        // Detect deleted sessions
        const currentIds = new Set(pendingSessionsRef.current.map((s) => s.id));
        for (const s of prev) {
          if (!currentIds.has(s.id)) {
            syncService.deleteProject(s.id);
          }
        }
        prevSessionsRef.current = pendingSessionsRef.current;
        pendingSessionsRef.current = null;
      }
    }, 400);
    return () => {
      if (saveSessionsTimerRef.current) clearTimeout(saveSessionsTimerRef.current);
    };
  }, [project.sessions, hasHydratedStorage]);

  // Debounced batch jobs save + server sync
  useEffect(() => {
    if (!hasHydratedStorage) return;
    pendingBatchJobsRef.current = batch.batchJobs;
    if (saveBatchJobsTimerRef.current) clearTimeout(saveBatchJobsTimerRef.current);
    saveBatchJobsTimerRef.current = setTimeout(() => {
      saveBatchJobsTimerRef.current = null;
      if (pendingBatchJobsRef.current) {
        void saveBatchJobs(pendingBatchJobsRef.current);
        // Sync changed batch jobs to server
        const prev = prevBatchJobsRef.current;
        const prevMap = new Map<string, BatchJob>(prev.map((j) => [j.id, j]));
        for (const j of pendingBatchJobsRef.current) {
          const old = prevMap.get(j.id);
          if (!old || old.updatedAt !== j.updatedAt) {
            syncService.saveBatchJob(j);
          }
        }
        // Detect deleted batch jobs
        const currentIds = new Set(pendingBatchJobsRef.current.map((j) => j.id));
        for (const j of prev) {
          if (!currentIds.has(j.id)) {
            syncService.deleteBatchJob(j.id);
          }
        }
        prevBatchJobsRef.current = pendingBatchJobsRef.current;
        pendingBatchJobsRef.current = null;
      }
    }, 400);
    return () => {
      if (saveBatchJobsTimerRef.current) clearTimeout(saveBatchJobsTimerRef.current);
    };
  }, [batch.batchJobs, hasHydratedStorage]);

  // Flush on beforeunload
  useEffect(() => {
    const flushAll = () => {
      if (saveSessionsTimerRef.current) {
        clearTimeout(saveSessionsTimerRef.current);
        saveSessionsTimerRef.current = null;
      }
      const sessionsToFlush = pendingSessionsRef.current || latestSessionsRef.current;
      if (pendingSessionsRef.current) {
        void saveSessions(pendingSessionsRef.current);
        pendingSessionsRef.current = null;
      }
      backupSessionsSync(sessionsToFlush);
      if (saveBatchJobsTimerRef.current) {
        clearTimeout(saveBatchJobsTimerRef.current);
        saveBatchJobsTimerRef.current = null;
      }
      if (pendingBatchJobsRef.current) {
        void saveBatchJobs(pendingBatchJobsRef.current);
        pendingBatchJobsRef.current = null;
      } else if (latestBatchJobsRef.current.length > 0) {
        void saveBatchJobs(latestBatchJobsRef.current);
      }
    };
    window.addEventListener("beforeunload", flushAll);
    return () => window.removeEventListener("beforeunload", flushAll);
  }, []);

  // Auto-save templates when changed
  useEffect(() => {
    if (!hasHydratedStorage) return;
    void saveTemplates(library.templates);
  }, [library.templates, hasHydratedStorage]);

  // Auto-save models when changed
  useEffect(() => {
    if (!hasHydratedStorage) return;
    void saveModels(library.models);
  }, [library.models, hasHydratedStorage]);

  // Auto-save products when changed
  useEffect(() => {
    if (!hasHydratedStorage) return;
    void saveProducts(library.products);
  }, [library.products, hasHydratedStorage]);

  // Persist advanced panel state
  useEffect(() => {
    try {
      window.localStorage.setItem(ADVANCED_PANEL_STORAGE_KEY, ui.isAdvancedPanelOpen ? "1" : "0");
    } catch {
      // Ignore localStorage write failures
    }
  }, [ui.isAdvancedPanelOpen]);

  // Sync selectedBatchJobId when batchJobs change
  useEffect(() => {
    if (batch.batchJobs.length === 0) {
      if (batch.selectedBatchJobId !== null) {
        batchDispatch({ type: SET_SELECTED_BATCH_JOB_ID, payload: null });
      }
      return;
    }
    if (batch.selectedBatchJobId && batch.batchJobs.some((j) => j.id === batch.selectedBatchJobId)) return;
    batchDispatch({ type: SET_SELECTED_BATCH_JOB_ID, payload: batch.batchJobs[0].id });
  }, [batch.batchJobs, batch.selectedBatchJobId]);

  const contextValue: AppContextType = {
    project,
    projectDispatch,
    batch,
    batchDispatch,
    library,
    libraryDispatch,
    team,
    teamDispatch,
    ui,
    uiDispatch,
    hasHydratedStorage,
  };

  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  );
};

// ——— Custom Hooks ———

export function useAppContext(): AppContextType {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within <AppProvider>');
  return ctx;
}

export function useProjects() {
  const { project, projectDispatch } = useAppContext();
  return { ...project, dispatch: projectDispatch };
}

export function useBatch() {
  const { batch, batchDispatch } = useAppContext();
  return { ...batch, dispatch: batchDispatch };
}

export function useLibrary() {
  const { library, libraryDispatch } = useAppContext();
  return { ...library, dispatch: libraryDispatch };
}

export function useTeam() {
  const { team, teamDispatch } = useAppContext();
  return { ...team, dispatch: teamDispatch };
}

export function useUI() {
  const { ui, uiDispatch } = useAppContext();
  return { ...ui, dispatch: uiDispatch };
}
