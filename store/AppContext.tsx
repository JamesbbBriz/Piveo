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
  saveTemplates,
  saveModels,
  saveProducts,
  setStorageUserId,
  saveCurrentSessionId,
  loadCurrentSessionId,
} from '@/services/storage';
import { syncService, type SyncStatus } from '@/services/sync';
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
  SET_SESSION_MESSAGES_LOAD_ERROR,
  SET_SYNC_STATUS,
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
    imageSize: raw?.imageSize === "4K" ? "4K" : raw?.imageSize === "1K" ? "1K" : "2K",
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
  syncStatus: { pending: 0, failed: 0, lastError: null, lastSyncedAt: null, quotaExceeded: false },
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
    const sessionId = project.currentSessionId;

    // 指数回退重试：1s → 3s → 10s，最多 3 次。**拒绝**在失败时把 messagesLoaded 置 true
    // 且 messages=[]——那会让已有服务器历史的 session 在客户端看起来被"清空"，
    // 配合 UPDATE_SESSION 的 auto-save 会把空数组写回（虽有 sync guard 拦住，但 UI 仍
    // 显示空）。让用户/effect 有机会重试，直到拿到真实数据。
    const delays = [0, 1000, 3000, 10000];
    let attempt = 0;

    const tryLoad = async (): Promise<void> => {
      try {
        const messages = await syncService.pullProjectMessages(sessionId);
        if (cancelled) return;
        projectDispatch({
          type: LOAD_SESSION_MESSAGES,
          payload: { sessionId, messages },
        });
      } catch (e) {
        if (cancelled) return;
        attempt += 1;
        const nextDelay = delays[attempt];
        if (typeof nextDelay === "number") {
          console.warn(
            `[AppContext] Failed to load session messages (attempt ${attempt}/${delays.length - 1}), retry in ${nextDelay}ms:`,
            e
          );
          setTimeout(() => {
            if (!cancelled) void tryLoad();
          }, nextDelay);
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(
            `[AppContext] Giving up loading session messages after ${attempt} attempts. messagesLoaded=false 保留，UI 会显示错误条供用户重试。`,
            e
          );
          // 上报错误给 UI 渲染错误条；不 dispatch LOAD_SESSION_MESSAGES 避免空数组覆盖。
          projectDispatch({
            type: SET_SESSION_MESSAGES_LOAD_ERROR,
            payload: { sessionId, error: msg || "网络异常，加载会话历史失败" },
          });
        }
      }
    };

    // 首次立即触发，后续由失败路径自己 schedule
    void tryLoad();
    return () => { cancelled = true; };
    // 依赖 messageLoadAttempts[sessionId]：用户点"重新加载"时 reducer bump 这个数，
    // effect 重跑 → 重新拉取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.currentSessionId, ui.authUser, project.messageLoadAttempts[project.currentSessionId ?? ""]]);

  // Bootstrap data after auth — server is the source of truth.
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

      // Namespace small local state per user and purge legacy heavy browser storage.
      await setStorageUserId(ui.authUser!);
      await initPersistentStorage();
      syncService.init(ui.authUser!);

      // 恢复上次刷新前选中的 session id；bootstrap 把它一并传给 pullAll，
      // 一次往返就能把当前会话的 messages 拿回来，避免首屏空白依赖二次 lazy-load。
      const restoredSessionId = loadCurrentSessionId();

      // Try server-first pull with 5s timeout
      let serverData: Awaited<ReturnType<typeof syncService.pullAll>> | null = null;
      try {
        serverData = await Promise.race([
          syncService.pullAll(restoredSessionId),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("pullAll timeout")), 5000)),
        ]);
      } catch (err) {
        console.warn("[Bootstrap] 服务端拉取失败，本地重数据持久化已停用：", err);
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
          // 把 pullAll 顺带拉到的活跃会话 messages 就地装填，避免再触发一次 lazy-load。
          // 只在请求成功（!== null）时覆盖，失败时保持 messagesLoaded=false 让 lazy-load 兜底。
          let hydratedSessions = mappedSessions;
          if (restoredSessionId && Array.isArray(serverData.activeSessionMessages)) {
            const activeMsgs = serverData.activeSessionMessages;
            hydratedSessions = mappedSessions.map((s) =>
              s.id === restoredSessionId
                ? { ...s, messages: activeMsgs, messagesLoaded: true }
                : s
            );
          }
          const normalized = normalizeSessions(hydratedSessions, resolvedDefaultTemplate);
          projectDispatch({ type: SET_SESSIONS, payload: normalized });
          // 恢复上次选中的 session；如果它已经被删/换号了就退回第一个
          const initialId = restoredSessionId && normalized.some((s) => s.id === restoredSessionId)
            ? restoredSessionId
            : normalized[0].id;
          projectDispatch({ type: SET_CURRENT_SESSION_ID, payload: initialId });
          prevSessionsRef.current = normalized;
        } else {
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
              imageSize: "2K" as const,
              autoUseLastImage: true,
              productImage: null,
            },
          };
          projectDispatch({ type: SET_SESSIONS, payload: [newSession] });
          projectDispatch({ type: SET_CURRENT_SESSION_ID, payload: newSession.id });
          prevSessionsRef.current = [newSession];
        }

        // Batch Jobs
        if (serverData.batchJobs.length > 0) {
          const mappedBatchJobs = mapServerBatchJobsToFrontend(serverData.batchJobs);
          batchDispatch({ type: SET_BATCH_JOBS, payload: mappedBatchJobs });
          batchDispatch({ type: SET_SELECTED_BATCH_JOB_ID, payload: mappedBatchJobs[0]?.id || null });
          prevBatchJobsRef.current = mappedBatchJobs;
        }

      } else {
        libraryDispatch({ type: SET_TEMPLATES, payload: effectiveDefaults });
        libraryDispatch({ type: SET_MODELS, payload: [] });
        libraryDispatch({ type: SET_PRODUCTS, payload: [] });
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
            systemPrompt: defaultTemplate,
            selectedModelId: null,
            creationWorkflow: 'product',
            productScale: prefs.productScale ?? ProductScale.Standard,
            responseFormat: "url",
            batchCount: prefs.batchCount ?? 1,
            batchSizes: [getSupportedSizeForAspect(ar)],
            imageSize: "2K" as const,
            autoUseLastImage: true,
            productImage: null,
          },
        };
        projectDispatch({ type: SET_SESSIONS, payload: [newSession] });
        projectDispatch({ type: SET_CURRENT_SESSION_ID, payload: newSession.id });
        prevSessionsRef.current = [newSession];
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

  // 把 currentSessionId 落盘，刷新后 bootstrap 会 loadCurrentSessionId 恢复，
  // 防止"刷新后被甩到第一个 session、上一刻在编辑的会话像消失了"。
  // 等 hydration 完成再写，避免 bootstrap 自己 dispatch 时反向覆盖刚恢复的值。
  useEffect(() => {
    if (!hasHydratedStorage) return;
    saveCurrentSessionId(project.currentSessionId);
  }, [project.currentSessionId, hasHydratedStorage]);

  // 后台预取所有未加载会话的 messages，错开时序，命中速率限制就回退；
  // 失败的不上报错误条（错误条只为"用户当前会话"服务），仅静默重试一次。
  // 预期效果：用户切换会话时无需等待 lazy-load 往返。
  useEffect(() => {
    if (!hasHydratedStorage || !ui.authUser) return;
    const unloaded = project.sessions.filter((s) => s.messagesLoaded === false);
    if (unloaded.length === 0) return;

    let cancelled = false;
    const idle = (cb: () => void): number => {
      const w = window as any;
      if (typeof w.requestIdleCallback === "function") return w.requestIdleCallback(cb, { timeout: 3000 });
      return window.setTimeout(cb, 200);
    };
    const cancelIdle = (handle: number) => {
      const w = window as any;
      if (typeof w.cancelIdleCallback === "function") w.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };

    let idleHandle = 0;
    const prefetch = async () => {
      // 串行 + 间隔，避免突刺触发上游 429
      for (const s of unloaded) {
        if (cancelled) return;
        // 用户已经手动切到这个 session 时跳过，让前台 lazy-load 拿主动权（避免双重请求）。
        if (s.id === project.currentSessionId) continue;
        try {
          const messages = await syncService.pullProjectMessages(s.id);
          if (cancelled) return;
          projectDispatch({ type: LOAD_SESSION_MESSAGES, payload: { sessionId: s.id, messages } });
        } catch (e) {
          // 预取失败不弹错误条，等用户真切到这个 session 时 lazy-load 再试
          console.warn(`[Prefetch] session ${s.id} 预取失败，跳过：`, e);
        }
        // 每个之间停 250ms，给主线程让路
        await new Promise((r) => setTimeout(r, 250));
      }
    };

    idleHandle = idle(() => {
      void prefetch();
    });

    return () => {
      cancelled = true;
      if (idleHandle) cancelIdle(idleHandle);
    };
    // 只在 sessions 列表本身变化时触发；messageLoadAttempts/Errors 的变化不需要重跑预取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydratedStorage, ui.authUser, project.sessions]);

  // 服务器同步保留 2s debounce —— 浏览器本地不再持久化 sessions。
  useEffect(() => {
    if (!hasHydratedStorage) return;
    pendingSessionsRef.current = project.sessions;
    if (saveSessionsTimerRef.current) clearTimeout(saveSessionsTimerRef.current);
    saveSessionsTimerRef.current = setTimeout(() => {
      saveSessionsTimerRef.current = null;
      if (pendingSessionsRef.current) {
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

  // 服务器同步保留 2s debounce —— 浏览器本地不再持久化 batch jobs。
  useEffect(() => {
    if (!hasHydratedStorage) return;
    pendingBatchJobsRef.current = batch.batchJobs;
    if (saveBatchJobsTimerRef.current) clearTimeout(saveBatchJobsTimerRef.current);
    saveBatchJobsTimerRef.current = setTimeout(() => {
      saveBatchJobsTimerRef.current = null;
      if (pendingBatchJobsRef.current) {
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

  // Flush pending server sync timers on beforeunload / pagehide.
  // 不再写 localStorage/IndexedDB emergency backup，避免大图再次撑爆浏览器配额。
  useEffect(() => {
    const flushAll = () => {
      if (saveSessionsTimerRef.current) {
        clearTimeout(saveSessionsTimerRef.current);
        saveSessionsTimerRef.current = null;
      }
      if (pendingSessionsRef.current) {
        for (const s of pendingSessionsRef.current) {
          if (s.messagesLoaded !== false) syncService.saveProject(s);
        }
        pendingSessionsRef.current = null;
      }
      if (saveBatchJobsTimerRef.current) {
        clearTimeout(saveBatchJobsTimerRef.current);
        saveBatchJobsTimerRef.current = null;
      }
      if (pendingBatchJobsRef.current) {
        for (const j of pendingBatchJobsRef.current) {
          syncService.saveBatchJob(j);
        }
        pendingBatchJobsRef.current = null;
      }
    };
    window.addEventListener("beforeunload", flushAll);
    window.addEventListener("pagehide", flushAll);
    return () => {
      window.removeEventListener("beforeunload", flushAll);
      window.removeEventListener("pagehide", flushAll);
    };
  }, []);

  // ③ 订阅 sync 状态，dispatch 给 uiReducer，UI 渲染 "未同步：N 项"
  // 同时把最新 status 缓存到 ref，beforeunload 拦截要用
  const latestSyncStatusRef = useRef<SyncStatus>({
    pending: 0, failed: 0, lastError: null, lastSyncedAt: null, quotaExceeded: false,
  });
  useEffect(() => {
    syncService.setOnSyncStatusChange((status: SyncStatus) => {
      latestSyncStatusRef.current = status;
      uiDispatch({ type: SET_SYNC_STATUS, payload: status });
    });
  }, []);

  // Option F：当还有未同步内容时，beforeunload 弹浏览器原生确认对话框，
  // 让用户主动选择是否离开，避免"误关 tab → 数据进 emergency backup → 下次清缓存才发现丢"。
  // 检测条件：syncQueue 有 pending、有 failed 残留、或 debounce timer 还没 flush（最致命的场景）。
  useEffect(() => {
    const guardUnload = (e: BeforeUnloadEvent) => {
      const status = latestSyncStatusRef.current;
      const hasDebounceLag =
        pendingSessionsRef.current !== null || pendingBatchJobsRef.current !== null;
      if (status.pending > 0 || status.failed > 0 || hasDebounceLag) {
        // 现代浏览器已经忽略自定义文案，只显示通用 "Leave site?" 弹窗——
        // 但 returnValue 必须设为非空字符串才会触发对话框。
        e.preventDefault();
        e.returnValue = "有内容尚未保存到服务器，确认离开吗？";
        return e.returnValue;
      }
      return undefined;
    };
    window.addEventListener("beforeunload", guardUnload);
    return () => window.removeEventListener("beforeunload", guardUnload);
  }, []);

  // ⑥ 多 tab 防覆盖：另一个 tab 保存了同 session 时收到广播，
  // 立即从服务器 refetch messages，让本 tab 拿到最新版，再编辑就不会覆盖。
  useEffect(() => {
    syncService.setOnRemoteProjectChanged(async (sessionId: string) => {
      const exists = latestSessionsRef.current.some((s) => s.id === sessionId);
      if (!exists) return;
      try {
        const messages = await syncService.pullProjectMessages(sessionId);
        projectDispatch({ type: LOAD_SESSION_MESSAGES, payload: { sessionId, messages } });
      } catch (e) {
        console.warn(`[Multi-tab] refetch session ${sessionId} 失败：`, e);
      }
    });
  }, []);

  // ④ Bootstrap 完成后扫描"上次 sync 失败"的 project/batchJob ID，
  // 从最新 React state 找到对应实体重新提交。
  // 同时定时（5 分钟）轮询，覆盖"用户开着不动但失败的项目还没 retry"的场景。
  useEffect(() => {
    if (!hasHydratedStorage || !ui.authUser) return;

    const retryPending = () => {
      const pendingProjectIds = syncService.getPendingProjectIds();
      const pendingJobIds = syncService.getPendingBatchJobIds();
      if (pendingProjectIds.length === 0 && pendingJobIds.length === 0) return;

      // 用 latestRef 而不是闭包里的 project.sessions，确保拿到最新数据
      const sessionMap = new Map<string, Session>(latestSessionsRef.current.map((s) => [s.id, s]));
      const jobMap = new Map<string, BatchJob>(latestBatchJobsRef.current.map((j) => [j.id, j]));

      let dispatched = 0;
      for (const id of pendingProjectIds) {
        const s = sessionMap.get(id);
        if (s && s.messagesLoaded === true) {
          syncService.saveProject(s);
          dispatched++;
        }
      }
      for (const id of pendingJobIds) {
        const j = jobMap.get(id);
        if (j) {
          syncService.saveBatchJob(j);
          dispatched++;
        }
      }
      if (dispatched > 0) {
        console.log(`[Sync] 重试 ${dispatched} 个 bootstrap/idle 阶段未同步的实体`);
      }
    };

    // 启动后稍等让 bootstrap 数据稳定，再做第一次 retry
    const initialTimer = setTimeout(retryPending, 4000);
    const intervalTimer = setInterval(retryPending, 5 * 60 * 1000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    };
  }, [hasHydratedStorage, ui.authUser]);

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
