
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ImagePreviewModal } from './components/ImagePreviewModal';
import { Icon } from './components/Icon';
import { AspectRatio, BatchJob, BatchJobStatus, BatchSceneType, BatchSlot, BatchVersion, BrandKit, ImageResponseFormat, ProductScale, Message, Session, SessionSettings, SystemTemplate, ModelCharacter, ProductCatalogItem } from './types';
import { clearAll } from './services/storage';
import { generateResponse, enhancePrompt, type GenerateResponseResult } from './services/gemini';
import { DEFAULT_ASPECT_RATIO } from './constants';
import { ApiConfig, getEffectiveApiConfig, saveStoredApiConfig } from './services/apiConfig';
import { DefaultPreferences, loadDefaultPreferences, saveDefaultPreferences, SettingsPanel } from './components/SettingsPanel';
import { AssetsModal, type AssetItem } from './components/AssetsModal';
import { type ErrorDetails } from './components/ErrorDetailsModal';
import { MaskEditorModal, type MaskEditorHistoryItem } from './components/MaskEditorModal';
import { imagesEdits, imagesGenerations, imageObjToDataUrl, ResponseFormat } from './services/openaiImages';
import { filterSizesByAspect, getSupportedAspectRatios, getSupportedSizeForAspect } from './services/sizeUtils';
import { login, logout } from './services/auth';
import { BatchSetItem, BatchSetModal } from './components/BatchSetModal';
import { BatchJobsPanel } from './components/BatchJobsPanel';
import { downloadImageWithFormat, loadDownloadOptions } from './services/imageDownload';
import { ModelsLibraryModal } from './components/ModelsLibraryModal';
import { ProductsLibraryModal } from './components/ProductsLibraryModal';
import { urlToDataUrl } from './services/imageData';
import { AppProvider, useProjects, useBatch, useLibrary, useTeam, useUI, useAppContext } from './store/AppContext';
import { syncService } from './services/sync';
import { TeamManager } from './components/TeamManager';
import { AdminPanel } from './components/AdminPanel';
import { Layout } from './components/Layout';
import { MainContent } from './components/MainContent';
import { PropertyPanel } from './components/PropertyPanel';
import { PromptBar } from './components/PromptBar';
import { extractImagesFromSession } from './services/projectUtils';
import { ImageGallery } from './components/ImageGallery';
import { RefinePanel } from './components/RefinePanel';
import { SwapModelModal } from './components/SwapModelModal';
import { BrandKitPanel } from './components/BrandKitPanel';
import { BeforeAfterView } from './components/BeforeAfterView';
import { exportComparison } from './services/comparisonExport';
import { ToastProvider } from './components/Toast';
import { VideoGenerationPage } from './components/video/VideoGenerationPage';
import type { GeneratedImage, ImageRating } from './types';
import {
  SET_SESSIONS,
  SET_CURRENT_SESSION_ID,
  ADD_SESSION,
  UPDATE_SESSION,
  SET_BATCH_JOBS,
  ADD_BATCH_JOB,
  UPDATE_BATCH_JOB,
  SET_SELECTED_BATCH_JOB_ID,
  SET_BATCH_GENERATING,
  SET_BATCH_GENERATION_PROGRESS,
  SET_REFINING_SLOT_IDS,
  SET_MODELS,
  ADD_MODEL,
  UPDATE_MODEL,
  DELETE_MODEL,
  SET_PRODUCTS,
  ADD_PRODUCT,
  UPDATE_PRODUCT,
  DELETE_PRODUCT,
  SET_TEMPLATES,
  SET_GENERATING,
  SET_GENERATION_STAGE,
  SET_GENERATION_PROGRESS,
  SET_ENHANCING,
  SET_PREVIEW_IMAGE,
  SET_ERROR_DETAILS,
  SET_MASK_EDIT_CONTEXT,
  SET_ADVANCED_PANEL_OPEN,
  SET_QUEUE_STATS,
  SET_CURRENT_VIEW,
  SET_INPUT_TEXT,
  SET_SELECTED_IMAGE,
  SET_REFERENCE_INTENT,
  SET_API_CONFIG,
  SET_DEFAULT_PREFERENCES,
  SET_AUTH_USER,
  SET_AUTH_READY,
  SET_AUTH_LOADING,
  ADD_TEAM,
  DELETE_TEAM,
  UPDATE_TEAM,
  SET_CURRENT_TEAM_ID,
  ADD_BRAND_KIT,
  UPDATE_BRAND_KIT,
  DELETE_BRAND_KIT,
  SET_ACTIVE_BRAND_KIT,
  ADD_BRAND_TASTE_RATING,
  REMOVE_BRAND_TASTE_RATING,
  SET_BRAND_TASTE_RATINGS,
  SET_BRAND_TASTE_PROFILE,
} from './store/actions';

const aspectRatioToSize = (aspectRatio: AspectRatio | string): string => {
  return getSupportedSizeForAspect(aspectRatio);
};

const isAbortError = (e: any): boolean => e?.name === "AbortError";

const extractRequestId = (message: string): string | undefined => {
  const m = /request id:\s*([^\s\)]+)/i.exec(message);
  return m?.[1];
};

const extractHttpStatus = (message: string): number | undefined => {
  const m = /HTTP\s+(\d{3})/i.exec(message);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

const isLikelyModelUnsupported = (message: string): boolean =>
  /not supported model for image generation/i.test(message) ||
  /unsupported model/i.test(message) ||
  /模型.*不支持.*(图片|生图)/i.test(message);

const isLikelyMissingAuth = (message: string): boolean =>
  /missing|缺少|invalid.*auth|unauthorized|401|鉴权|authorization|未登录|登录失效/i.test(message);

const isLikelyCorsOrNetwork = (message: string): boolean =>
  /cors|network|failed to fetch|网络错误|预检/i.test(message);

const isLikelyGatewayTimeout = (message: string): boolean =>
  /http\s*504|gateway time-?out|error code 504|上游网关超时/i.test(message);

const isLikelyQueueBusy = (message: string): boolean =>
  /队列繁忙|排队|queue.*busy|队列等待超时|429/i.test(message);

const isLikelyMixedImageInput = (message: string): boolean =>
  /请只使用一种图片输入方式|one image input|url or base64|文件上传、URL 或 base64/i.test(message);

const getFriendlyErrorMessage = (message: string): string => {
  if (isLikelyQueueBusy(message)) return "当前生成请求较多，任务已被限流保护，请稍后重试。";
  if (isLikelyModelUnsupported(message)) return "当前模型不支持生图，请切换到可用图片模型后重试。";
  if (isLikelyMixedImageInput(message)) return "本次请求混用了 URL 和 base64 图片，已触发网关限制。请重试（系统将自动按单一格式发送）。";
  if (isLikelyGatewayTimeout(message)) return "上游网关超时（504），请重试或切换更快模型。";
  if (isLikelyMissingAuth(message)) return "未登录或会话已失效，请重新登录后重试。";
  if (isLikelyCorsOrNetwork(message)) return "网络或跨域错误，请优先使用 `/api` 代理地址。";
  return `生成失败：${message}`;
};

const getErrorAdvice = (message: string): string[] => {
  if (isLikelyQueueBusy(message)) {
    return [
      "当前是保护性限流，不是模型故障。",
      "请等待几秒后重试，系统会自动恢复队列处理。",
      "如需更稳定，可先把默认生成数量调低后再逐步放大。",
    ];
  }
  if (isLikelyModelUnsupported(message)) {
    return [
      "在左下角模型选择器切换为可用图片模型。",
      "推荐先用 gemini-2.5-flash-image-preview 或 gpt-image-1.5。",
      "如果走公网地址失败，改成 /api 并在 .env.local 配置 VITE_API_PROXY_TARGET=https://n.lconai.com。",
    ];
  }
  if (isLikelyGatewayTimeout(message)) {
    return [
      "这是上游服务超时，不是账号配置错误，先直接重试一次。",
      "把尺寸先设为 1:1（1024x1024）、每次生成张数设为 1，可显著降低超时概率。",
      "可切换到更快模型（如 gemini-2.5-flash-image-preview）。",
      "若你用 Cloudflare 代理站点，长请求可能被 100 秒限制中断，生产建议给应用域名关闭代理（DNS only）。",
    ];
  }
  if (isLikelyMixedImageInput(message)) {
    return [
      "你这次同时带了 URL 图和 base64 图，网关会直接拒绝（HTTP 400）。",
      "重新发送一次即可，系统会自动只保留一种图片输入方式。",
      "若你开启连续编辑并锁定模特，建议先上传同类型参考图后再生成。",
    ];
  }
  if (isLikelyMissingAuth(message)) {
    return [
      "先重新登录，确认右上角已显示当前账号。",
      "检查认证服务是否运行（开发环境默认 http://localhost:3101）。",
      "如果是服务端报错，检查服务端环境变量 UPSTREAM_AUTHORIZATION 是否已配置。",
    ];
  }
  if (isLikelyCorsOrNetwork(message)) {
    return [
      "先检查应用服务器到上游网关的网络连通性与超时情况。",
      "生产环境通常不是 CORS，优先排查反向代理与上游稳定性。",
      "确认服务端环境变量 UPSTREAM_API_BASE_URL / UPSTREAM_AUTHORIZATION 正确。",
    ];
  }
  return [
    "先点击「查看错误详情」复制诊断信息。",
    "检查模型、令牌和网络配置是否正确。",
  ];
};

const hashString = (input: string): string => {
  const sample = input.slice(0, 1000);
  let h = 2166136261;
  for (let i = 0; i < sample.length; i++) {
    h ^= sample.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
};

const isDataOrBlobUrl = (url: string): boolean => /^data:|^blob:/i.test(String(url || ""));

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
    reader.readAsDataURL(blob);
  });

const findLastImageUrl = (messages: Message[]): string | null => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    for (let j = msg.parts.length - 1; j >= 0; j--) {
      const p = msg.parts[j];
      if (p.type === "image" && p.imageUrl) return p.imageUrl;
    }
  }
  return null;
};

const QUICK_PROMPT_PRESETS = [
  "电商白底，产品边缘清晰、无噪点。",
  "高级棚拍光效，肤色自然，细节锐利。",
  "保持人物一致，仅优化配件细节。",
  "把产品再缩小 20%，更纤细。",
  "把产品放大 20%，更突出主体。",
];

const getBatchSceneDirective = (scene: BatchSetItem["scene"]): string => {
  if (scene === "model") return "产出模特展示图，突出穿戴/持物效果，人物姿态自然。";
  if (scene === "flatlay") return "产出平铺图，无人物干扰，重点展示产品轮廓、材质和完整结构。";
  if (scene === "detail") return "产出细节特写图，聚焦工艺、纹理、缝线或关键局部。";
  if (scene === "white") return "产出纯净白底电商图，产品边缘清晰、背景干净、无杂物。";
  return "按自定义描述产出画面。";
};

const mapSlotStatusToJobStatus = (slots: BatchSlot[]): BatchJobStatus => {
  if (slots.length === 0) return "draft";
  if (slots.some((s) => s.status === "running")) return "running";
  if (slots.some((s) => s.status === "failed")) {
    const allDoneOrFail = slots.every((s) => s.status === "completed" || s.status === "failed");
    return allDoneOrFail ? "failed" : "running";
  }
  if (slots.every((s) => s.status === "completed")) return "completed";
  if (slots.every((s) => s.status === "pending")) return "draft";
  return "running";
};

const nowTs = () => Date.now();

const createNewSession = (templates: SystemTemplate[], prefs?: DefaultPreferences): Session => {
  const defaultTemplate = templates.length > 0 ? templates[0].content : '';
  const ar = prefs?.aspectRatio ?? DEFAULT_ASPECT_RATIO;
  const ps = prefs?.productScale ?? ProductScale.Standard;
  const bc = prefs?.batchCount ?? 1;
  return {
    id: uuidv4(),
    title: '新项目',
    messages: [],
    updatedAt: Date.now(),
    settings: {
      aspectRatio: ar,
      systemPrompt: defaultTemplate,
      selectedModelId: null,
      creationWorkflow: "product",
      productScale: ps,
      responseFormat: "url",
      batchCount: bc,
      batchSizes: [getSupportedSizeForAspect(ar)],
      autoUseLastImage: true,
      productImage: null,
    }
  };
};

const AppInner: React.FC = () => {
  // ——— Store hooks ———
  const { sessions, currentSessionId, dispatch: projectDispatch } = useProjects();
  const { batchJobs, selectedBatchJobId, isBatchGenerating, batchGenerationProgress, refiningSlotIds, dispatch: batchDispatch } = useBatch();
  const { models, products, templates, brandKits, dispatch: libraryDispatch } = useLibrary();
  const { teams, currentTeamId, dispatch: teamDispatch } = useTeam();
  const {
    isGenerating, generationStage, generationProgress, isEnhancing,
    previewImageUrl, errorDetails, maskEditContext, isAdvancedPanelOpen,
    queueStats, currentView, inputText, selectedImage, referenceIntent, apiConfig, defaultPreferences,
    authUser, authReady, authLoading, isSuperAdmin,
    dispatch: uiDispatch,
  } = useUI();
  const { hasHydratedStorage } = useAppContext();

  // ——— Local UI state (not worth putting in store) ———
  const [navView, setNavView] = useState<string>('project');
  const [isErrorExpanded, setIsErrorExpanded] = useState(false);
  const [isBatchSetOpen, setIsBatchSetOpen] = useState(false);
  const [addSlotsTargetJobId, setAddSlotsTargetJobId] = useState<string | null>(null);
  const [maskEditBaseUrl, setMaskEditBaseUrl] = useState<string | null>(null);
  const [balanceRefreshTick, setBalanceRefreshTick] = useState(0);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [selectedGalleryImageId, setSelectedGalleryImageId] = useState<string | null>(null);
  const [refineTarget, setRefineTarget] = useState<{ imageUrl: string; prompt?: string } | null>(null);
  const [swapModelTarget, setSwapModelTarget] = useState<{ imageUrl: string; prompt?: string } | null>(null);
  const [compareState, setCompareState] = useState<{ beforeUrl: string; afterUrl: string } | null>(null);

  // ——— Refs ———
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const batchAbortRef = useRef<AbortController | null>(null);
  const autoStartBatchJobIdRef = useRef<string | null>(null);
  const sessionAssetCountCacheRef = useRef<Map<string, { messagesRef: Message[]; count: number }>>(new Map());
  const batchAssetCountCacheRef = useRef<Map<string, { slotsRef: BatchSlot[]; count: number }>>(new Map());
  const lastRunRef = useRef<{
    prompt: string;
    image: string | null;
    customMessages?: Message[];
    opts?: {
      action?: string;
      extraImages?: string[];
      sizes?: string[];
      batchCountOverride?: number;
      forceNoAutoReuse?: boolean;
      queueSource?: "chat" | "batch" | "mask-edit" | "model-gen";
    };
  } | null>(null);

  // ——— Derived state ———
  const currentSession = sessions.find(s => s.id === currentSessionId) || sessions[0];
  const currentMessageCount = currentSession?.messages.length || 0;
  const selectedBatchJob = useMemo(
    () => batchJobs.find((j) => j.id === selectedBatchJobId) || batchJobs[0] || null,
    [batchJobs, selectedBatchJobId]
  );
  const queueStatusText = useMemo(() => {
    if (!queueStats) return null;
    if (queueStats.state === "PAUSED_UNTIL" && queueStats.pausedUntil) {
      const waitSec = Math.max(1, Math.ceil((queueStats.pausedUntil - Date.now()) / 1000));
      return `上游限流，队列将在 ${waitSec} 秒后自动恢复`;
    }
    if (queueStats.state === "DEGRADED") {
      return `保护模式：并发已降为 ${queueStats.maxInFlight}（错误率 ${(queueStats.metrics.errorRate * 100).toFixed(0)}%）`;
    }
    if (queueStats.pending > 0) {
      return `排队中：${queueStats.pending} 个任务等待，当前并发 ${queueStats.maxInFlight}`;
    }
    if (queueStats.inFlight > 0) {
      return `调度中：并发 ${queueStats.maxInFlight}，在途 ${queueStats.inFlight}`;
    }
    return `调度器就绪：并发 ${queueStats.maxInFlight}`;
  }, [queueStats]);

  const maskHistoryItems = useMemo<MaskEditorHistoryItem[]>(() => {
    if (maskEditContext?.source === "batch") {
      const fromContext = Array.isArray(maskEditContext.historyItems) ? maskEditContext.historyItems : [];
      if (maskEditBaseUrl && !fromContext.some((i) => i.imageUrl === maskEditBaseUrl)) {
        return [
          {
            id: `mask-current-${hashString(maskEditBaseUrl)}`,
            imageUrl: maskEditBaseUrl,
            title: "当前编辑图",
            subtitle: "未进入历史",
          },
          ...fromContext,
        ];
      }
      return fromContext;
    }
    if (!currentSession) return [];
    const seen = new Set<string>();
    const items: MaskEditorHistoryItem[] = [];

    for (let mi = currentSession.messages.length - 1; mi >= 0; mi--) {
      const m = currentSession.messages[mi];
      if (m.role !== "model") continue;
      const messageAction = m.parts.find((p) => p.type === "text" && p.text?.startsWith("操作："))?.text?.replace("操作：", "").trim();
      for (let pi = m.parts.length - 1; pi >= 0; pi--) {
        const p = m.parts[pi];
        if (p.type !== "image" || !p.imageUrl) continue;
        if (seen.has(p.imageUrl)) continue;
        seen.add(p.imageUrl);
        const ts = p.meta?.createdAt || m.timestamp;
        const timeLabel = new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const actionLabel = p.meta?.action || messageAction || "生成结果";
        const subtitle = p.meta?.size ? `${timeLabel} · ${p.meta.size}` : timeLabel;
        items.push({
          id: p.meta?.id || `${m.id}-${pi}`,
          imageUrl: p.imageUrl,
          title: actionLabel,
          subtitle,
        });
      }
    }

    if (maskEditBaseUrl && !seen.has(maskEditBaseUrl)) {
      items.unshift({
        id: `mask-current-${hashString(maskEditBaseUrl)}`,
        imageUrl: maskEditBaseUrl,
        title: "当前编辑图",
        subtitle: "未进入历史",
      });
    }

    return items;
  }, [currentSession, maskEditBaseUrl, maskEditContext]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSessionId, currentMessageCount]);

  const allAssets: AssetItem[] = useMemo(() => {
    if (navView !== 'assets') return [];
    const out: AssetItem[] = [];
    for (const s of sessions) {
      let lastUserText: string | null = null;
      for (let mi = 0; mi < s.messages.length; mi++) {
        const m = s.messages[mi];
        if (m.role === "user") {
          let t = "";
          for (let pi = 0; pi < m.parts.length; pi++) {
            const p = m.parts[pi];
            if (p.type === "text" && p.text) {
              t += t ? ` ${p.text}` : p.text;
            }
          }
          t = t.trim();
          if (t) lastUserText = t;
        }
        for (const p of m.parts) {
          if (p.type !== "image" || !p.imageUrl) continue;
          const id = p.meta?.id || hashString(p.imageUrl);
          out.push({
            id,
            url: p.imageUrl,
            sessionId: s.id,
            sessionTitle: s.title,
            createdAt: p.meta?.createdAt || m.timestamp,
            prompt: p.meta?.prompt || lastUserText || undefined,
            model: p.meta?.model,
            size: p.meta?.size,
            responseFormat: p.meta?.responseFormat,
            parentImageUrl: p.meta?.parentImageUrl,
          });
        }
      }
    }
    for (const job of batchJobs) {
      for (const slot of job.slots) {
        for (const version of slot.versions) {
          if (!version.imageUrl) continue;
          out.push({
            id: version.id,
            url: version.imageUrl,
            sessionId: `batch:${job.id}`,
            sessionTitle: `矩阵 · ${job.title}`,
            createdAt: version.createdAt,
            prompt: version.promptUsed,
            model: version.model,
            size: version.size,
            responseFormat: "url",
            parentImageUrl: version.parentVersionId,
          });
        }
      }
    }
    return out;
  }, [sessions, batchJobs, navView]);

  const totalAssetCount = useMemo(() => {
    const sessionCache = sessionAssetCountCacheRef.current;
    const batchCache = batchAssetCountCacheRef.current;
    const nextSessionIds = new Set<string>();
    const nextJobIds = new Set<string>();

    let count = 0;
    for (const s of sessions) {
      nextSessionIds.add(s.id);
      const cached = sessionCache.get(s.id);
      if (cached && cached.messagesRef === s.messages) {
        count += cached.count;
        continue;
      }
      let sessionCount = 0;
      for (let mi = 0; mi < s.messages.length; mi++) {
        const m = s.messages[mi];
        for (let pi = 0; pi < m.parts.length; pi++) {
          const p = m.parts[pi];
          if (p.type === "image" && p.imageUrl) sessionCount += 1;
        }
      }
      sessionCache.set(s.id, { messagesRef: s.messages, count: sessionCount });
      count += sessionCount;
    }
    sessionCache.forEach((_v, key) => {
      if (!nextSessionIds.has(key)) sessionCache.delete(key);
    });

    for (const job of batchJobs) {
      nextJobIds.add(job.id);
      const cached = batchCache.get(job.id);
      if (cached && cached.slotsRef === job.slots) {
        count += cached.count;
        continue;
      }
      let jobCount = 0;
      for (let si = 0; si < job.slots.length; si++) {
        const slot = job.slots[si];
        for (let vi = 0; vi < slot.versions.length; vi++) {
          if (slot.versions[vi].imageUrl) jobCount += 1;
        }
      }
      batchCache.set(job.id, { slotsRef: job.slots, count: jobCount });
      count += jobCount;
    }
    batchCache.forEach((_v, key) => {
      if (!nextJobIds.has(key)) batchCache.delete(key);
    });

    return count;
  }, [sessions, batchJobs]);

  const activeBatchJobCount = useMemo(
    () => batchJobs.reduce((n, j) => n + (j.status !== "deleted" ? 1 : 0), 0),
    [batchJobs]
  );

  // Gallery images: chat/session images + batch job primary versions
  const galleryImages = useMemo<GeneratedImage[]>(() => {
    if (!currentSession) return [];
    const chatImages = extractImagesFromSession(currentSession);

    const batchImages: GeneratedImage[] = [];
    for (const job of batchJobs) {
      if (job.status === 'deleted') continue;
      for (const slot of job.slots) {
        if (!slot.versions.length) continue;
        const primary = slot.versions.find(v => v.isPrimary)
          ?? [...slot.versions].sort((a, b) => b.createdAt - a.createdAt)[0];
        if (!primary?.imageUrl) continue;
        batchImages.push({
          id: primary.id,
          imageUrl: primary.imageUrl,
          prompt: primary.promptUsed,
          model: primary.model,
          size: primary.size,
          createdAt: primary.createdAt,
          source: 'batch',
          slotId: slot.id,
          slotTitle: slot.title,
          jobId: job.id,
          isPrimary: primary.isPrimary,
        });
      }
    }

    return [...chatImages, ...batchImages];
  }, [currentSession, batchJobs]);

  // Selected gallery image object (for PropertyPanel detail view)
  const selectedGalleryImage = useMemo<GeneratedImage | null>(() => {
    if (!selectedGalleryImageId) return null;
    return galleryImages.find((img) => img.id === selectedGalleryImageId) || null;
  }, [selectedGalleryImageId, galleryImages]);

  // ——— Handlers ———

  const openAssets = useCallback(() => {
    setNavView('assets');
  }, []);

  const handleUpdateDefaultPreferences = useCallback((prefs: DefaultPreferences) => {
    uiDispatch({ type: SET_DEFAULT_PREFERENCES, payload: prefs });
    saveDefaultPreferences(prefs);
  }, [uiDispatch]);

  const handleNewSession = useCallback(() => {
    const newSession = createNewSession(templates, defaultPreferences);
    projectDispatch({ type: ADD_SESSION, payload: newSession });
    projectDispatch({ type: SET_CURRENT_SESSION_ID, payload: newSession.id });
    uiDispatch({ type: SET_CURRENT_VIEW, payload: "chat" });
    uiDispatch({ type: SET_INPUT_TEXT, payload: '' });
    uiDispatch({ type: SET_SELECTED_IMAGE, payload: null });
    setNavView('project');
  }, [templates, defaultPreferences, projectDispatch, uiDispatch]);

  const handleDeleteSession = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // We need to handle the "if last session deleted, create new one" logic
    const remaining = sessions.filter((s) => s.id !== id);
    if (remaining.length === 0) {
      const fresh = createNewSession(templates, defaultPreferences);
      projectDispatch({ type: SET_SESSIONS, payload: [fresh] });
      projectDispatch({ type: SET_CURRENT_SESSION_ID, payload: fresh.id });
    } else {
      projectDispatch({ type: SET_SESSIONS, payload: remaining });
      if (currentSessionId === id) {
        projectDispatch({ type: SET_CURRENT_SESSION_ID, payload: remaining[0].id });
      }
    }
    syncService.deleteProject(id);
  }, [currentSessionId, templates, defaultPreferences, sessions, projectDispatch]);

  const handleUpdateSettings = useCallback((newSettings: SessionSettings) => {
    if (!currentSessionId) return;
    projectDispatch({
      type: UPDATE_SESSION,
      payload: { id: currentSessionId, updater: (s) => ({ ...s, settings: newSettings }) },
    });
  }, [currentSessionId, projectDispatch]);

  const handleSaveTemplate = useCallback((newTemplate: SystemTemplate) => {
    const updated = [...templates, newTemplate];
    libraryDispatch({ type: SET_TEMPLATES, payload: updated });
    syncService.saveTemplates(updated, currentTeamId ?? undefined);
  }, [templates, libraryDispatch, currentTeamId]);

  const handleAddModel = useCallback((newModel: ModelCharacter) => {
    libraryDispatch({ type: ADD_MODEL, payload: newModel });
    syncService.saveModel(newModel, currentTeamId ?? undefined);
  }, [libraryDispatch, currentTeamId]);

  const handleDeleteModel = useCallback((modelId: string) => {
    libraryDispatch({ type: DELETE_MODEL, payload: modelId });
    syncService.deleteModel(modelId);
    if (currentSessionId) {
      projectDispatch({
        type: UPDATE_SESSION,
        payload: {
          id: currentSessionId,
          updater: (s) => {
            if (s.settings.selectedModelId === modelId) {
              return { ...s, settings: { ...s.settings, selectedModelId: null } };
            }
            return s;
          },
        },
      });
    }
  }, [currentSessionId, libraryDispatch, projectDispatch]);

  const handleRenameModel = useCallback((modelId: string, newName: string) => {
    libraryDispatch({ type: UPDATE_MODEL, payload: { id: modelId, updates: { name: newName } } });
    const model = models.find((m) => m.id === modelId);
    if (model) {
      syncService.saveModel({ ...model, name: newName }, currentTeamId ?? undefined);
    }
  }, [libraryDispatch, models, currentTeamId]);

  const handleAddProduct = useCallback((product: ProductCatalogItem) => {
    libraryDispatch({ type: ADD_PRODUCT, payload: product });
    syncService.saveProduct(product, currentTeamId ?? undefined);
  }, [libraryDispatch, currentTeamId]);

  const handleUpdateProduct = useCallback((productId: string, updates: Partial<Omit<ProductCatalogItem, 'id' | 'createdAt'>>) => {
    libraryDispatch({ type: UPDATE_PRODUCT, payload: { id: productId, updates } });
    const product = products.find((p) => p.id === productId);
    if (product) {
      syncService.saveProduct({ ...product, ...updates }, currentTeamId ?? undefined);
    }
  }, [libraryDispatch, products, currentTeamId]);

  const handleDeleteProduct = useCallback((productId: string) => {
    libraryDispatch({ type: DELETE_PRODUCT, payload: productId });
    syncService.deleteProduct(productId);
  }, [libraryDispatch]);

  // ——— Brand Kit callbacks ———
  const activeBrandKit = useMemo(() => brandKits.find((k) => k.isActive) ?? null, [brandKits]);

  const handleAddBrandKit = useCallback((kit: BrandKit) => {
    libraryDispatch({ type: ADD_BRAND_KIT, payload: kit });
  }, [libraryDispatch]);

  const handleUpdateBrandKit = useCallback((id: string, updates: Partial<BrandKit>) => {
    libraryDispatch({ type: UPDATE_BRAND_KIT, payload: { id, updates } });
  }, [libraryDispatch]);

  const handleDeleteBrandKit = useCallback((id: string) => {
    libraryDispatch({ type: DELETE_BRAND_KIT, payload: id });
    syncService.deleteBrandKit(id);
  }, [libraryDispatch]);

  const handleActivateBrandKit = useCallback((id: string | null) => {
    libraryDispatch({ type: SET_ACTIVE_BRAND_KIT, payload: id });
    if (id) syncService.activateBrandKit(id);
  }, [libraryDispatch]);

  const handleSetBrandTasteRatings = useCallback((kitId: string, ratings: ImageRating[]) => {
    libraryDispatch({ type: SET_BRAND_TASTE_RATINGS, payload: { kitId, ratings } });
  }, [libraryDispatch]);

  const handleSetBrandTasteProfile = useCallback((kitId: string, profile: any) => {
    libraryDispatch({ type: SET_BRAND_TASTE_PROFILE, payload: { kitId, profile } });
  }, [libraryDispatch]);

  const handleUpdateApiConfig = useCallback((cfg: ApiConfig) => {
    uiDispatch({ type: SET_API_CONFIG, payload: cfg });
    saveStoredApiConfig(cfg);
  }, [uiDispatch]);

  const updateBatchJobById = useCallback((jobId: string, updater: (job: BatchJob) => BatchJob) => {
    batchDispatch({ type: UPDATE_BATCH_JOB, payload: { id: jobId, updater } });
  }, [batchDispatch]);

  const appendBatchActionLog = useCallback((job: BatchJob, action: string, payload?: Record<string, unknown>): BatchJob => {
    const log = {
      id: uuidv4(),
      jobId: job.id,
      action,
      operator: authUser || "unknown",
      ts: nowTs(),
      payload,
    };
    return {
      ...job,
      updatedAt: nowTs(),
      actionLogs: [...job.actionLogs, log],
    };
  }, [authUser]);

  const selectedModelImage = useMemo(() => {
    if (!currentSession?.settings.selectedModelId) return null;
    return models.find((m) => m.id === currentSession.settings.selectedModelId)?.imageUrl || null;
  }, [currentSession?.settings.selectedModelId, models]);

  const selectedProductImage = currentSession?.settings.productImage?.imageUrl || null;

  const buildBatchSlotPrompt = useCallback((params: {
    basePrompt: string;
    total: number;
    index: number;
    scene: BatchSetItem["scene"];
    sceneLabel: string;
    note: string;
  }) => {
    const sceneDirective = getBatchSceneDirective(params.scene);
    return [
      params.basePrompt ? `整体要求：${params.basePrompt}` : "整体要求：围绕当前产品产出电商可用图片。",
      `当前任务：这是矩阵第 ${params.index + 1} 张（共 ${params.total} 张），类型为「${params.sceneLabel}」。`,
      sceneDirective,
      params.note ? `单独要求：${params.note}` : "",
      "输出要求：构图完整、主体清晰、光线自然、可直接用于电商展示。",
    ]
      .filter(Boolean)
      .join("\n");
  }, []);

  const runBatchSlotGeneration = useCallback(async (params: {
    jobId: string;
    slotId: string;
    slotLabel: string;
    slotPrompt: string;
    slotType: BatchSceneType;
    productImage: string | null;
    modelImage: string | null;
    referenceImage: string | null;
  }): Promise<BatchVersion[]> => {
    if (!currentSession) return [];

    const settings = currentSession.settings;
    const currentModel = getEffectiveApiConfig().defaultImageModel;
    const size = aspectRatioToSize(settings.aspectRatio);

    const images: string[] = [];
    if (params.referenceImage) {
      images.push(await urlToDataUrl(params.referenceImage));
    } else {
      if (params.productImage) images.push(await urlToDataUrl(params.productImage));
      const needsModel = params.slotType === "model" || params.slotType === "custom";
      if (needsModel && params.modelImage) images.push(await urlToDataUrl(params.modelImage));
    }

    let imageContext = "";
    if (params.referenceImage) {
      imageContext = "图片1是当前矩阵参考图。请严格参照参考图的风格、构图、色调和整体氛围，生成同系列的矩阵变体。保持视觉一致性，仅按场景描述调整角度和环境。";
    } else {
      const needsModel = params.slotType === "model" || params.slotType === "custom";
      if (params.productImage && needsModel && params.modelImage) {
        imageContext = "图片1是产品参考图，图片2是模特参考图。请严格还原图片1中产品的外观、颜色、材质与细节，保持完全不变。保持图片2中人物的面部特征、体型与身份特征不变。将图片1的产品展示于图片2的模特身上，生成专业电商展示图。";
      } else if (params.productImage) {
        imageContext = "图片1是产品参考图。请严格还原图片1中产品的外观、颜色、材质与细节，保持完全不变。模特或人物由你自行创建，产品为视觉主体。";
      }
    }

    // Brand Kit DNA injection for batch
    let batchBrandDna = "";
    if (activeBrandKit) {
      const bkParts: string[] = [];
      if (activeBrandKit.styleKeywords.length > 0) bkParts.push(`品牌视觉风格：${activeBrandKit.styleKeywords.join("、")}`);
      if (activeBrandKit.colorPalette.length > 0) bkParts.push(`品牌主色调：${activeBrandKit.colorPalette.join("、")}`);
      if (activeBrandKit.moodKeywords.length > 0) bkParts.push(`品牌氛围：${activeBrandKit.moodKeywords.join("、")}`);

      // Inject taste profile if distilled
      const tp = activeBrandKit.tasteProfile;
      if (tp) {
        if (tp.learnedPreferences.length > 0) bkParts.push(`品牌偏好：${tp.learnedPreferences.join("、")}`);
        if (tp.learnedAvoidances.length > 0) bkParts.push(`品牌禁忌（请避免）：${tp.learnedAvoidances.join("、")}`);
        if (tp.compositionNotes) bkParts.push(`构图要求：${tp.compositionNotes}`);
        if (tp.colorNotes) bkParts.push(`色彩要求：${tp.colorNotes}`);
        if (tp.moodNotes) bkParts.push(`氛围要求：${tp.moodNotes}`);
      }

      if (bkParts.length > 0) batchBrandDna = `【品牌 DNA】${bkParts.join("。")}。请在保持品牌一致性的前提下创作。\n`;

      // Add brand reference images
      if (activeBrandKit.images) {
        for (const img of activeBrandKit.images) {
          if (img.imageUrl) images.push(img.imageUrl);
        }
      }
    }

    const contextPrefix = imageContext ? `${imageContext}\n` : "";
    const promptUsed = `${batchBrandDna}${contextPrefix}${params.slotPrompt}`.trim();

    const resp = await imagesGenerations(
      {
        prompt: promptUsed,
        systemPrompt: settings.systemPrompt?.trim() || undefined,
        n: 1,
        response_format: ResponseFormat.Url,
        size,
        image: images.length ? images : undefined,
      },
      { signal: batchAbortRef.current?.signal, queueSource: "batch" }
    );

    const generated: BatchVersion[] = await Promise.all(
      (resp.data || [])
        .map((o) => (o ? imageObjToDataUrl(o) : null))
        .filter((u): u is string => Boolean(u))
        .map(async (url, idx) => {
          let persistentUrl = url;
          try { persistentUrl = await urlToDataUrl(url); }
          catch (e) { console.warn('批量任务图片转换失败:', e); }
          return {
            id: uuidv4(),
            slotId: params.slotId,
            index: idx + 1,
            imageUrl: persistentUrl,
            model: resp.model_used || currentModel,
            promptUsed,
            size,
            createdAt: nowTs(),
            source: "generate" as const,
            isPrimary: idx === 0,
          };
        })
    );
    return generated;
  }, [currentSession]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginForm.username.trim() || !loginForm.password) {
      setAuthError("请输入账号和密码。");
      return;
    }
    uiDispatch({ type: SET_AUTH_LOADING, payload: true });
    setAuthError(null);
    try {
      const user = await login(loginForm.username.trim(), loginForm.password);
      uiDispatch({ type: SET_AUTH_USER, payload: user.username });
      setLoginForm({ username: user.username, password: "" });
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "登录失败，请重试。");
    } finally {
      uiDispatch({ type: SET_AUTH_LOADING, payload: false });
    }
  };

  const handleLogout = async () => {
    uiDispatch({ type: SET_AUTH_LOADING, payload: true });
    try {
      await logout();
    } catch {
      // ignore network error, still reset local auth state
    } finally {
      await clearAll().catch(() => {});
      projectDispatch({ type: SET_SESSIONS, payload: [] });
      projectDispatch({ type: SET_CURRENT_SESSION_ID, payload: null });
      batchDispatch({ type: SET_BATCH_JOBS, payload: [] });
      batchDispatch({ type: SET_SELECTED_BATCH_JOB_ID, payload: null });
      uiDispatch({ type: SET_CURRENT_VIEW, payload: "chat" });
      libraryDispatch({ type: SET_TEMPLATES, payload: [] });
      libraryDispatch({ type: SET_MODELS, payload: [] });
      libraryDispatch({ type: SET_PRODUCTS, payload: [] });
      uiDispatch({ type: SET_SELECTED_IMAGE, payload: null });
      uiDispatch({ type: SET_INPUT_TEXT, payload: '' });
      uiDispatch({ type: SET_AUTH_USER, payload: null });
      uiDispatch({ type: SET_AUTH_LOADING, payload: false });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => uiDispatch({ type: SET_SELECTED_IMAGE, payload: reader.result as string });
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onloadend = () => uiDispatch({ type: SET_SELECTED_IMAGE, payload: reader.result as string });
          reader.readAsDataURL(file);
          return;
        }
      }
    }
  };

  const handleEnhancePrompt = async () => {
    if (!inputText.trim() || isEnhancing || isGenerating) return;
    uiDispatch({ type: SET_ENHANCING, payload: true });
    try {
      const enhancedText = await enhancePrompt(inputText);
      uiDispatch({ type: SET_INPUT_TEXT, payload: enhancedText });
    } catch (e) {
      console.error(e);
      uiDispatch({ type: SET_GENERATION_STAGE, payload: "提示词增强失败，将使用原始提示词" });
      setTimeout(() => {
        uiDispatch({ type: SET_GENERATION_STAGE, payload: null });
      }, 3000);
    } finally {
      uiDispatch({ type: SET_ENHANCING, payload: false });
    }
  };

  // ——— Team handlers ———
  const handleCreateTeam = useCallback(async (name: string) => {
    try {
      const team = await syncService.createTeam(name);
      teamDispatch({ type: ADD_TEAM, payload: {
        id: team.id,
        name: team.name,
        createdBy: team.created_by,
        members: [{
          userId: team.created_by,
          username: authUser || '',
          displayName: authUser || '',
          role: 'admin' as const,
          joinedAt: team.created_at,
        }],
        createdAt: team.created_at,
        updatedAt: team.updated_at,
      } });
    } catch (err) {
      console.error('Failed to create team:', err);
    }
  }, [teamDispatch, authUser]);

  const handleDeleteTeam = useCallback(async (teamId: string) => {
    try {
      await syncService.deleteTeam(teamId);
      teamDispatch({ type: DELETE_TEAM, payload: teamId });
      if (currentTeamId === teamId) {
        teamDispatch({ type: SET_CURRENT_TEAM_ID, payload: null });
      }
    } catch (err) {
      console.error('Failed to delete team:', err);
    }
  }, [teamDispatch, currentTeamId]);

  const handleUpdateTeam = useCallback(async (teamId: string, name: string) => {
    try {
      await syncService.updateTeam(teamId, name);
      teamDispatch({ type: UPDATE_TEAM, payload: { id: teamId, updater: (t) => ({ ...t, name, updatedAt: Date.now() }) } });
    } catch (err) {
      console.error('Failed to update team:', err);
    }
  }, [teamDispatch]);

  const handleAddMember = useCallback(async (teamId: string, username: string) => {
    try {
      await syncService.addTeamMember(teamId, username);
      // Refresh team members from server
      const members = await syncService.fetchTeamMembers(teamId);
      teamDispatch({ type: UPDATE_TEAM, payload: { id: teamId, updater: (t) => ({ ...t, members: members.map((m: any) => ({ userId: m.userId, username: m.username, displayName: m.displayName || m.username, role: m.role, joinedAt: m.joinedAt ?? Date.now() })) }) } });
    } catch (err) {
      console.error('Failed to add member:', err);
    }
  }, [teamDispatch]);

  const handleRemoveMember = useCallback(async (teamId: string, userId: string) => {
    try {
      await syncService.removeTeamMember(teamId, userId);
      teamDispatch({ type: UPDATE_TEAM, payload: { id: teamId, updater: (t) => ({ ...t, members: t.members.filter((m) => m.userId !== userId) }) } });
    } catch (err) {
      console.error('Failed to remove member:', err);
    }
  }, [teamDispatch]);

  const handleSwitchTeam = useCallback((teamId: string | null) => {
    teamDispatch({ type: SET_CURRENT_TEAM_ID, payload: teamId });
  }, [teamDispatch]);

  // ——— Onboarding handlers ———
  const handleOnboardingFileUpload = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onloadend = () => uiDispatch({ type: SET_SELECTED_IMAGE, payload: reader.result as string });
    reader.readAsDataURL(file);
  }, [uiDispatch]);

  const handleOnboardingPaste = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const reader = new FileReader();
          reader.onloadend = () => uiDispatch({ type: SET_SELECTED_IMAGE, payload: reader.result as string });
          reader.readAsDataURL(blob);
          return;
        }
      }
    } catch {
      // Clipboard API not available or denied
    }
  }, [uiDispatch]);

  const handleOnboardingQuickStart = useCallback((templateName: string) => {
    const template = templates.find((t) => t.name === templateName);
    if (template && currentSession) {
      projectDispatch({
        type: UPDATE_SESSION,
        payload: {
          id: currentSession.id,
          updater: (s) => ({ ...s, settings: { ...s.settings, systemPrompt: template.content } }),
        },
      });
    }
  }, [templates, currentSession, projectDispatch]);

  const handleOnboardingPromptSubmit = useCallback((prompt: string) => {
    uiDispatch({ type: SET_INPUT_TEXT, payload: prompt });
  }, [uiDispatch]);

  const handleGalleryImageClick = useCallback((image: GeneratedImage) => {
    setSelectedGalleryImageId(image.id);
  }, []);

  const handleGalleryImageAction = useCallback((image: GeneratedImage, action: string) => {
    switch (action) {
      case 'download':
        if (image.imageUrl) {
          const options = loadDownloadOptions();
          void downloadImageWithFormat(image.imageUrl, {
            basename: `piveo-${image.id}`,
            quality: options.quality,
          });
        }
        break;
      case 'preview':
        if (image.imageUrl) {
          uiDispatch({ type: SET_PREVIEW_IMAGE, payload: image.imageUrl });
        }
        break;
      case 'mask-edit':
        if (image.imageUrl) {
          uiDispatch({ type: SET_MASK_EDIT_CONTEXT, payload: { source: "chat" } });
          setMaskEditBaseUrl(image.imageUrl);
        }
        break;
      case 'set-reference':
        if (image.imageUrl) {
          uiDispatch({ type: SET_SELECTED_IMAGE, payload: image.imageUrl });
        }
        break;
      case 'copy-prompt':
        if (image.prompt) {
          navigator.clipboard.writeText(image.prompt).catch(() => {});
        }
        break;
      case 'variation':
        if (image.imageUrl) {
          uiDispatch({ type: SET_SELECTED_IMAGE, payload: image.imageUrl });
          if (image.prompt) {
            uiDispatch({ type: SET_INPUT_TEXT, payload: image.prompt });
          }
        }
        break;
      case 'delete':
        if (window.confirm('确定要删除这张图片吗？')) {
          if (image.source === 'batch' && image.jobId && image.slotId) {
            // Remove the version from batch slot
            updateBatchJobById(image.jobId, (job) => ({
              ...job,
              slots: job.slots.map((s) => s.id !== image.slotId ? s : {
                ...s,
                versions: s.versions.filter((v) => v.id !== image.id),
                activeVersionId: s.activeVersionId === image.id ? undefined : s.activeVersionId,
              }),
              updatedAt: nowTs(),
            }));
          } else if (currentSessionId) {
            // Remove from chat history
            projectDispatch({
              type: UPDATE_SESSION,
              payload: {
                id: currentSessionId,
                updater: (s) => ({
                  ...s,
                  messages: s.messages.map((msg) => ({
                    ...msg,
                    parts: msg.parts.filter((p) => !(p.type === 'image' && p.meta?.id === image.id)),
                  })).filter((msg) => msg.parts.length > 0),
                }),
              },
            });
          }
          if (selectedGalleryImageId === image.id) {
            setSelectedGalleryImageId(null);
          }
        }
        break;
      case 'deselect':
        setSelectedGalleryImageId(null);
        break;
      case 'batch-rerun-slot':
        if (image.jobId && image.slotId) {
          void handleRunSingleBatchSlot(image.jobId, image.slotId);
        }
        break;
      case 'batch-view-job':
        if (image.jobId) {
          batchDispatch({ type: SET_SELECTED_BATCH_JOB_ID, payload: image.jobId });
          uiDispatch({ type: SET_CURRENT_VIEW, payload: 'batch' });
        }
        break;
      case 'batch-from-image':
        if (image.imageUrl) {
          handleBatchFromImage(image.imageUrl);
        }
        break;
      case 'refine':
        if (image.imageUrl) {
          setRefineTarget({ imageUrl: image.imageUrl, prompt: image.prompt });
        }
        break;
      case 'swap-model':
        if (image.imageUrl) {
          setSwapModelTarget({ imageUrl: image.imageUrl, prompt: image.prompt });
        }
        break;
      case 'compare': {
        if (image.imageUrl && image.parentImageId) {
          const parentImage = galleryImages.find((img) => img.id === image.parentImageId);
          if (parentImage?.imageUrl) {
            setCompareState({ beforeUrl: parentImage.imageUrl, afterUrl: image.imageUrl });
          }
        }
        break;
      }
      case 'rate-on-brand':
      case 'rate-off-brand': {
        if (!activeBrandKit || !image.imageUrl) break;
        const ratingValue = action === 'rate-on-brand' ? 'on-brand' : 'off-brand';
        // Check if already rated with same value — toggle off
        const existingRating = activeBrandKit.ratings?.find((r) => r.imageUrl === image.imageUrl);
        if (existingRating && existingRating.rating === ratingValue) {
          // Remove rating
          libraryDispatch({ type: REMOVE_BRAND_TASTE_RATING, payload: { kitId: activeBrandKit.id, ratingId: existingRating.id } });
          syncService.deleteBrandTasteRating(activeBrandKit.id, existingRating.id);
        } else {
          const rating: ImageRating = {
            id: existingRating?.id ?? uuidv4(),
            brandKitId: activeBrandKit.id,
            imageUrl: image.imageUrl,
            prompt: image.prompt || '',
            model: image.model || '',
            rating: ratingValue as 'on-brand' | 'off-brand',
            createdAt: existingRating?.createdAt ?? Date.now(),
          };
          libraryDispatch({ type: ADD_BRAND_TASTE_RATING, payload: { kitId: activeBrandKit.id, rating } });
          syncService.saveBrandTasteRating(activeBrandKit.id, rating);
        }
        break;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiDispatch, currentSessionId, projectDispatch, selectedGalleryImageId, batchDispatch, updateBatchJobById, activeBrandKit, libraryDispatch]);

  const cancelGeneration = () => {
    abortRef.current?.abort();
  };

  const cancelBatchGeneration = () => {
    batchAbortRef.current?.abort();
  };

  const executeGeneration = useCallback(async (
    prompt: string,
    image: string | null,
    customMessages?: Message[],
    opts?: {
      action?: string;
      extraImages?: string[];
      sizes?: string[];
      batchCountOverride?: number;
      forceNoAutoReuse?: boolean;
      queueSource?: "chat" | "batch" | "mask-edit" | "model-gen";
      referenceIntent?: import('./types').ReferenceIntent;
    }
  ) => {
    if (!currentSession) return;
    lastRunRef.current = { prompt, image, customMessages, opts };

    const sessionId = currentSession.id;
    const batchCount = Math.min(
      Math.max(opts?.batchCountOverride ?? (currentSession.settings.batchCount || 1), 1),
      10
    );
    const responseFormat: ImageResponseFormat = "url";

    const baseSize = aspectRatioToSize(currentSession.settings.aspectRatio);
    const rawSizes = opts?.sizes?.length ? opts.sizes : [baseSize];
    const normalizedSizes = rawSizes
      .map((s) => String(s || "").trim())
      .filter((s): s is string => Boolean(s));
    const sizes: string[] = filterSizesByAspect(Array.from(new Set<string>(normalizedSizes)), currentSession.settings.aspectRatio);
    if (sizes.length === 0) sizes.push(baseSize);

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const controller = abortRef.current;

    uiDispatch({ type: SET_GENERATING, payload: true });
    uiDispatch({ type: SET_ERROR_DETAILS, payload: null });
    setIsErrorExpanded(false);
    uiDispatch({ type: SET_GENERATION_PROGRESS, payload: null });

    let stage = "准备请求...";
    uiDispatch({ type: SET_GENERATION_STAGE, payload: stage });

    const isHousingFlow = currentSession.settings.creationWorkflow === "housing";

    let modelImage: string | null = null;
    if (!isHousingFlow && currentSession.settings.selectedModelId) {
      const selectedModel = models.find(m => m.id === currentSession.settings.selectedModelId);
      if (selectedModel) modelImage = selectedModel.imageUrl;
    }

    let productImageUrl: string | null = null;
    if (currentSession.settings.productImage) {
      productImageUrl = currentSession.settings.productImage.imageUrl;
    }

    const effectiveReferenceImage = image || (isHousingFlow ? productImageUrl : null);
    const effectiveProductImage = isHousingFlow ? null : productImageUrl;
    const promptForRun = isHousingFlow
      ? `【任务场景：房屋设计】可用于建筑外观、室内设计、空间改造与软装提案。重点保持结构比例、空间尺度、材质与光照真实。\n${prompt}`
      : prompt;

    const messagesToUse = customMessages || currentSession.messages;
    let updatedMessages = messagesToUse;

    const parentImageUrl = effectiveReferenceImage || findLastImageUrl(messagesToUse);

    try {
      for (let i = 0; i < sizes.length; i++) {
        const size = sizes[i];
        uiDispatch({ type: SET_GENERATION_PROGRESS, payload: { current: i + 1, total: sizes.length } });
        stage = `正在生成首图（${i + 1}/${sizes.length}）· 比例 ${currentSession.settings.aspectRatio}...`;
        uiDispatch({ type: SET_GENERATION_STAGE, payload: stage });

        const generationBaseMessages = updatedMessages;

        const firstResult = await generateResponse(
          promptForRun,
          effectiveReferenceImage,
          modelImage,
          effectiveProductImage,
          generationBaseMessages,
          currentSession.settings,
          {
            n: 1,
            size,
            responseFormat,
            extraImages: opts?.extraImages,
            disableAutoUseLastImage: Boolean(opts?.forceNoAutoReuse),
            signal: controller.signal,
            queueSource: opts?.queueSource || "chat",
            referenceIntent: opts?.referenceIntent,
            activeBrandKit,
          }
        );
        setBalanceRefreshTick((v) => v + 1);

        stage = "解析结果...";
        uiDispatch({ type: SET_GENERATION_STAGE, payload: stage });

        const aiMessage: Message = {
          id: uuidv4(),
          role: 'model',
          parts: [],
          timestamp: Date.now()
        };

        if (sizes.length > 1) {
          aiMessage.parts.push({ type: "text", text: `尺寸：${firstResult.sizeUsed}` });
        }
        if (opts?.action) {
          aiMessage.parts.push({ type: "text", text: `操作：${opts.action}` });
        }

        const pushImagePart = async (url: string, resultMeta: GenerateResponseResult) => {
          let persistentUrl = url;
          try {
            persistentUrl = await urlToDataUrl(url);
          } catch (e) {
            console.warn('图片转换失败，使用原 URL:', e);
          }

          aiMessage.parts.push({
            type: "image",
            imageUrl: persistentUrl,
            meta: {
              id: uuidv4(),
              createdAt: Date.now(),
              prompt: resultMeta.promptUsed,
              model: resultMeta.modelUsed || apiConfig.defaultImageModel,
              size: resultMeta.sizeUsed,
              responseFormat: resultMeta.responseFormat,
              parentImageUrl: parentImageUrl || undefined,
              action: opts?.action,
            },
          });
        };

        const firstUrl = firstResult.images[0];
        if (firstUrl) {
          await pushImagePart(firstUrl, firstResult);
        }

        if (aiMessage.parts.length === 0) {
          aiMessage.parts.push({ type: 'text', text: '生成完成，但没有返回任何内容。' });
        }

        updatedMessages = [...updatedMessages, aiMessage];
        const aiMessageId = aiMessage.id;
        const patchLatestAiMessage = (nextPart: Message["parts"][number]) => {
          updatedMessages = updatedMessages.map((m) =>
            m.id === aiMessageId ? { ...m, parts: [...m.parts, nextPart] } : m
          );
          projectDispatch({
            type: UPDATE_SESSION,
            payload: {
              id: sessionId,
              updater: (s) => ({ ...s, messages: updatedMessages, updatedAt: Date.now() }),
            },
          });
        };
        projectDispatch({
          type: UPDATE_SESSION,
          payload: {
            id: sessionId,
            updater: (s) => ({ ...s, messages: updatedMessages, updatedAt: Date.now() }),
          },
        });

        const remaining = batchCount - 1;
        if (remaining > 0 && firstUrl) {
          let done = 0;
          let failed = 0;
          for (let idx = 0; idx < remaining; idx++) {
            if (controller.signal.aborted) break;
            try {
              const extra = await generateResponse(
                promptForRun,
                effectiveReferenceImage,
                modelImage,
                effectiveProductImage,
                generationBaseMessages,
                currentSession.settings,
                {
                  n: 1,
                  size,
                  responseFormat,
                  extraImages: opts?.extraImages,
                  disableAutoUseLastImage: Boolean(opts?.forceNoAutoReuse),
                  signal: controller.signal,
                  queueSource: opts?.queueSource || "chat",
                  referenceIntent: opts?.referenceIntent,
                  activeBrandKit,
                }
              );
              const extraUrl = extra.images[0];
              if (!extraUrl) {
                failed += 1;
              } else {
                setBalanceRefreshTick((v) => v + 1);
                let persistentUrl = extraUrl;
                try {
                  persistentUrl = await urlToDataUrl(extraUrl);
                } catch (e) {
                  console.warn('图片转换失败，使用原 URL:', e);
                }

                patchLatestAiMessage({
                  type: "image",
                  imageUrl: persistentUrl,
                  meta: {
                    id: uuidv4(),
                    createdAt: Date.now(),
                    prompt: extra.promptUsed,
                    model: extra.modelUsed || apiConfig.defaultImageModel,
                    size: extra.sizeUsed,
                    responseFormat: extra.responseFormat,
                    parentImageUrl: parentImageUrl || undefined,
                    action: opts?.action,
                  },
                });
              }
            } catch (err) {
              if (isAbortError(err)) throw err;
              failed += 1;
            } finally {
              done += 1;
              stage = `首图已出，正在补齐（${done}/${remaining}）· 比例 ${currentSession.settings.aspectRatio}...`;
              uiDispatch({ type: SET_GENERATION_STAGE, payload: stage });
            }
          }

          if (failed > 0) {
            patchLatestAiMessage({
              type: "text",
              text: `补图完成：失败 ${failed} 张，可直接点击「重试」继续补齐。`,
            });
          }
        }
      }
      return updatedMessages;
    } catch (e) {
      if (isAbortError(e)) {
        const cancelMsg: Message = {
          id: uuidv4(),
          role: "model",
          parts: [{ type: "text", text: "已取消生成。" }],
          timestamp: Date.now(),
        };
        updatedMessages = [...updatedMessages, cancelMsg];
        projectDispatch({
          type: UPDATE_SESSION,
          payload: {
            id: sessionId,
            updater: (s) => ({ ...s, messages: updatedMessages, updatedAt: Date.now() }),
          },
        });
        return updatedMessages;
      }

      const msg = e instanceof Error ? e.message : String(e);
      const httpStatus = extractHttpStatus(msg);
      if (httpStatus === 401 || isLikelyMissingAuth(msg)) {
        uiDispatch({ type: SET_AUTH_USER, payload: null });
      }
      const friendly = getFriendlyErrorMessage(msg);
      uiDispatch({
        type: SET_ERROR_DETAILS,
        payload: {
          message: msg,
          when: Date.now(),
          stage,
          requestId: extractRequestId(msg),
          status: extractHttpStatus(msg),
          endpoint: apiConfig.baseUrl,
          extra: {
            model: apiConfig.defaultImageModel,
            size: sizes,
            n: batchCount,
            responseFormat,
          },
          advice: getErrorAdvice(msg),
        },
      });

      const errorMessage: Message = {
        id: uuidv4(),
        role: 'model',
        parts: [{ type: 'text', text: friendly }],
        timestamp: Date.now()
      };
      updatedMessages = [...updatedMessages, errorMessage];
      projectDispatch({
        type: UPDATE_SESSION,
        payload: {
          id: sessionId,
          updater: (s) => ({ ...s, messages: updatedMessages, updatedAt: Date.now() }),
        },
      });
      return updatedMessages;
    } finally {
      uiDispatch({ type: SET_GENERATING, payload: false });
      uiDispatch({ type: SET_GENERATION_STAGE, payload: null });
      uiDispatch({ type: SET_GENERATION_PROGRESS, payload: null });
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [apiConfig, currentSession, models, projectDispatch, uiDispatch]);

  const handleSendMessage = async () => {
    if ((!inputText.trim() && !selectedImage) || isGenerating || !currentSession) return;

    const newUserMessage: Message = {
      id: uuidv4(),
      role: 'user',
      parts: [],
      timestamp: Date.now()
    };

    if (inputText.trim()) newUserMessage.parts.push({ type: 'text', text: inputText });
    if (selectedImage) newUserMessage.parts.push({ type: 'image', imageUrl: selectedImage });

    const updatedMessages = [...currentSession.messages, newUserMessage];
    const updatedTitle = currentSession.messages.length === 0 ? (inputText.trim().slice(0, 30) || "新创作") : currentSession.title;

    projectDispatch({
      type: UPDATE_SESSION,
      payload: {
        id: currentSession.id,
        updater: (s) => ({ ...s, messages: updatedMessages, title: updatedTitle, updatedAt: Date.now() }),
      },
    });

    const promptToPass = inputText;
    const imageToPass = selectedImage;
    const intentToPass = selectedImage ? referenceIntent : undefined;
    uiDispatch({ type: SET_INPUT_TEXT, payload: '' });
    uiDispatch({ type: SET_SELECTED_IMAGE, payload: null });
    uiDispatch({ type: SET_REFERENCE_INTENT, payload: 'all' });

    await executeGeneration(promptToPass, imageToPass, updatedMessages, { referenceIntent: intentToPass });
  };

  const handleVariation = useCallback(async (type: string, imageUrl: string) => {
    if (isGenerating || !currentSession) return;
    const variationPrompt = `基于之前的上下文，生成一个「${type}」变体，并严格保持一致性。`;

    const newUserMessage: Message = {
      id: uuidv4(),
      role: 'user',
      parts: [
        { type: 'text', text: `(变体操作：${type})` },
        { type: 'image', imageUrl },
      ],
      timestamp: Date.now()
    };

    const updatedMessages = [...currentSession.messages, newUserMessage];
    projectDispatch({
      type: UPDATE_SESSION,
      payload: {
        id: currentSession.id,
        updater: (s) => ({ ...s, messages: updatedMessages, updatedAt: Date.now() }),
      },
    });
    await executeGeneration(variationPrompt, imageUrl, updatedMessages, { action: `变体：${type}` });
  }, [currentSession, executeGeneration, isGenerating, projectDispatch]);

  const handleRefineFinish = useCallback((finalImageUrl: string) => {
    if (!currentSession) return;
    const newMessage: Message = {
      id: uuidv4(),
      role: 'model',
      parts: [{
        type: 'image',
        imageUrl: finalImageUrl,
        meta: {
          id: uuidv4(),
          createdAt: Date.now(),
          action: '迭代',
          model: apiConfig.defaultImageModel,
        },
      }],
      timestamp: Date.now(),
    };
    projectDispatch({
      type: UPDATE_SESSION,
      payload: {
        id: currentSession.id,
        updater: (s: Session) => ({
          ...s,
          messages: [...s.messages, newMessage],
          updatedAt: Date.now(),
        }),
      },
    });
    setRefineTarget(null);
  }, [currentSession, apiConfig.defaultImageModel, projectDispatch]);

  const handleSwapModelFinish = useCallback((finalImageUrl: string) => {
    if (!currentSession) return;
    const newMessage: Message = {
      id: uuidv4(),
      role: 'model',
      parts: [{
        type: 'image',
        imageUrl: finalImageUrl,
        meta: {
          id: uuidv4(),
          createdAt: Date.now(),
          action: '换模特',
          model: apiConfig.defaultImageModel,
        },
      }],
      timestamp: Date.now(),
    };
    projectDispatch({
      type: UPDATE_SESSION,
      payload: {
        id: currentSession.id,
        updater: (s: Session) => ({
          ...s,
          messages: [...s.messages, newMessage],
          updatedAt: Date.now(),
        }),
      },
    });
    setSwapModelTarget(null);
  }, [currentSession, apiConfig.defaultImageModel, projectDispatch]);

  const openMaskEditFromChat = useCallback((baseImageUrl: string) => {
    uiDispatch({ type: SET_MASK_EDIT_CONTEXT, payload: { source: "chat" } });
    setMaskEditBaseUrl(baseImageUrl);
  }, [uiDispatch]);

  const openMaskEditFromBatch = useCallback((params: {
    jobId: string;
    slotId: string;
    versionId?: string;
    baseImageUrl: string;
    historyItems: MaskEditorHistoryItem[];
  }) => {
    uiDispatch({
      type: SET_MASK_EDIT_CONTEXT,
      payload: {
        source: "batch",
        jobId: params.jobId,
        slotId: params.slotId,
        versionId: params.versionId,
        historyItems: params.historyItems,
      },
    });
    setMaskEditBaseUrl(params.baseImageUrl);
  }, [uiDispatch]);

  const ensureImageDataUrl = useCallback(async (imageUrl: string, signal?: AbortSignal): Promise<string> => {
    if (!imageUrl || isDataOrBlobUrl(imageUrl)) return imageUrl;
    const target = /^https?:\/\//i.test(imageUrl)
      ? `/auth/image-proxy?url=${encodeURIComponent(imageUrl)}`
      : imageUrl;

    const resp = await fetch(target, {
      credentials: "include",
      signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`底图转码失败：HTTP ${resp.status} ${text}`.trim());
    }
    const blob = await resp.blob();
    return await blobToDataUrl(blob);
  }, []);

  const openBatchSetModal = useCallback(() => {
    if (isGenerating) return;
    setIsBatchSetOpen(true);
  }, [isGenerating]);

  const handleBatchFromImage = useCallback((imageUrl: string) => {
    uiDispatch({ type: SET_SELECTED_IMAGE, payload: imageUrl });
    openBatchSetModal();
  }, [openBatchSetModal, uiDispatch]);

  const handleBatchSetSubmit = useCallback(async (items: BatchSetItem[]) => {
    if (!currentSession || isBatchGenerating || items.length === 0) return;

    if (addSlotsTargetJobId) {
      const targetJobId = addSlotsTargetJobId;
      setAddSlotsTargetJobId(null);
      setIsBatchSetOpen(false);

      const existingJob = batchJobs.find(j => j.id === targetJobId);
      if (!existingJob) return;

      const size = aspectRatioToSize(currentSession.settings.aspectRatio);
      const existingCount = existingJob.slots.length;

      const newSlots: BatchSlot[] = items.map((item, i) => ({
        id: uuidv4(),
        jobId: targetJobId,
        type: item.scene,
        title: `矩阵 ${existingCount + i + 1}/${existingCount + items.length} · ${item.sceneLabel}`,
        targetCount: 1,
        promptTemplate: item.note.trim(),
        size,
        status: "pending" as const,
        versions: [],
      }));

      updateBatchJobById(targetJobId, (job) => {
        const next = {
          ...job,
          slots: [...job.slots, ...newSlots],
          updatedAt: nowTs(),
        };
        return appendBatchActionLog(next, "slots_added", { addedCount: newSlots.length });
      });

      return;
    }

    setIsBatchSetOpen(false);

    const createdAt = nowTs();
    const basePrompt = inputText.trim();
    const fixedReferenceImage = selectedImage;
    const size = aspectRatioToSize(currentSession.settings.aspectRatio);
    const jobId = uuidv4();
    const slots: BatchSlot[] = items.map((item, i) => ({
      id: uuidv4(),
      jobId,
      type: item.scene,
      title: `矩阵 ${i + 1}/${items.length} · ${item.sceneLabel}`,
      targetCount: 1,
      promptTemplate: item.note.trim(),
      size,
      status: "pending",
      versions: [],
    }));

    const initialJob: BatchJob = {
      id: jobId,
      title: basePrompt ? `矩阵任务：${basePrompt.slice(0, 20)}` : `矩阵任务 ${new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      status: "draft",
      basePrompt,
      referenceImageUrl: fixedReferenceImage || undefined,
      createdAt,
      updatedAt: createdAt,
      slots,
      actionLogs: [
        {
          id: uuidv4(),
          jobId,
          action: "job_created",
          operator: authUser || "unknown",
          ts: createdAt,
          payload: { slotCount: slots.length },
        },
      ],
    };

    batchDispatch({ type: ADD_BATCH_JOB, payload: initialJob });
    batchDispatch({ type: SET_SELECTED_BATCH_JOB_ID, payload: jobId });
    uiDispatch({ type: SET_CURRENT_VIEW, payload: "batch" });
    autoStartBatchJobIdRef.current = jobId;
  }, [addSlotsTargetJobId, appendBatchActionLog, authUser, batchJobs, currentSession, inputText, isGenerating, selectedImage, updateBatchJobById, batchDispatch, uiDispatch]);



  const handleRenameBatchJob = useCallback((jobId: string, newTitle: string) => {
    updateBatchJobById(jobId, (job) => ({
      ...job,
      title: newTitle,
      updatedAt: nowTs(),
    }));
  }, [updateBatchJobById]);

  const handleOpenAddSlots = useCallback((jobId: string) => {
    setAddSlotsTargetJobId(jobId);
    setIsBatchSetOpen(true);
  }, []);

  const handleArchiveBatchJob = useCallback((jobId: string) => {
    updateBatchJobById(jobId, (job) => {
      const next = {
        ...job,
        status: "archived" as const,
        archivedAt: nowTs(),
        updatedAt: nowTs(),
      };
      return appendBatchActionLog(next, "job_archived");
    });
  }, [appendBatchActionLog, updateBatchJobById]);

  const handleRestoreBatchJob = useCallback((jobId: string) => {
    updateBatchJobById(jobId, (job) => {
      const slotDerived = mapSlotStatusToJobStatus(job.slots);
      const recoveredStatus: BatchJobStatus = slotDerived === "archived" || slotDerived === "deleted" ? "draft" : slotDerived;
      const next = {
        ...job,
        status: recoveredStatus,
        archivedAt: undefined,
        deletedAt: undefined,
        updatedAt: nowTs(),
      };
      return appendBatchActionLog(next, "job_restored", { status: recoveredStatus });
    });
  }, [appendBatchActionLog, updateBatchJobById]);

  const handleSoftDeleteBatchJob = useCallback((jobId: string) => {
    updateBatchJobById(jobId, (job) => {
      const next = {
        ...job,
        status: "deleted" as const,
        deletedAt: nowTs(),
        updatedAt: nowTs(),
      };
      return appendBatchActionLog(next, "job_deleted");
    });
  }, [appendBatchActionLog, updateBatchJobById]);

  const handleRecoverDeletedBatchJob = useCallback((jobId: string) => {
    updateBatchJobById(jobId, (job) => {
      const recovered = mapSlotStatusToJobStatus(job.slots);
      const next = {
        ...job,
        status: recovered === "deleted" ? "draft" : recovered,
        deletedAt: undefined,
        updatedAt: nowTs(),
      };
      return appendBatchActionLog(next, "job_recovered");
    });
  }, [appendBatchActionLog, updateBatchJobById]);

  const handleDuplicateBatchJob = useCallback((jobId: string) => {
    const source = batchJobs.find((j) => j.id === jobId);
    if (!source) return;
    const ts = nowTs();
    const newJobId = uuidv4();
    const newSlots: BatchSlot[] = source.slots.map((s) => ({
      ...s,
      id: uuidv4(),
      jobId: newJobId,
      status: "pending",
      error: undefined,
      versions: [],
      activeVersionId: undefined,
    }));
    const copy: BatchJob = {
      ...source,
      id: newJobId,
      title: `${source.title}（副本）`,
      status: "draft",
      createdAt: ts,
      updatedAt: ts,
      archivedAt: undefined,
      deletedAt: undefined,
      slots: newSlots,
      actionLogs: [
        {
          id: uuidv4(),
          jobId: newJobId,
          action: "job_copied",
          operator: authUser || "unknown",
          ts,
          payload: { fromJobId: source.id },
        },
      ],
    };
    batchDispatch({ type: SET_BATCH_JOBS, payload: [copy, ...batchJobs] });
    batchDispatch({ type: SET_SELECTED_BATCH_JOB_ID, payload: newJobId });
    uiDispatch({ type: SET_CURRENT_VIEW, payload: "batch" });
  }, [authUser, batchJobs, batchDispatch, uiDispatch]);

  const handleSetPrimaryBatchVersion = useCallback((jobId: string, slotId: string, versionId: string) => {
    updateBatchJobById(jobId, (job) => {
      const nextSlots = job.slots.map((slot) => {
        if (slot.id !== slotId) return slot;
        return {
          ...slot,
          activeVersionId: versionId,
          versions: slot.versions.map((v) => ({ ...v, isPrimary: v.id === versionId })),
        };
      });
      const next = {
        ...job,
        slots: nextSlots,
        updatedAt: nowTs(),
      };
      return appendBatchActionLog(next, "slot_set_primary", { slotId, versionId });
    });
  }, [appendBatchActionLog, updateBatchJobById]);

  const handleDownloadBatchVersion = useCallback(async (v: BatchVersion) => {
    if (!v.imageUrl) return;
    const options = loadDownloadOptions();
    await downloadImageWithFormat(v.imageUrl, {
      basename: `piveo-batch-${v.id}`,
      quality: options.quality,
    });
  }, []);

  const handleRunSingleBatchSlot = useCallback(async (jobId: string, slotId: string) => {
    const job = batchJobs.find((j) => j.id === jobId);
    const slot = job?.slots.find((s) => s.id === slotId);
    if (!job || !slot || !currentSession || isBatchGenerating) return;
    if (job.status === "deleted") return;

    batchAbortRef.current?.abort();
    batchAbortRef.current = new AbortController();
    const controller = batchAbortRef.current;

    batchDispatch({ type: SET_BATCH_GENERATING, payload: true });
    batchDispatch({
      type: SET_BATCH_GENERATION_PROGRESS,
      payload: { currentSlot: 1, totalSlots: 1, currentSlotLabel: slot.title },
    });
    uiDispatch({ type: SET_CURRENT_VIEW, payload: "batch" });
    batchDispatch({ type: SET_SELECTED_BATCH_JOB_ID, payload: jobId });

    updateBatchJobById(jobId, (target) => {
      const nextSlots = target.slots.map((s) => (s.id === slotId ? { ...s, status: "running", error: undefined } : s));
      const next = { ...target, slots: nextSlots, status: "running", updatedAt: nowTs() };
      return appendBatchActionLog(next, "slot_rerun_start", { slotId });
    });

    try {
      const slotPrompt = buildBatchSlotPrompt({
        basePrompt: job.basePrompt || inputText.trim(),
        total: job.slots.length,
        index: Math.max(0, job.slots.findIndex((s) => s.id === slotId)),
        scene: slot.type,
        sceneLabel: slot.title,
        note: slot.promptTemplate,
      });

      const generated = await runBatchSlotGeneration({
        jobId,
        slotId,
        slotLabel: slot.title,
        slotPrompt,
        slotType: slot.type,
        productImage: job.productImageUrl || null,
        modelImage: job.modelImageUrl || null,
        referenceImage: job.referenceImageUrl || null,
      });

      if (!generated.length) throw new Error("未返回图片");
      setBalanceRefreshTick((v) => v + 1);
      updateBatchJobById(jobId, (target) => {
        const nextSlots = target.slots.map((s) => {
          if (s.id !== slotId) return s;
          const prevLast = s.versions[s.versions.length - 1];
          const appended = generated.map((v, idx) => ({
            ...v,
            index: s.versions.length + idx + 1,
            source: "rerun" as const,
            parentVersionId: prevLast?.id,
          }));
          return {
            ...s,
            status: "completed" as const,
            versions: [
              ...s.versions.map((v) => ({ ...v, isPrimary: false })),
              ...appended.map((v, idx) => ({ ...v, isPrimary: idx === 0 })),
            ],
            activeVersionId: appended[0]?.id || s.activeVersionId,
          };
        });
        const next = {
          ...target,
          slots: nextSlots,
          status: mapSlotStatusToJobStatus(nextSlots),
          updatedAt: nowTs(),
        };
        return appendBatchActionLog(next, "slot_rerun_success", { slotId, generatedCount: generated.length });
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      updateBatchJobById(jobId, (target) => {
        const nextSlots = target.slots.map((s) => (s.id === slotId ? { ...s, status: "failed", error: msg } : s));
        const next = {
          ...target,
          slots: nextSlots,
          status: mapSlotStatusToJobStatus(nextSlots),
          updatedAt: nowTs(),
        };
        return appendBatchActionLog(next, "slot_rerun_failed", { slotId, error: msg });
      });
    } finally {
      batchDispatch({ type: SET_BATCH_GENERATING, payload: false });
      batchDispatch({ type: SET_BATCH_GENERATION_PROGRESS, payload: null });
      if (batchAbortRef.current === controller) {
        batchAbortRef.current = null;
      }
    }
  }, [appendBatchActionLog, batchJobs, buildBatchSlotPrompt, currentSession, inputText, isBatchGenerating, runBatchSlotGeneration, updateBatchJobById, batchDispatch, uiDispatch]);

  const handleRunAllBatchSlots = useCallback(async (jobId: string, mode: "pending_only" | "all") => {
    const job = batchJobs.find((j) => j.id === jobId);
    if (!job || !currentSession || isBatchGenerating) return;
    if (job.status === "deleted" || job.status === "archived") return;

    const slotsToRun = mode === "all"
      ? job.slots
      : job.slots.filter((s) => s.status === "pending" || s.status === "failed");

    if (slotsToRun.length === 0) return;

    batchAbortRef.current?.abort();
    batchAbortRef.current = new AbortController();
    const controller = batchAbortRef.current;

    batchDispatch({ type: SET_BATCH_GENERATING, payload: true });
    batchDispatch({ type: SET_BATCH_GENERATION_PROGRESS, payload: null });
    uiDispatch({ type: SET_CURRENT_VIEW, payload: "batch" });
    batchDispatch({ type: SET_SELECTED_BATCH_JOB_ID, payload: jobId });

    for (let i = 0; i < slotsToRun.length; i++) {
      if (controller.signal.aborted) break;
      const slot = slotsToRun[i];
      const slotIndex = job.slots.findIndex((s) => s.id === slot.id);

      batchDispatch({
        type: SET_BATCH_GENERATION_PROGRESS,
        payload: { currentSlot: i + 1, totalSlots: slotsToRun.length, currentSlotLabel: slot.title },
      });

      updateBatchJobById(jobId, (target) => {
        const nextSlots = target.slots.map((s) => (s.id === slot.id ? { ...s, status: "running", error: undefined } : s));
        const next = { ...target, slots: nextSlots, status: "running", updatedAt: nowTs() };
        return appendBatchActionLog(next, "slot_run_start", { slotId: slot.id, index: slotIndex });
      });

      try {
        const slotPrompt = buildBatchSlotPrompt({
          basePrompt: job.basePrompt || inputText.trim(),
          total: job.slots.length,
          index: slotIndex,
          scene: slot.type,
          sceneLabel: slot.title,
          note: slot.promptTemplate,
        });

        const generated = await runBatchSlotGeneration({
          jobId,
          slotId: slot.id,
          slotLabel: slot.title,
          slotPrompt,
          slotType: slot.type,
          productImage: job.productImageUrl || null,
          modelImage: job.modelImageUrl || null,
          referenceImage: job.referenceImageUrl || null,
        });

        if (!generated.length) throw new Error("未返回图片");
        setBalanceRefreshTick((v) => v + 1);
        updateBatchJobById(jobId, (target) => {
          const nextSlots = target.slots.map((s) => {
            if (s.id !== slot.id) return s;
            const prevLast = s.versions[s.versions.length - 1];
            const appended = generated.map((v, idx) => ({
              ...v,
              index: s.versions.length + idx + 1,
              source: s.versions.length === 0 ? "generate" : "rerun",
              parentVersionId: prevLast?.id,
            }));
            return {
              ...s,
              status: "completed" as const,
              versions: [
                ...s.versions.map((v) => ({ ...v, isPrimary: false })),
                ...appended.map((v, idx) => ({ ...v, isPrimary: idx === 0 })),
              ],
              activeVersionId: appended[0]?.id || s.activeVersionId,
            };
          });
          const next = {
            ...target,
            slots: nextSlots,
            status: mapSlotStatusToJobStatus(nextSlots),
            updatedAt: nowTs(),
          };
          return appendBatchActionLog(next, "slot_run_success", { slotId: slot.id, generatedCount: generated.length });
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        updateBatchJobById(jobId, (target) => {
          const nextSlots = target.slots.map((s) => (s.id === slot.id ? { ...s, status: "failed", error: msg } : s));
          const next = {
            ...target,
            slots: nextSlots,
            status: mapSlotStatusToJobStatus(nextSlots),
            updatedAt: nowTs(),
          };
          return appendBatchActionLog(next, "slot_run_failed", { slotId: slot.id, error: msg });
        });
      }
    }

    updateBatchJobById(jobId, (target) => {
      const finalStatus = mapSlotStatusToJobStatus(target.slots);
      const next = { ...target, status: finalStatus, updatedAt: nowTs() };
      return appendBatchActionLog(next, "job_finished", { status: finalStatus });
    });

    batchDispatch({ type: SET_BATCH_GENERATING, payload: false });
    batchDispatch({ type: SET_BATCH_GENERATION_PROGRESS, payload: null });
    if (batchAbortRef.current === controller) {
      batchAbortRef.current = null;
    }
  }, [appendBatchActionLog, batchJobs, buildBatchSlotPrompt, currentSession, inputText, isBatchGenerating, runBatchSlotGeneration, updateBatchJobById, batchDispatch, uiDispatch]);

  // Auto-start generation when a new batch job is created via the streamlined flow
  useEffect(() => {
    const targetId = autoStartBatchJobIdRef.current;
    if (!targetId) return;
    const job = batchJobs.find((j) => j.id === targetId);
    if (!job) return;
    if (job.status === "draft") {
      autoStartBatchJobIdRef.current = null;
      void handleRunAllBatchSlots(targetId, "all");
    }
  }, [batchJobs, handleRunAllBatchSlots]);

  const handleRefineSlot = useCallback(async (jobId: string, slotId: string, instruction: string) => {
    const job = batchJobs.find((j) => j.id === jobId);
    const slot = job?.slots.find((s) => s.id === slotId);
    if (!job || !slot || !currentSession || isBatchGenerating) return;
    if (job.status === "deleted" || job.status === "archived") return;

    const activeVersion = slot.versions.find((v) => v.isPrimary)
      || (slot.activeVersionId && slot.versions.find((v) => v.id === slot.activeVersionId))
      || slot.versions[slot.versions.length - 1]
      || null;
    if (!activeVersion?.imageUrl) return;

    batchAbortRef.current?.abort();
    batchAbortRef.current = new AbortController();
    const controller = batchAbortRef.current;

    batchDispatch({ type: SET_BATCH_GENERATING, payload: true });
    batchDispatch({
      type: SET_REFINING_SLOT_IDS,
      payload: new Set([...refiningSlotIds, slotId]),
    });
    batchDispatch({
      type: SET_BATCH_GENERATION_PROGRESS,
      payload: { currentSlot: 1, totalSlots: 1, currentSlotLabel: `${slot.title} 优化调整` },
    });

    updateBatchJobById(jobId, (target) => {
      const nextSlots = target.slots.map((s) => (s.id === slotId ? { ...s, status: "running" as const, error: undefined } : s));
      const next = { ...target, slots: nextSlots, status: "running" as const, updatedAt: nowTs() };
      return appendBatchActionLog(next, "slot_refine_start", { slotId, instruction });
    });

    try {
      const currentModel = getEffectiveApiConfig().defaultImageModel;
      const size = aspectRatioToSize(currentSession.settings.aspectRatio);

      const images = [await urlToDataUrl(activeVersion.imageUrl)];

      const sceneDirective = getBatchSceneDirective(slot.type as BatchSetItem["scene"]);
      const promptUsed = [
        `当前图片类型为「${slot.title}」。${sceneDirective}`,
        "基于提供的图片进行调整，严格保持产品外观、模特形象等核心元素不变。",
        `调整要求：${instruction}`,
        "仅修改调整要求中提到的内容，其余部分尽量保持不变。输出构图完整、主体清晰。",
      ].join("\n");

      const resp = await imagesGenerations(
        {
          prompt: promptUsed,
          n: 1,
          response_format: ResponseFormat.Url,
          size,
          image: images,
        },
        { signal: controller.signal, queueSource: "batch" }
      );

      const generated: BatchVersion[] = await Promise.all(
        (resp.data || [])
          .map((o) => (o ? imageObjToDataUrl(o) : null))
          .filter((u): u is string => Boolean(u))
          .map(async (url, idx) => {
            let persistentUrl = url;
            try { persistentUrl = await urlToDataUrl(url); }
            catch (e) { console.warn("优化图片转换失败:", e); }
            return {
              id: uuidv4(),
              slotId,
              index: idx + 1,
              imageUrl: persistentUrl,
              model: resp.model_used || currentModel,
              promptUsed,
              size,
              createdAt: nowTs(),
              source: "refine" as const,
              parentVersionId: activeVersion.id,
              isPrimary: idx === 0,
            };
          })
      );

      if (!generated.length) throw new Error("未返回图片");
      setBalanceRefreshTick((v) => v + 1);

      updateBatchJobById(jobId, (target) => {
        const nextSlots = target.slots.map((s) => {
          if (s.id !== slotId) return s;
          const appended = generated.map((v, idx) => ({ ...v, index: s.versions.length + idx + 1 }));
          return {
            ...s,
            status: "completed" as const,
            error: undefined,
            versions: [
              ...s.versions.map((v) => ({ ...v, isPrimary: false })),
              ...appended.map((v, idx) => ({ ...v, isPrimary: idx === 0 })),
            ],
            activeVersionId: appended[0]?.id || s.activeVersionId,
          };
        });
        const next = { ...target, slots: nextSlots, status: mapSlotStatusToJobStatus(nextSlots), updatedAt: nowTs() };
        return appendBatchActionLog(next, "slot_refine_success", { slotId, instruction, generatedCount: generated.length });
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      updateBatchJobById(jobId, (target) => {
        const nextSlots = target.slots.map((s) => (s.id === slotId ? { ...s, status: "failed" as const, error: msg } : s));
        const next = { ...target, slots: nextSlots, status: mapSlotStatusToJobStatus(nextSlots), updatedAt: nowTs() };
        return appendBatchActionLog(next, "slot_refine_failed", { slotId, instruction, error: msg });
      });
    } finally {
      batchDispatch({ type: SET_BATCH_GENERATING, payload: false });
      const nextRefining = new Set(refiningSlotIds);
      nextRefining.delete(slotId);
      batchDispatch({ type: SET_REFINING_SLOT_IDS, payload: nextRefining });
      batchDispatch({ type: SET_BATCH_GENERATION_PROGRESS, payload: null });
      if (batchAbortRef.current === controller) {
        batchAbortRef.current = null;
      }
    }
  }, [appendBatchActionLog, batchJobs, currentSession, isBatchGenerating, refiningSlotIds, updateBatchJobById, batchDispatch]);

  const handleMaskSubmit = async (params: {
    baseImageUrl: string;
    prompt: string;
    maskDataUrl: string;
    maskOverlayDataUrl: string;
  }): Promise<{ generatedImageUrls?: string[] }> => {
    if (!currentSession) return { generatedImageUrls: [] };
    const base = params.baseImageUrl;
    if (!base) return { generatedImageUrls: [] };

    if (maskEditContext?.source === "batch") {
      const jobId = maskEditContext.jobId;
      const slotId = maskEditContext.slotId;
      const job = batchJobs.find((j) => j.id === jobId);
      const slot = job?.slots.find((s) => s.id === slotId);
      if (!job || !slot) {
        throw new Error("矩阵槽位不存在或已被删除。");
      }

      batchAbortRef.current?.abort();
      batchAbortRef.current = new AbortController();
      const controller = batchAbortRef.current;

      batchDispatch({ type: SET_BATCH_GENERATING, payload: true });
      batchDispatch({
        type: SET_BATCH_GENERATION_PROGRESS,
        payload: { currentSlot: 1, totalSlots: 1, currentSlotLabel: `${slot.title} 局部编辑` },
      });

      const size = aspectRatioToSize(currentSession.settings.aspectRatio);
      const model = apiConfig.defaultImageModel || "";
      const supportsEdits = /^gpt-image/i.test(model) || /^dall-e/i.test(model);
      let generatedImageUrls: string[] = [];
      let modelUsed = model;

      const appendToBatch = (urls: string[], resolvedModel: string, resolvedSize: string) => {
        updateBatchJobById(jobId, (target) => {
          const nextSlots = target.slots.map((s) => {
            if (s.id !== slotId) return s;
            const prevLast = s.versions[s.versions.length - 1];
            const appended: BatchVersion[] = urls.map((url, idx) => ({
              id: uuidv4(),
              slotId: s.id,
              index: s.versions.length + idx + 1,
              imageUrl: url,
              model: resolvedModel,
              promptUsed: params.prompt,
              size: resolvedSize,
              createdAt: nowTs(),
              parentVersionId: prevLast?.id || maskEditContext.versionId,
              source: "mask-edit",
              isPrimary: idx === 0,
            }));
            return {
              ...s,
              status: "completed" as const,
              versions: [
                ...s.versions.map((v) => ({ ...v, isPrimary: false })),
                ...appended,
              ],
              activeVersionId: appended[0]?.id || s.activeVersionId,
              error: undefined,
            };
          });
          const next = {
            ...target,
            slots: nextSlots,
            status: mapSlotStatusToJobStatus(nextSlots),
            updatedAt: nowTs(),
          };
          return appendBatchActionLog(next, "slot_mask_edit_success", { slotId, generatedCount: urls.length });
        });
      };

      try {
        if (supportsEdits) {
          const resp = await imagesEdits(
            {
              image: [base],
              mask: params.maskDataUrl,
              prompt: params.prompt,
              n: 1,
              size,
              response_format: ResponseFormat.Url,
              model,
            },
            { api: apiConfig, signal: controller.signal, queueSource: "mask-edit" }
          );
          generatedImageUrls = (resp.data || [])
            .map((o) => (o ? imageObjToDataUrl(o) : null))
            .filter((u): u is string => Boolean(u));
          modelUsed = resp.model_used || model;
        }

        if (!generatedImageUrls.length) {
          const augmentedPrompt =
            `${params.prompt}\n\n` +
            `说明：第二张参考图是遮罩提示图，红色区域是需要修改的区域；其它区域尽量保持不变，并严格保持人物/风格一致性。`;

          let fallbackBase = base;
          if (!isDataOrBlobUrl(base)) {
            try {
              fallbackBase = await ensureImageDataUrl(base, controller.signal);
            } catch (e) {
              console.warn("底图转 data URL 失败，继续使用原图 URL：", e);
            }
          }

          const result = await generateResponse(
            augmentedPrompt,
            fallbackBase,
            selectedModelImage,
            selectedProductImage,
            [],
            currentSession.settings,
            {
              n: 1,
              size,
              responseFormat: "url",
              extraImages: [params.maskOverlayDataUrl],
              disableAutoUseLastImage: true,
              signal: controller.signal,
              queueSource: "mask-edit",
            }
          );
          generatedImageUrls = result.images;
          modelUsed = result.modelUsed || modelUsed;
        }

        if (!generatedImageUrls.length) {
          throw new Error("局部编辑未生成新图。");
        }

        const persistentUrls = await Promise.all(
          generatedImageUrls.map(async (url) => {
            try {
              return await urlToDataUrl(url);
            } catch (e) {
              console.warn('遮罩编辑图片转换失败，使用原 URL:', e);
              return url;
            }
          })
        );

        appendToBatch(persistentUrls, modelUsed, size);
        setBalanceRefreshTick((v) => v + 1);
        return { generatedImageUrls };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        updateBatchJobById(jobId, (target) => {
          const nextSlots = target.slots.map((s) => (s.id === slotId ? { ...s, status: "failed", error: msg } : s));
          const next = {
            ...target,
            slots: nextSlots,
            status: mapSlotStatusToJobStatus(nextSlots),
            updatedAt: nowTs(),
          };
          return appendBatchActionLog(next, "slot_mask_edit_failed", { slotId, error: msg });
        });
        throw e;
      } finally {
        batchDispatch({ type: SET_BATCH_GENERATING, payload: false });
        batchDispatch({ type: SET_BATCH_GENERATION_PROGRESS, payload: null });
        if (batchAbortRef.current === controller) {
          batchAbortRef.current = null;
        }
      }
    }

    const userMsg: Message = {
      id: uuidv4(),
      role: "user",
      parts: [
        { type: "text", text: `(局部编辑) ${params.prompt}` },
        { type: "image", imageUrl: base },
        { type: "image", imageUrl: params.maskOverlayDataUrl },
      ],
      timestamp: Date.now(),
    };

    const updatedMessages = [...currentSession.messages, userMsg];
    const updatedMessagesLength = updatedMessages.length;
    projectDispatch({
      type: UPDATE_SESSION,
      payload: {
        id: currentSession.id,
        updater: (s) => ({ ...s, messages: updatedMessages, updatedAt: Date.now() }),
      },
    });

    const model = apiConfig.defaultImageModel || "";
    const supportsEdits = /^gpt-image/i.test(model) || /^dall-e/i.test(model);
    if (supportsEdits) {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const controller = abortRef.current;
      let handoffToFallback = false;
      try {
        uiDispatch({ type: SET_GENERATING, payload: true });
        uiDispatch({ type: SET_ERROR_DETAILS, payload: null });
        uiDispatch({ type: SET_GENERATION_PROGRESS, payload: null });
        uiDispatch({ type: SET_GENERATION_STAGE, payload: "正在进行遮罩编辑..." });

        const n = Math.min(Math.max(currentSession.settings.batchCount || 1, 1), 10);
        const size = aspectRatioToSize(currentSession.settings.aspectRatio);
        const rf = ResponseFormat.Url;

        const resp = await imagesEdits(
          {
            image: [base],
            mask: params.maskDataUrl,
            prompt: params.prompt,
            n,
            size,
            response_format: rf,
            model,
          },
          { api: apiConfig, signal: controller.signal, queueSource: "mask-edit" }
        );

        const aiMessage: Message = {
          id: uuidv4(),
          role: "model",
          parts: [{ type: "text", text: "操作：局部编辑（遮罩）" }],
          timestamp: Date.now(),
        };

        for (const o of resp.data || []) {
          const url = o ? imageObjToDataUrl(o) : null;
          if (!url) continue;
          aiMessage.parts.push({
            type: "image",
            imageUrl: url,
            meta: {
              id: uuidv4(),
              createdAt: Date.now(),
              prompt: params.prompt,
              model: resp.model_used || model,
              size,
              responseFormat: "url",
              parentImageUrl: base,
              action: "局部编辑（遮罩）",
            },
          });
        }

        const nextMessages = [...updatedMessages, aiMessage];
        projectDispatch({
          type: UPDATE_SESSION,
          payload: {
            id: currentSession.id,
            updater: (s) => ({ ...s, messages: nextMessages, updatedAt: Date.now() }),
          },
        });
        setBalanceRefreshTick((v) => v + 1);
        const generatedImageUrls = aiMessage.parts
          .filter((p) => p.type === "image" && p.imageUrl)
          .map((p) => p.imageUrl as string);
        if (generatedImageUrls.length === 0) {
          throw new Error("局部编辑未返回新图片，请重试。");
        }
        return { generatedImageUrls };
      } catch (e) {
        console.warn("images/edits 失败，自动退化为参考图编辑：", e);
        handoffToFallback = true;
      } finally {
        if (!handoffToFallback) {
          uiDispatch({ type: SET_GENERATING, payload: false });
          uiDispatch({ type: SET_GENERATION_STAGE, payload: null });
        } else {
          uiDispatch({ type: SET_GENERATION_STAGE, payload: "原生编辑失败，已切换为参考图模式" });
        }
        uiDispatch({ type: SET_GENERATION_PROGRESS, payload: null });
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    }

    const augmentedPrompt =
      `${params.prompt}\n\n` +
      `说明：第二张参考图是遮罩提示图，红色区域是需要修改的区域；其它区域尽量保持不变，并严格保持人物/风格一致性。`;

    let fallbackBase = base;
    if (!isDataOrBlobUrl(base)) {
      try {
        fallbackBase = await ensureImageDataUrl(base);
      } catch (e) {
        console.warn("底图转 data URL 失败，继续使用原图 URL：", e);
      }
    }

    const nextMessages = await executeGeneration(augmentedPrompt, fallbackBase, updatedMessages, {
      action: "局部编辑",
      extraImages: [params.maskOverlayDataUrl],
      forceNoAutoReuse: true,
      queueSource: "mask-edit",
    });

    const generatedImageUrls: string[] = [];
    if (Array.isArray(nextMessages)) {
      for (let i = updatedMessagesLength; i < nextMessages.length; i++) {
        const m = nextMessages[i];
        if (m.role !== "model") continue;
        for (const p of m.parts) {
          if (p.type === "image" && p.imageUrl) generatedImageUrls.push(p.imageUrl);
        }
      }
    }
    if (generatedImageUrls.length === 0) {
      throw new Error("局部编辑未生成新图。请检查模型、网络或提示词后重试。");
    }
    return { generatedImageUrls };
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const retryLastGeneration = async () => {
    if (isGenerating || !lastRunRef.current || !currentSession) return;
    const last = lastRunRef.current;
    await executeGeneration(last.prompt, last.image, currentSession.messages, last.opts);
  };

  // ——— Render ———

  if (!authReady) {
    return (
      <div className="min-h-screen bg-white text-[var(--piveo-text)] flex items-center justify-center">
        <div className="text-sm text-[var(--piveo-body)]">正在检查登录状态...</div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="min-h-screen bg-white text-[var(--piveo-text)] flex items-center justify-center p-4">
        <form onSubmit={handleLoginSubmit} className="w-full max-w-sm bg-[var(--piveo-card)] border border-[var(--piveo-border)] rounded-2xl p-6 space-y-4 shadow-[0_4px_12px_rgba(0,0,0,0.06)]">
          <div className="text-xl font-bold text-[var(--piveo-accent)]">Piveo</div>
          <div className="text-sm text-[var(--piveo-body)]">请登录后继续使用。</div>
          <div className="space-y-2">
            <label className="text-xs text-[var(--piveo-body)]">账号</label>
            <input
              type="text"
              value={loginForm.username}
              onChange={(e) => setLoginForm((prev) => ({ ...prev, username: e.target.value }))}
              className="w-full bg-white border border-[var(--piveo-border)] rounded-lg px-3 py-2 text-sm text-[var(--piveo-text)] focus:outline-none focus:border-[var(--piveo-text)]"
              placeholder="请输入账号"
              autoComplete="username"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-[var(--piveo-body)]">密码</label>
            <input
              type="password"
              value={loginForm.password}
              onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))}
              className="w-full bg-white border border-[var(--piveo-border)] rounded-lg px-3 py-2 text-sm text-[var(--piveo-text)] focus:outline-none focus:border-[var(--piveo-text)]"
              placeholder="请输入密码"
              autoComplete="current-password"
            />
          </div>
          {authError && <div className="text-xs text-red-400">{authError}</div>}
          <button
            type="submit"
            disabled={authLoading}
            className="w-full bg-[var(--piveo-accent)] hover:bg-[var(--piveo-accent-hover)] disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition-colors"
          >
            {authLoading ? "登录中..." : "登录"}
          </button>
        </form>
      </div>
    );
  }

  if (!hasHydratedStorage) {
    return (
      <div className="min-h-screen bg-white text-[var(--piveo-text)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-[var(--piveo-accent)] border-t-transparent rounded-full animate-spin" />
          <div className="text-sm text-[var(--piveo-body)]">正在加载数据...</div>
        </div>
      </div>
    );
  }

  if (!currentSession) return <div className="text-white text-center mt-10">初始化中...</div>;

  // Handle navView changes from NavRail
  const handleNavChange = (view: string) => {
    setNavView(view);
    // Map nav views to legacy currentView where applicable
    if (view === 'project') {
      uiDispatch({ type: SET_CURRENT_VIEW, payload: 'chat' });
    }
    // Library views are now inline MainContent views
    if (view === 'assets') {
      openAssets();
    }
  };

  const onboardingProps = {
    onFileUpload: handleOnboardingFileUpload,
    onPaste: handleOnboardingPaste,
    onQuickStart: handleOnboardingQuickStart,
    onPromptSubmit: handleOnboardingPromptSubmit,
    templates: templates.map((t) => ({ name: t.name, content: t.content })),
    products,
    onProductSelect: (product: ProductCatalogItem) => {
      const settings = currentSession?.settings;
      if (settings) {
        handleUpdateSettings({ ...settings, productImage: { id: product.id, imageUrl: product.imageUrl, createdAt: Date.now() } });
      }
    },
    activeBrandKit,
    onSetupBrandKit: () => setNavView('brandkit'),
  };

  const projectBatchProgress = batchGenerationProgress
    ? {
        generate: {
          current: batchGenerationProgress.currentSlot,
          total: batchGenerationProgress.totalSlots,
          status: batchGenerationProgress.currentSlotLabel,
        },
      }
    : undefined;

  // Property panel for the right side
  const propertyPanelElement = (navView === 'studio' || navView === 'project') ? (
    <PropertyPanel
      settings={currentSession.settings}
      onUpdateSettings={handleUpdateSettings}
      models={models}
      products={products}
      onAddModel={handleAddModel}
      onDeleteModel={handleDeleteModel}
      templates={templates}
      onSaveTemplate={handleSaveTemplate}
      selectedImage={selectedImage}
      onClearSelectedImage={() => uiDispatch({ type: SET_SELECTED_IMAGE, payload: null })}
      selectedGalleryImage={selectedGalleryImage}
      onClearGalleryImage={() => setSelectedGalleryImageId(null)}
      onGalleryImageAction={handleGalleryImageAction}
      activeBrandKit={activeBrandKit}
      onGoToBrandKit={() => setNavView('brandkit')}
    />
  ) : undefined;

  // Project view content: restore legacy gallery + prompt flow.
  const projectViewContent = (
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--piveo-bg)]">
      {currentView === "batch" ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <BatchJobsPanel
            jobs={batchJobs}
            selectedJobId={selectedBatchJobId}
            isBusy={isBatchGenerating}
            models={models}
            onSelectJob={(jobId) => batchDispatch({ type: SET_SELECTED_BATCH_JOB_ID, payload: jobId })}
            onRunSlot={(jobId, slotId) => {
              void handleRunSingleBatchSlot(jobId, slotId);
            }}
            onSetPrimaryVersion={handleSetPrimaryBatchVersion}
            onOpenMaskEdit={openMaskEditFromBatch}
            onArchiveJob={handleArchiveBatchJob}
            onRestoreJob={handleRestoreBatchJob}
            onSoftDeleteJob={handleSoftDeleteBatchJob}
            onRecoverDeletedJob={handleRecoverDeletedBatchJob}
            onDuplicateJob={handleDuplicateBatchJob}
            onDownloadVersion={(v) => {
              void handleDownloadBatchVersion(v);
            }}
            onCancelGeneration={cancelBatchGeneration}
            onRunAllSlots={(jobId, mode) => {
              void handleRunAllBatchSlots(jobId, mode);
            }}
            onCreateJob={openBatchSetModal}
            onRenameJob={handleRenameBatchJob}
            onAddSlots={handleOpenAddSlots}
            onRefineSlot={(jobId, slotId, instruction) => {
              void handleRefineSlot(jobId, slotId, instruction);
            }}
            refiningSlotIds={refiningSlotIds}
            onGoBack={() => uiDispatch({ type: SET_CURRENT_VIEW, payload: 'chat' })}
          />
        </div>
      ) : (
        <>
          <ImageGallery
            images={galleryImages}
            onImageClick={handleGalleryImageClick}
            onImageAction={handleGalleryImageAction}
            selectedImageId={selectedGalleryImageId || undefined}
            isGenerating={isGenerating}
            batchProgress={projectBatchProgress}
            onboardingProps={onboardingProps}
            onOpenBatchSet={openBatchSetModal}
            onGoToBatch={() => uiDispatch({ type: SET_CURRENT_VIEW, payload: 'batch' })}
          />
          {(queueStatusText || generationStage || errorDetails) && (
            <div className="border-t border-[var(--piveo-border)] bg-[var(--piveo-card)] px-4 py-2.5 space-y-1.5">
              {queueStatusText && <div className="text-[11px] text-[var(--piveo-body)]">{queueStatusText}</div>}
              {generationStage && (
                <div className="text-[11px] text-[var(--piveo-accent)]">
                  {generationStage}
                  {generationProgress ? ` (${generationProgress.current}/${generationProgress.total})` : ''}
                </div>
              )}
              {errorDetails && (
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] text-red-600 truncate">{errorDetails.message}</div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void retryLastGeneration()}
                      disabled={isGenerating}
                      className="px-2 py-1 text-[10px] rounded border border-[var(--piveo-border)] text-[var(--piveo-text)] bg-white hover:bg-[#EEF2F6] disabled:opacity-50"
                    >
                      重试
                    </button>
                    <button
                      type="button"
                      onClick={cancelGeneration}
                      disabled={!isGenerating}
                      className="px-2 py-1 text-[10px] rounded border border-[var(--piveo-border)] text-[var(--piveo-text)] bg-white hover:bg-[#EEF2F6] disabled:opacity-50"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={() => uiDispatch({ type: SET_ERROR_DETAILS, payload: null })}
                      className="px-2 py-1 text-[10px] rounded border border-[var(--piveo-border)] text-[var(--piveo-body)] bg-white hover:bg-[#EEF2F6]"
                    >
                      关闭
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <PromptBar
            inputText={inputText}
            onInputChange={(text) => uiDispatch({ type: SET_INPUT_TEXT, payload: text })}
            onSend={() => { void handleSendMessage(); }}
            onImageUpload={handleOnboardingFileUpload}
            onEnhance={() => { void handleEnhancePrompt(); }}
            isGenerating={isGenerating}
            isEnhancing={isEnhancing}
            selectedImage={selectedImage ? { url: selectedImage, source: 'manual' } : null}
            onClearImage={() => uiDispatch({ type: SET_SELECTED_IMAGE, payload: null })}
            referenceIntent={referenceIntent}
            onReferenceIntentChange={(intent) => uiDispatch({ type: SET_REFERENCE_INTENT, payload: intent })}
          />
          <div ref={chatEndRef} />
        </>
      )}
    </div>
  );

  return (
    <Layout
      navView={navView}
      onNavChange={handleNavChange}
      propertyPanel={propertyPanelElement}
      sessions={sessions}
      currentSessionId={currentSessionId}
      onSelectSession={(id) => {
        projectDispatch({ type: SET_CURRENT_SESSION_ID, payload: id });
        uiDispatch({ type: SET_CURRENT_VIEW, payload: "chat" });
        setNavView('project');
      }}
      onNewSession={handleNewSession}
      onDeleteSession={handleDeleteSession}
      authUser={authUser}
      onLogout={handleLogout}
      onOpenSettings={() => setNavView('settings')}
      assetCount={totalAssetCount}
      modelCount={models.length}
      productCount={products.length}
      isSuperAdmin={isSuperAdmin}
    >
      <MainContent
        navView={navView}
        galleryProps={{
          images: galleryImages,
          onImageClick: handleGalleryImageClick,
          onImageAction: handleGalleryImageAction,
          selectedImageId: selectedGalleryImageId || undefined,
          isGenerating,
          batchProgress: projectBatchProgress,
          onboardingProps,
          onOpenBatchSet: openBatchSetModal,
          onGoToBatch: () => uiDispatch({ type: SET_CURRENT_VIEW, payload: 'batch' }),
        }}
        projectListProps={{
          projects: sessions,
          currentProjectId: currentSessionId,
          onSelectProject: (id) => {
            projectDispatch({ type: SET_CURRENT_SESSION_ID, payload: id });
            uiDispatch({ type: SET_CURRENT_VIEW, payload: 'chat' });
            setNavView('project');
          },
          onCreateProject: handleNewSession,
          onDeleteProject: handleDeleteSession,
          currentTeamId,
        }}
        settingsElement={
          <SettingsPanel
            apiConfig={apiConfig}
            onUpdateApiConfig={handleUpdateApiConfig}
            hasActiveFeature={currentSession.settings.selectedModelId !== null || currentSession.settings.autoUseLastImage}
            authUser={authUser}
            authLoading={authLoading}
            onLogout={handleLogout}
            defaultPreferences={defaultPreferences}
            onUpdateDefaultPreferences={handleUpdateDefaultPreferences}
            balanceRefreshTick={balanceRefreshTick}
            isSuperAdmin={isSuperAdmin}
            onClose={() => setNavView('project')}
          />
        }
        assetsElement={
          <AssetsModal
            assets={allAssets}
            onOpenMaskEdit={openMaskEditFromChat}
            onUseAsReference={(imageUrl) => {
              uiDispatch({ type: SET_SELECTED_IMAGE, payload: imageUrl });
              setNavView('project');
            }}
            onUsePrompt={(prompt) => {
              uiDispatch({ type: SET_INPUT_TEXT, payload: prompt });
              setNavView('project');
            }}
          />
        }
        modelsElement={
          <ModelsLibraryModal
            models={models}
            onAddModel={handleAddModel}
            onDeleteModel={handleDeleteModel}
            onRenameModel={handleRenameModel}
          />
        }
        productsElement={
          <ProductsLibraryModal
            products={products}
            onAddProduct={handleAddProduct}
            onUpdateProduct={handleUpdateProduct}
            onDeleteProduct={handleDeleteProduct}
          />
        }
        brandKitElement={
          <BrandKitPanel
            brandKits={brandKits}
            onAdd={handleAddBrandKit}
            onUpdate={handleUpdateBrandKit}
            onDelete={handleDeleteBrandKit}
            onActivate={handleActivateBrandKit}
            onSetRatings={handleSetBrandTasteRatings}
            onSetTasteProfile={handleSetBrandTasteProfile}
          />
        }
        adminElement={
          isSuperAdmin ? (
            <AdminPanel onClose={() => setNavView('project')} />
          ) : undefined
        }
        videoElement={<VideoGenerationPage />}
        teamElement={
          <TeamManager
            teams={teams}
            currentTeamId={currentTeamId}
            onCreateTeam={handleCreateTeam}
            onDeleteTeam={handleDeleteTeam}
            onUpdateTeam={handleUpdateTeam}
            onAddMember={handleAddMember}
            onRemoveMember={handleRemoveMember}
            onSwitchTeam={handleSwitchTeam}
          />
        }
      >
        {projectViewContent}
      </MainContent>

      {/* Modals — rendered inside Layout but overlay on top */}
      {previewImageUrl && <ImagePreviewModal imageUrl={previewImageUrl} onClose={() => uiDispatch({ type: SET_PREVIEW_IMAGE, payload: null })} />}
      {refineTarget && (
        <RefinePanel
          imageUrl={refineTarget.imageUrl}
          prompt={refineTarget.prompt}
          model={apiConfig.defaultImageModel}
          aspectRatio={currentSession.settings.aspectRatio}
          systemPrompt={currentSession.settings.systemPrompt}
          onClose={() => setRefineTarget(null)}
          onFinish={handleRefineFinish}
        />
      )}
      {swapModelTarget && (
        <SwapModelModal
          sourceImageUrl={swapModelTarget.imageUrl}
          sourcePrompt={swapModelTarget.prompt}
          models={models}
          settings={currentSession.settings}
          onAddModel={handleAddModel}
          onClose={() => setSwapModelTarget(null)}
          onFinish={handleSwapModelFinish}
        />
      )}
      <BatchSetModal
        isOpen={isBatchSetOpen}
        onClose={() => { setIsBatchSetOpen(false); setAddSlotsTargetJobId(null); }}
        onSubmit={(items) => {
          void handleBatchSetSubmit(items);
        }}
        referenceImageUrl={selectedImage || undefined}
      />
      {/* Before/After comparison overlay */}
      {compareState && (
        <BeforeAfterView
          beforeUrl={compareState.beforeUrl}
          afterUrl={compareState.afterUrl}
          onClose={() => setCompareState(null)}
          onExport={() => exportComparison(compareState.beforeUrl, compareState.afterUrl)}
        />
      )}
      {/* ErrorDetailsModal replaced by inline expandable banner above */}
      {maskEditBaseUrl && (
        <MaskEditorModal
          baseImageUrl={maskEditBaseUrl}
          historyItems={maskHistoryItems}
          onSelectBaseImage={setMaskEditBaseUrl}
          onClose={() => {
            setMaskEditBaseUrl(null);
            uiDispatch({ type: SET_MASK_EDIT_CONTEXT, payload: null });
          }}
          onSubmit={handleMaskSubmit}
        />
      )}

    </Layout>
  );
};

const App: React.FC = () => {
  return (
    <ToastProvider>
      <AppProvider>
        <AppInner />
      </AppProvider>
    </ToastProvider>
  );
};

export default App;
