import React, { createContext, useContext, useReducer, useEffect, useRef, useMemo, Dispatch } from 'react';
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
  SET_BRAND_KITS,
  REPLACE_IMAGE_URLS,
  REPLACE_BATCH_IMAGE_URLS,
  LOAD_SESSION_MESSAGES,
} from './actions';
import type { Session, SessionSettings, BatchJob, BrandKit } from '@/types';
import { DEFAULT_ASPECT_RATIO, DEFAULT_SYSTEM_TEMPLATES } from '@/constants';
import { getSupportedAspectRatios, getSupportedSizeForAspect } from '@/services/sizeUtils';
import { AspectRatio, ProductScale, CreationWorkflow } from '@/types';

// ——— Helpers ———

const normalizeSessionSettings = (raw: any, defaultTemplate: string): SessionSettings => {
  const aspectRatioValues = getSupportedAspectRatios();
  const productScaleValues = Object.values(ProductScale);
  const workflowValues: CreationWorkflow[] = ['product', 'housing'];
  const aspectRatio = aspectRatioValues.includes(raw?.aspectRatio) ? raw.aspectRatio : DEFAULT_ASPECT_RATIO;
  const batchCountRaw = typeof raw?.batchCount === "number" ? raw.batchCount : 1;
  const batchCount = Math.min(Math.max(Math.round(batchCountRaw), 1), 10);
  const batchSizes = [getSupportedSizeForAspect(aspectRatio)];
  return {
    systemPrompt: typeof raw?.systemPrompt === "string" ? raw.systemPrompt : defaultTemplate,
    aspectRatio,
    selectedModelId: typeof raw?.selectedModelId === "string" ? raw.selectedModelId : null,
    creationWorkflow: workflowValues.includes(raw?.creationWorkflow) ? raw.creationWorkflow : 'product',
    productScale: productScaleValues.includes(raw?.productScale) ? raw.productScale : ProductScale.Standard,
    responseFormat: "url",
    batchCount,
    batchSizes,
    imageSize: raw?.imageSize === "4K" ? "4K" : "1K",
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
  return serverProjects.map((p) => {
    const hasChatHistory = p.chat_history_json != null;
    return {
      id: p.id,
      title: p.title ?? "",
      messages: hasChatHistory ? JSON.parse(p.chat_history_json) : [],
      updatedAt: p.updated_at ?? Date.now(),
      settings: normalizeSessionSettings(
        p.settings_json ? JSON.parse(p.settings_json) : {},
        defaultTemplate,
      ),
      messagesLoaded: hasChatHistory, // false when chat_history_json excluded from list response
    };
  });
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
    messagesLoaded: s.messagesLoaded !== false, // preserve explicit false, default to true
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

function mapServerBrandKits(serverKits: any[]): BrandKit[] {
  return serverKits.map((k: any) => {
    let tasteProfile: BrandKit['tasteProfile'];
    if (k.taste_profile_json) {
      try { tasteProfile = JSON.parse(k.taste_profile_json); } catch { /* ignore */ }
    }
    return {
      id: k.id,
      name: k.name ?? "默认品牌",
      description: k.description ?? undefined,
      styleKeywords: k.style_keywords ? JSON.parse(k.style_keywords) : [],
      colorPalette: k.color_palette_json ? JSON.parse(k.color_palette_json) : [],
      moodKeywords: k.mood_keywords ? JSON.parse(k.mood_keywords) : [],
      isActive: Boolean(k.is_active),
      images: Array.isArray(k.images)
        ? k.images.map((img: any) => ({
            id: img.id,
            blobId: img.blob_id ?? undefined,
            imageUrl: img.blob_id ? `/api/data/blobs/${img.blob_id}` : "",
            imageType: img.image_type ?? "reference",
            sortOrder: img.sort_order ?? 0,
            createdAt: img.created_at ?? Date.now(),
          }))
        : [],
      tasteProfile,
      createdAt: k.created_at ?? Date.now(),
      updatedAt: k.updated_at ?? Date.now(),
    };
  });
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

// ——— Split Contexts (one per reducer + hydration) ———

const ProjectContext = createContext<{ state: ProjectState; dispatch: Dispatch<ProjectAction> } | null>(null);
const BatchContext = createContext<{ state: BatchState; dispatch: Dispatch<BatchAction> } | null>(null);
const LibraryContext = createContext<{ state: LibraryState; dispatch: Dispatch<LibraryAction> } | null>(null);
const TeamContext = createContext<{ state: TeamState; dispatch: Dispatch<TeamAction> } | null>(null);
const UIContext = createContext<{ state: UIState; dispatch: Dispatch<UIAction> } | null>(null);
const HydrationContext = createContext<{ hasHydratedStorage: boolean }>({ hasHydratedStorage: false });

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

  // Queue stats subscription (throttled to max once per 200ms)
  useEffect(() => {
    let lastDispatchTime = 0;
    let pendingStats: any = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = onQueueStateChange((stats) => {
      const now = Date.now();
      if (now - lastDispatchTime >= 200) {
        lastDispatchTime = now;
        uiDispatch({ type: SET_QUEUE_STATS, payload: stats });
      } else {
        pendingStats = stats;
        if (!timerId) {
          timerId = setTimeout(() => {
            timerId = null;
            if (pendingStats) {
              lastDispatchTime = Date.now();
              uiDispatch({ type: SET_QUEUE_STATS, payload: pendingStats });
              pendingStats = null;
            }
          }, 200 - (now - lastDispatchTime));
        }
      }
    });

    return () => {
      unsubscribe();
      if (timerId) clearTimeout(timerId);
    };
  }, []);

  // Register image URL writeback callback on sync service
  useEffect(() => {
    syncService.setOnImagesUploaded((type, id, replacements) => {
      if (type === 'project') {
        projectDispatch({ type: REPLACE_IMAGE_URLS, payload: { sessionId: id, replacements } });
      } else if (type === 'batch') {
        batchDispatch({ type: REPLACE_BATCH_IMAGE_URLS, payload: { jobId: id, replacements } });
      }
    });
  }, []);

  // Lazy-load session messages when switching to a session whose messages haven't been loaded
  useEffect(() => {
    if (!project.currentSessionId || !ui.authUser) return;
    const session = project.sessions.find(s => s.id === project.currentSessionId);
    if (!session || session.messagesLoaded) return;

    let cancelled = false;
    (async () => {
      try {
        const messages = await syncService.pullProjectMessages(project.currentSessionId!);
        if (cancelled) return;
        projectDispatch({
          type: LOAD_SESSION_MESSAGES,
          payload: { sessionId: project.currentSessionId!, messages },
        });
      } catch (e) {
        console.warn('[AppContext] Failed to load session messages:', e);
        // Mark as loaded with empty messages to avoid infinite retry
        if (!cancelled) {
          projectDispatch({
            type: LOAD_SESSION_MESSAGES,
            payload: { sessionId: project.currentSessionId!, messages: [] },
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [project.currentSessionId, ui.authUser]);

  // Bootstrap data after auth — server-first with IndexedDB fallback
  useEffect(() => {
    if (!ui.authReady || !ui.authUser) return;
    let cancelled = false;

    const bootstrap = async () => {
      // Reset tracking refs to prevent cross-user pollution
      prevSessionsRef.current = [];
      latestSessionsRef.current = [];
      prevBatchJobsRef.current = [];
      latestBatchJobsRef.current = [];
      pendingSessionsRef.current = null;
      pendingBatchJobsRef.current = null;
      if (saveSessionsTimerRef.current) {
        clearTimeout(saveSessionsTimerRef.current);
        saveSessionsTimerRef.current = null;
      }
      if (saveBatchJobsTimerRef.current) {
        clearTimeout(saveBatchJobsTimerRef.current);
        saveBatchJobsTimerRef.current = null;
      }
      setHasHydratedStorage(false);

      // Namespace storage per user and initialize (await DB close before opening new)
      await setStorageUserId(ui.authUser!);
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

      // Fetch admin-managed default templates (fallback to hardcoded constants)
      let serverDefaultTemplates: any[] = [];
      try {
        serverDefaultTemplates = await syncService.fetchDefaultTemplates();
      } catch {
        // Fallback to hardcoded defaults if endpoint fails
      }
      const effectiveDefaults = serverDefaultTemplates.length > 0
        ? serverDefaultTemplates.map((t: any) => ({ id: t.id, name: t.name, content: t.content, isFeatured: Boolean(t.is_featured) }))
        : DEFAULT_SYSTEM_TEMPLATES;

      const defaultTemplate = (() => {
        if (serverData && serverData.templates.length > 0) {
          return serverData.templates[0].content ?? "";
        }
        if (effectiveDefaults.length > 0) {
          return effectiveDefaults[0].content ?? "";
        }
        return "";
      })();

      if (serverData) {
        // ——— Server-first path: dispatch server data ———
        console.log("[Bootstrap] 使用服务端数据");

        // Templates: merge admin defaults (first) + user personal templates
        const mappedTemplates = serverData.templates.length > 0
          ? mapServerTemplates(serverData.templates)
          : [];
        const defaultIds = new Set(effectiveDefaults.map((d: any) => d.id));
        const userOnlyTemplates = mappedTemplates.filter((t: any) => !defaultIds.has(t.id));
        const mergedTemplates = [...effectiveDefaults, ...userOnlyTemplates];
        libraryDispatch({ type: SET_TEMPLATES, payload: mergedTemplates });

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

        // Brand Kits
        if (serverData.brandKits && serverData.brandKits.length > 0) {
          libraryDispatch({ type: SET_BRAND_KITS, payload: mapServerBrandKits(serverData.brandKits) });
        }

        // Sessions (projects → sessions)
        const resolvedDefaultTemplate = mergedTemplates.length > 0 ? mergedTemplates[0].content : defaultTemplate;
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
              messagesLoaded: true,
              settings: {
                aspectRatio: ar,
                systemPrompt: resolvedDefaultTemplate,
                selectedModelId: null,
                creationWorkflow: 'product',
                productScale: prefs.productScale ?? ProductScale.Standard,
                responseFormat: "url",
                batchCount: prefs.batchCount ?? 1,
                batchSizes: [getSupportedSizeForAspect(ar)],
                imageSize: "1K" as const,
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
            console.log("[Sync] 服务端无矩阵数据，推送本地矩阵到服务端");
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
            // Merge admin defaults + local templates, push local to server
            const localDefaultIds = new Set(effectiveDefaults.map((d: any) => d.id));
            const localUserOnly = localTemplates.filter((t: any) => !localDefaultIds.has(t.id));
            libraryDispatch({ type: SET_TEMPLATES, payload: [...effectiveDefaults, ...localUserOnly] });
            console.log("[Sync] 服务端无模板数据，推送本地模板到服务端");
            syncService.saveTemplates(localUserOnly);
          }
          // effectiveDefaults already merged via mergedTemplates above
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

        // Merge admin defaults + local templates (dedup by id)
        const localDefaultIds = new Set(effectiveDefaults.map((d: any) => d.id));
        const localUserOnly = loadedTemplates.filter((t: any) => !localDefaultIds.has(t.id));
        const resolvedTemplates = [...effectiveDefaults, ...localUserOnly];
        libraryDispatch({ type: SET_TEMPLATES, payload: resolvedTemplates });
        libraryDispatch({ type: SET_MODELS, payload: loadedModels });
        libraryDispatch({ type: SET_PRODUCTS, payload: loadedProducts });

        if (loadedSessions.length > 0) {
          const fallbackDefaultTemplate = resolvedTemplates.length > 0 ? resolvedTemplates[0].content : "";
          const normalized = normalizeSessions(loadedSessions, fallbackDefaultTemplate);
          projectDispatch({ type: SET_SESSIONS, payload: normalized });
          projectDispatch({ type: SET_CURRENT_SESSION_ID, payload: normalized[0].id });
        } else {
          const fallbackDefaultTemplate = resolvedTemplates.length > 0 ? resolvedTemplates[0].content : '';
          const prefs = loadDefaultPreferences();
          const ar = prefs.aspectRatio ?? DEFAULT_ASPECT_RATIO;
          const newSession: Session = {
            id: uuidv4(),
            title: '新项目',
            messages: [],
            updatedAt: Date.now(),
            messagesLoaded: true,
            settings: {
              aspectRatio: ar,
              systemPrompt: fallbackDefaultTemplate,
              selectedModelId: null,
              creationWorkflow: 'product',
              productScale: prefs.productScale ?? ProductScale.Standard,
              responseFormat: "url",
              batchCount: prefs.batchCount ?? 1,
              batchSizes: [getSupportedSizeForAspect(ar)],
              imageSize: "1K" as const,
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
        // Sync changed sessions to server (skip sessions whose messages haven't been loaded yet)
        const prev = prevSessionsRef.current;
        const prevMap = new Map<string, Session>(prev.map((s) => [s.id, s]));
        for (const s of pendingSessionsRef.current) {
          if (s.messagesLoaded === false) continue; // don't overwrite server data with empty messages
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
    }, 2000);
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
    }, 2000);
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
      if (pendingSessionsRef.current) {
        void saveSessions(pendingSessionsRef.current);
        pendingSessionsRef.current = null;
      }
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

  // Sync brand kits to server when changed
  const prevBrandKitsRef = useRef<BrandKit[]>([] as BrandKit[]);
  useEffect(() => {
    if (!hasHydratedStorage) return;
    const prev = prevBrandKitsRef.current;
    const prevMap = new Map<string, BrandKit>(prev.map((k) => [k.id, k]));
    for (const k of library.brandKits) {
      const old = prevMap.get(k.id);
      if (!old || old.updatedAt !== k.updatedAt) {
        syncService.saveBrandKit(k);
      }
    }
    const currentIds = new Set(library.brandKits.map((k) => k.id));
    for (const k of prev) {
      if (!currentIds.has(k.id)) {
        syncService.deleteBrandKit(k.id);
      }
    }
    prevBrandKitsRef.current = library.brandKits;
  }, [library.brandKits, hasHydratedStorage]);

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

  // Memoize each context value so it only changes when the relevant state changes.
  // dispatch functions from useReducer are stable (React guarantees this).
  const projectCtx = useMemo(() => ({ state: project, dispatch: projectDispatch }), [project]);
  const batchCtx = useMemo(() => ({ state: batch, dispatch: batchDispatch }), [batch]);
  const libCtx = useMemo(() => ({ state: library, dispatch: libraryDispatch }), [library]);
  const teamCtx = useMemo(() => ({ state: team, dispatch: teamDispatch }), [team]);
  const uiCtx = useMemo(() => ({ state: ui, dispatch: uiDispatch }), [ui]);
  const hydrationCtx = useMemo(() => ({ hasHydratedStorage }), [hasHydratedStorage]);

  return (
    <HydrationContext.Provider value={hydrationCtx}>
      <UIContext.Provider value={uiCtx}>
        <ProjectContext.Provider value={projectCtx}>
          <BatchContext.Provider value={batchCtx}>
            <LibraryContext.Provider value={libCtx}>
              <TeamContext.Provider value={teamCtx}>
                {children}
              </TeamContext.Provider>
            </LibraryContext.Provider>
          </BatchContext.Provider>
        </ProjectContext.Provider>
      </UIContext.Provider>
    </HydrationContext.Provider>
  );
};

// ——— Custom Hooks ———

/** Compatibility hook — reads from all 5 split contexts. Prefer individual hooks for performance. */
export function useAppContext() {
  const project = useContext(ProjectContext);
  const batch = useContext(BatchContext);
  const library = useContext(LibraryContext);
  const team = useContext(TeamContext);
  const ui = useContext(UIContext);
  const { hasHydratedStorage } = useContext(HydrationContext);

  if (!project || !batch || !library || !team || !ui) {
    throw new Error('useAppContext must be used within <AppProvider>');
  }

  return {
    project: project.state,
    projectDispatch: project.dispatch,
    batch: batch.state,
    batchDispatch: batch.dispatch,
    library: library.state,
    libraryDispatch: library.dispatch,
    team: team.state,
    teamDispatch: team.dispatch,
    ui: ui.state,
    uiDispatch: ui.dispatch,
    hasHydratedStorage,
  };
}

export function useProjects() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProjects must be used within AppProvider');
  return useMemo(() => ({ ...ctx.state, dispatch: ctx.dispatch }), [ctx.state, ctx.dispatch]);
}

export function useBatch() {
  const ctx = useContext(BatchContext);
  if (!ctx) throw new Error('useBatch must be used within AppProvider');
  return useMemo(() => ({ ...ctx.state, dispatch: ctx.dispatch }), [ctx.state, ctx.dispatch]);
}

export function useLibrary() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used within AppProvider');
  return useMemo(() => ({ ...ctx.state, dispatch: ctx.dispatch }), [ctx.state, ctx.dispatch]);
}

export function useTeam() {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error('useTeam must be used within AppProvider');
  return useMemo(() => ({ ...ctx.state, dispatch: ctx.dispatch }), [ctx.state, ctx.dispatch]);
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used within AppProvider');
  return useMemo(() => ({ ...ctx.state, dispatch: ctx.dispatch }), [ctx.state, ctx.dispatch]);
}

export function useHydration() {
  return useContext(HydrationContext);
}
