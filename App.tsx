
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Sidebar } from './components/Sidebar';
import { ChatMessage } from './components/ChatMessage';
import { ImagePreviewModal } from './components/ImagePreviewModal';
import { Icon } from './components/Icon';
import { AspectRatio, BatchJob, BatchJobStatus, BatchSlot, BatchVersion, ImageResponseFormat, ProductScale, Message, Session, SessionSettings, SystemTemplate, ModelCharacter } from './types';
import { initPersistentStorage, loadBatchJobs, loadSessions, loadTemplates, loadModels, saveBatchJobs, saveSessions, saveTemplates, saveModels, clearAll, backupSessionsSync } from './services/storage';
import { generateResponse, enhancePrompt, type GenerateResponseResult } from './services/gemini';
import { DEFAULT_ASPECT_RATIO } from './constants';
import { ApiConfig, getEffectiveApiConfig, saveStoredApiConfig } from './services/apiConfig';
import { AssetsModal, type AssetItem } from './components/AssetsModal';
import { ErrorDetailsModal, type ErrorDetails } from './components/ErrorDetailsModal';
import { MaskEditorModal, type MaskEditorHistoryItem } from './components/MaskEditorModal';
import { imagesEdits, imageObjToDataUrl, ResponseFormat } from './services/openaiImages';
import { filterSizesByAspect, getSupportedAspectRatios, getSupportedSizeForAspect } from './services/sizeUtils';
import { PromptModelPanel } from './components/PromptModelPanel';
import { SystemPromptBar } from './components/SystemPromptBar';
import { getSession, login, logout } from './services/auth';
import { BatchSetItem, BatchSetModal } from './components/BatchSetModal';
import { BatchJobsPanel } from './components/BatchJobsPanel';
import { downloadImageWithFormat, loadDownloadOptions } from './services/imageDownload';
import { ModelsLibraryModal } from './components/ModelsLibraryModal';

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

const isLikelyMixedImageInput = (message: string): boolean =>
  /请只使用一种图片输入方式|one image input|url or base64|文件上传、URL 或 base64/i.test(message);

const ADVANCED_PANEL_STORAGE_KEY = "topseller.ui.advanced_panel_open";

const getFriendlyErrorMessage = (message: string): string => {
  if (isLikelyModelUnsupported(message)) return "当前模型不支持生图，请切换到可用图片模型后重试。";
  if (isLikelyMixedImageInput(message)) return "本次请求混用了 URL 和 base64 图片，已触发网关限制。请重试（系统将自动按单一格式发送）。";
  if (isLikelyGatewayTimeout(message)) return "上游网关超时（504），请重试或切换更快模型。";
  if (isLikelyMissingAuth(message)) return "未登录或会话已失效，请重新登录后重试。";
  if (isLikelyCorsOrNetwork(message)) return "网络或跨域错误，请优先使用 `/api` 代理地址。";
  return `生成失败：${message}`;
};

const getErrorAdvice = (message: string): string[] => {
  if (isLikelyModelUnsupported(message)) {
    return [
      "在左下角模型选择器切换为可用图片模型。",
      "推荐先用 gemini-2.5-flash-image 或 gpt-image-1.5。",
      "如果走公网地址失败，改成 /api 并在 .env.local 配置 VITE_API_PROXY_TARGET=https://n.lconai.com。",
    ];
  }
  if (isLikelyGatewayTimeout(message)) {
    return [
      "这是上游服务超时，不是账号配置错误，先直接重试一次。",
      "把尺寸先设为 1:1（1024x1024）、每次生成张数设为 1，可显著降低超时概率。",
      "可切换到更快模型（如 gemini-2.5-flash-image）。",
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

const createNewSession = (templates: SystemTemplate[]): Session => {
  const defaultTemplate = templates.length > 0 ? templates[0].content : '';
  return {
    id: uuidv4(),
    title: '新项目',
    messages: [],
    updatedAt: Date.now(),
    settings: {
      aspectRatio: DEFAULT_ASPECT_RATIO,
      systemPrompt: defaultTemplate,
      selectedModelId: null,
      productScale: ProductScale.Standard,
      responseFormat: "url",
      batchCount: 1,
      batchSizes: [getSupportedSizeForAspect(DEFAULT_ASPECT_RATIO)],
      autoUseLastImage: true,
      productImage: null,
    }
  };
};

const App: React.FC = () => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [batchJobs, setBatchJobs] = useState<BatchJob[]>([]);
  const [selectedBatchJobId, setSelectedBatchJobId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<"chat" | "batch">("chat");
  const [templates, setTemplates] = useState<SystemTemplate[]>([]);
  const [models, setModels] = useState<ModelCharacter[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [apiConfig, setApiConfig] = useState<ApiConfig>(() => getEffectiveApiConfig());
  
  const [inputText, setInputText] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStage, setGenerationStage] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState<{ current: number; total: number } | null>(null);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [batchGenerationProgress, setBatchGenerationProgress] = useState<{
    currentSlot: number;
    totalSlots: number;
    currentSlotLabel: string;
  } | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<ErrorDetails | null>(null);
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false);
  const [isAssetsOpen, setIsAssetsOpen] = useState(false);
  const [isBatchSetOpen, setIsBatchSetOpen] = useState(false);
  const [isModelsLibraryOpen, setIsModelsLibraryOpen] = useState(false);
  const [maskEditBaseUrl, setMaskEditBaseUrl] = useState<string | null>(null);
  const [maskEditContext, setMaskEditContext] = useState<{
    source: "chat";
  } | {
    source: "batch";
    jobId: string;
    slotId: string;
    versionId?: string;
    historyItems: MaskEditorHistoryItem[];
  } | null>(null);
  const [balanceRefreshTick, setBalanceRefreshTick] = useState(0);
  const [hasHydratedStorage, setHasHydratedStorage] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [isAdvancedPanelOpen, setIsAdvancedPanelOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(ADVANCED_PANEL_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const batchAbortRef = useRef<AbortController | null>(null);
  const saveSessionsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSessionsRef = useRef<Session[] | null>(null);
  const latestSessionsRef = useRef<Session[]>([]);
  const saveBatchJobsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBatchJobsRef = useRef<BatchJob[] | null>(null);
  const latestBatchJobsRef = useRef<BatchJob[]>([]);
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
    };
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const checkAuth = async () => {
      const session = await getSession();
      if (cancelled) return;
      setAuthUser(session?.username || null);
      setAuthReady(true);
    };
    void checkAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authReady || !authUser) return;
    let cancelled = false;
    const bootstrap = async () => {
      await initPersistentStorage();
      const [loadedTemplates, loadedModels, loadedSessions, loadedBatchJobs] = await Promise.all([
        loadTemplates(),
        loadModels(),
        loadSessions(),
        loadBatchJobs(),
      ]);
      if (cancelled) return;

      setTemplates(loadedTemplates);
      setModels(loadedModels);
      if (loadedSessions.length > 0) {
        const defaultTemplate = loadedTemplates.length > 0 ? loadedTemplates[0].content : "";
        const localizeLegacyText = (t: string): string => {
          const s = String(t || "").trim();
          if (!s) return s;
          if (s === "An error occurred. Please verify your API settings.") return "发生错误：请检查模型、令牌或网络配置。";
          if (s === "Failed to generate model.") return "生成模特失败。";
          if (s.startsWith("Failed to generate model:")) return `生成模特失败：${s.replace("Failed to generate model:", "").trim()}`;
          return t;
        };
        const normalized = loadedSessions.map((s) => ({
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
        setSessions(normalized);
        setCurrentSessionId(normalized[0].id);
      } else {
        const newSession = createNewSession(loadedTemplates);
        setSessions([newSession]);
        setCurrentSessionId(newSession.id);
      }
      if (Array.isArray(loadedBatchJobs)) {
        setBatchJobs(loadedBatchJobs);
        setSelectedBatchJobId((prev) => prev || loadedBatchJobs[0]?.id || null);
      }
      setHasHydratedStorage(true);
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [authReady, authUser]);

  // P1-7: sessions 保存添加防抖，避免频繁写入
  useEffect(() => {
    latestSessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    latestBatchJobsRef.current = batchJobs;
  }, [batchJobs]);

  useEffect(() => {
    if (!hasHydratedStorage) return;
    pendingSessionsRef.current = sessions;
    if (saveSessionsTimerRef.current) clearTimeout(saveSessionsTimerRef.current);
    saveSessionsTimerRef.current = setTimeout(() => {
      saveSessionsTimerRef.current = null;
      if (pendingSessionsRef.current) {
        void saveSessions(pendingSessionsRef.current);
        pendingSessionsRef.current = null;
      }
    }, 400);
    return () => {
      if (saveSessionsTimerRef.current) clearTimeout(saveSessionsTimerRef.current);
    };
  }, [sessions, hasHydratedStorage]);

  useEffect(() => {
    if (!hasHydratedStorage) return;
    pendingBatchJobsRef.current = batchJobs;
    if (saveBatchJobsTimerRef.current) clearTimeout(saveBatchJobsTimerRef.current);
    saveBatchJobsTimerRef.current = setTimeout(() => {
      saveBatchJobsTimerRef.current = null;
      if (pendingBatchJobsRef.current) {
        void saveBatchJobs(pendingBatchJobsRef.current);
        pendingBatchJobsRef.current = null;
      }
    }, 400);
    return () => {
      if (saveBatchJobsTimerRef.current) clearTimeout(saveBatchJobsTimerRef.current);
    };
  }, [batchJobs, hasHydratedStorage]);

  // beforeunload 时强制 flush，并同步写一份 localStorage 紧急备份
  useEffect(() => {
    const flushSessions = () => {
      let toFlush: Session[] | null = null;
      if (saveSessionsTimerRef.current) {
        clearTimeout(saveSessionsTimerRef.current);
        saveSessionsTimerRef.current = null;
      }
      if (pendingSessionsRef.current) {
        toFlush = pendingSessionsRef.current;
        void saveSessions(pendingSessionsRef.current);
        pendingSessionsRef.current = null;
      }
      backupSessionsSync(toFlush || latestSessionsRef.current);
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
    window.addEventListener("beforeunload", flushSessions);
    return () => window.removeEventListener("beforeunload", flushSessions);
  }, []);
  useEffect(() => {
    if (!hasHydratedStorage) return;
    void saveTemplates(templates);
  }, [templates, hasHydratedStorage]);
  useEffect(() => {
    if (!hasHydratedStorage) return;
    void saveModels(models);
  }, [models, hasHydratedStorage]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ADVANCED_PANEL_STORAGE_KEY, isAdvancedPanelOpen ? "1" : "0");
    } catch {
      // Ignore localStorage write failures.
    }
  }, [isAdvancedPanelOpen]);

  const currentSession = sessions.find(s => s.id === currentSessionId) || sessions[0];
  const currentMessageCount = currentSession?.messages.length || 0;
  const selectedBatchJob = useMemo(
    () => batchJobs.find((j) => j.id === selectedBatchJobId) || batchJobs[0] || null,
    [batchJobs, selectedBatchJobId]
  );

  useEffect(() => {
    if (batchJobs.length === 0) {
      if (selectedBatchJobId !== null) setSelectedBatchJobId(null);
      if (currentView === "batch") setCurrentView("chat");
      return;
    }
    if (selectedBatchJobId && batchJobs.some((j) => j.id === selectedBatchJobId)) return;
    setSelectedBatchJobId(batchJobs[0].id);
  }, [batchJobs, currentView, selectedBatchJobId]);

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
    if (!isAssetsOpen) return [];
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
            sessionTitle: `套图 · ${job.title}`,
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
  }, [sessions, batchJobs, isAssetsOpen]);

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
    for (const key of Array.from(sessionCache.keys())) {
      if (!nextSessionIds.has(key)) sessionCache.delete(key);
    }

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
    for (const key of Array.from(batchCache.keys())) {
      if (!nextJobIds.has(key)) batchCache.delete(key);
    }

    return count;
  }, [sessions, batchJobs]);

  const activeBatchJobCount = useMemo(
    () => batchJobs.reduce((n, j) => n + (j.status !== "deleted" ? 1 : 0), 0),
    [batchJobs]
  );

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((v) => !v);
  }, []);

  const openAssets = useCallback(() => {
    setIsAssetsOpen(true);
  }, []);

  const handleNewSession = useCallback(() => {
    const newSession = createNewSession(templates);
    setSessions((prev) => [newSession, ...prev]);
    setCurrentSessionId(newSession.id);
    setCurrentView("chat");
    setInputText('');
    setSelectedImage(null);
  }, [templates]);

  const handleDeleteSession = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (next.length === 0) {
        const fresh = createNewSession(templates);
        setCurrentSessionId(fresh.id);
        return [fresh];
      }
      if (currentSessionId === id) {
        setCurrentSessionId(next[0].id);
      }
      return next;
    });
  }, [currentSessionId, templates]);

  const handleUpdateSettings = useCallback((newSettings: SessionSettings) => {
    if (!currentSessionId) return;
    setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, settings: newSettings } : s));
  }, [currentSessionId]);

  const handleSaveTemplate = useCallback((newTemplate: SystemTemplate) => {
    setTemplates((prev) => [...prev, newTemplate]);
  }, []);

  const handleAddModel = useCallback((newModel: ModelCharacter) => {
    setModels((prev) => [...prev, newModel]);
  }, []);

  const handleDeleteModel = useCallback((modelId: string) => {
    setModels((prev) => prev.filter((m) => m.id !== modelId));
    // If the deleted model was selected, deselect it
    if (currentSessionId) {
      setSessions(prev => prev.map(s => {
        if (s.id === currentSessionId && s.settings.selectedModelId === modelId) {
          return { ...s, settings: { ...s.settings, selectedModelId: null } };
        }
        return s;
      }));
    }
  }, [currentSessionId]);

  const handleRenameModel = useCallback((modelId: string, newName: string) => {
    setModels((prev) => prev.map((m) => (m.id === modelId ? { ...m, name: newName } : m)));
  }, []);

  const handleUpdateApiConfig = useCallback((cfg: ApiConfig) => {
    setApiConfig(cfg);
    saveStoredApiConfig(cfg);
  }, []);

  const updateBatchJobById = useCallback((jobId: string, updater: (job: BatchJob) => BatchJob) => {
    setBatchJobs((prev) => prev.map((job) => (job.id === jobId ? updater(job) : job)));
  }, []);

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
      `当前任务：这是套图第 ${params.index + 1} 张（共 ${params.total} 张），类型为「${params.sceneLabel}」。`,
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
    referenceImage: string | null;
    productImage: string | null;
    modelImage: string | null;
  }): Promise<BatchVersion[]> => {
    if (!currentSession) return [];
    const size = aspectRatioToSize(currentSession.settings.aspectRatio);
    const responseFormat: ImageResponseFormat = "url";
    const result = await generateResponse(
      params.slotPrompt,
      params.referenceImage,
      params.modelImage,
      params.productImage,
      [],
      currentSession.settings,
      {
        n: 1,
        size,
        responseFormat,
        disableAutoUseLastImage: true,
        signal: batchAbortRef.current?.signal,
      }
    );

    const generated: BatchVersion[] = result.images.map((url, idx) => ({
      id: uuidv4(),
      slotId: params.slotId,
      index: idx + 1,
      imageUrl: url,
      model: result.modelUsed || apiConfig.defaultImageModel,
      promptUsed: result.promptUsed,
      size: result.sizeUsed,
      createdAt: nowTs(),
      source: "generate",
      isPrimary: idx === 0,
    }));

    return generated;
  }, [apiConfig.defaultImageModel, currentSession]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginForm.username.trim() || !loginForm.password) {
      setAuthError("请输入账号和密码。");
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    try {
      const user = await login(loginForm.username.trim(), loginForm.password);
      setAuthUser(user.username);
      setLoginForm({ username: user.username, password: "" });
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "登录失败，请重试。");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    setAuthLoading(true);
    try {
      await logout();
    } catch {
      // ignore network error, still reset local auth state
    } finally {
      // P1-12: 登出时清除持久化数据
      await clearAll().catch(() => {});
      setHasHydratedStorage(false);
      setSessions([]);
      setCurrentSessionId(null);
      setBatchJobs([]);
      setSelectedBatchJobId(null);
      setCurrentView("chat");
      setTemplates([]);
      setModels([]);
      setSelectedImage(null);
      setInputText('');
      setAuthUser(null);
      setAuthLoading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setSelectedImage(reader.result as string);
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
          reader.onloadend = () => setSelectedImage(reader.result as string);
          reader.readAsDataURL(file);
          return;
        }
      }
    }
  };

  const handleEnhancePrompt = async () => {
    if (!inputText.trim() || isEnhancing || isGenerating) return;
    setIsEnhancing(true);
    try {
      const enhancedText = await enhancePrompt(inputText);
      setInputText(enhancedText);
    } catch (e) {
      console.error(e);
      // P1-8: prompt 增强失败时通知用户
      setGenerationStage("提示词增强失败，将使用原始提示词");
      setTimeout(() => setGenerationStage((prev) => prev === "提示词增强失败，将使用原始提示词" ? null : prev), 3000);
    } finally {
      setIsEnhancing(false);
    }
  };

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

    setIsGenerating(true);
    setErrorDetails(null);
    setIsErrorModalOpen(false);
    setGenerationProgress(null);

    let stage = "准备请求...";
    setGenerationStage(stage);

    let modelImage: string | null = null;
    if (currentSession.settings.selectedModelId) {
      const selectedModel = models.find(m => m.id === currentSession.settings.selectedModelId);
      if (selectedModel) modelImage = selectedModel.imageUrl;
    }

    let productImageUrl: string | null = null;
    if (currentSession.settings.productImage) {
      productImageUrl = currentSession.settings.productImage.imageUrl;
    }

    const messagesToUse = customMessages || currentSession.messages;
    let updatedMessages = messagesToUse;

    const parentImageUrl = image || findLastImageUrl(messagesToUse);

    try {
      for (let i = 0; i < sizes.length; i++) {
        const size = sizes[i];
        setGenerationProgress({ current: i + 1, total: sizes.length });
        stage = `正在生成首图（${i + 1}/${sizes.length}）· 尺寸 ${size}...`;
        setGenerationStage(stage);

        // 固定本轮上下文：同一批次内后续补图不读取新生成结果，避免“越补越漂”。
        const generationBaseMessages = updatedMessages;

        const firstResult = await generateResponse(
          prompt,
          image,
          modelImage,
          productImageUrl,
          generationBaseMessages,
          currentSession.settings,
          {
            n: 1,
            size,
            responseFormat,
            extraImages: opts?.extraImages,
            disableAutoUseLastImage: Boolean(opts?.forceNoAutoReuse),
            signal: controller.signal,
          }
        );
        setBalanceRefreshTick((v) => v + 1);

        stage = "解析结果...";
        setGenerationStage(stage);

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

        const pushImagePart = (url: string, resultMeta: GenerateResponseResult) => {
          aiMessage.parts.push({
            type: "image",
            imageUrl: url,
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
          pushImagePart(firstUrl, firstResult);
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
          setSessions((prev) =>
            prev.map((s) => (s.id === sessionId ? { ...s, messages: updatedMessages, updatedAt: Date.now() } : s))
          );
        };
        setSessions(prev => prev.map(s =>
          s.id === sessionId ? { ...s, messages: updatedMessages, updatedAt: Date.now() } : s
        ));

        const remaining = batchCount - 1;
        if (remaining > 0 && firstUrl) {
          let done = 0;
          let failed = 0;
          let cursor = 0;
          const maxParallel = Math.min(3, remaining);

          const worker = async () => {
            while (cursor < remaining) {
              const idx = cursor++;
              if (idx >= remaining) return;
              if (controller.signal.aborted) return;

              try {
                const extra = await generateResponse(
                  prompt,
                  image,
                  modelImage,
                  productImageUrl,
                  generationBaseMessages,
                  currentSession.settings,
                  {
                    n: 1,
                    size,
                    responseFormat,
                    extraImages: opts?.extraImages,
                    disableAutoUseLastImage: Boolean(opts?.forceNoAutoReuse),
                    signal: controller.signal,
                  }
                );
                const extraUrl = extra.images[0];
                if (!extraUrl) {
                  failed += 1;
                } else {
                  setBalanceRefreshTick((v) => v + 1);
                  patchLatestAiMessage({
                    type: "image",
                    imageUrl: extraUrl,
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
                stage = `首图已出，正在补齐（${done}/${remaining}）· 尺寸 ${size}...`;
                setGenerationStage(stage);
              }
            }
          };

          await Promise.all(Array.from({ length: maxParallel }, () => worker()));

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
        setSessions(prev => prev.map(s =>
          s.id === sessionId ? { ...s, messages: updatedMessages, updatedAt: Date.now() } : s
        ));
        return updatedMessages;
      }

      const msg = e instanceof Error ? e.message : String(e);
      // P1-4: 401 未授权自动跳转登录页
      const httpStatus = extractHttpStatus(msg);
      if (httpStatus === 401 || isLikelyMissingAuth(msg)) {
        setAuthUser(null);
      }
      const friendly = getFriendlyErrorMessage(msg);
      setErrorDetails({
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
      });

      const errorMessage: Message = {
        id: uuidv4(),
        role: 'model',
        parts: [{ type: 'text', text: friendly }],
        timestamp: Date.now()
      };
      updatedMessages = [...updatedMessages, errorMessage];
      setSessions(prev => prev.map(s =>
        s.id === sessionId ? { ...s, messages: updatedMessages, updatedAt: Date.now() } : s
      ));
      return updatedMessages;
    } finally {
      setIsGenerating(false);
      setGenerationStage(null);
      setGenerationProgress(null);
      // 只清理当前请求对应的 controller，避免竞态覆盖新请求
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [apiConfig, currentSession, models]);

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

    setSessions(prev => prev.map(s => 
      s.id === currentSession.id ? { ...s, messages: updatedMessages, title: updatedTitle, updatedAt: Date.now() } : s
    ));

    const promptToPass = inputText;
    const imageToPass = selectedImage;
    setInputText('');
    setSelectedImage(null);

    await executeGeneration(promptToPass, imageToPass, updatedMessages);
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
    setSessions(prev => prev.map(s => s.id === currentSession.id ? { ...s, messages: updatedMessages, updatedAt: Date.now() } : s));
    await executeGeneration(variationPrompt, imageUrl, updatedMessages, { action: `变体：${type}` });
  }, [currentSession, executeGeneration, isGenerating]);

  const openMaskEditFromChat = useCallback((baseImageUrl: string) => {
    setMaskEditContext({ source: "chat" });
    setMaskEditBaseUrl(baseImageUrl);
  }, []);

  const openMaskEditFromBatch = useCallback((params: {
    jobId: string;
    slotId: string;
    versionId?: string;
    baseImageUrl: string;
    historyItems: MaskEditorHistoryItem[];
  }) => {
    setMaskEditContext({
      source: "batch",
      jobId: params.jobId,
      slotId: params.slotId,
      versionId: params.versionId,
      historyItems: params.historyItems,
    });
    setMaskEditBaseUrl(params.baseImageUrl);
  }, []);

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

  const handleBatchSetSubmit = useCallback(async (items: BatchSetItem[]) => {
    if (!currentSession || isBatchGenerating || items.length === 0) return;
    setIsBatchSetOpen(false);
    setCurrentView("batch");

    const createdAt = nowTs();
    const basePrompt = inputText.trim();
    const fixedReferenceImage = selectedImage;
    const size = aspectRatioToSize(currentSession.settings.aspectRatio);
    const jobId = uuidv4();
    const slots: BatchSlot[] = items.map((item, i) => ({
      id: uuidv4(),
      jobId,
      type: item.scene,
      title: `套图 ${i + 1}/${items.length} · ${item.sceneLabel}`,
      targetCount: 1,
      promptTemplate: item.note.trim(),
      size,
      status: "pending",
      versions: [],
    }));

    const initialJob: BatchJob = {
      id: jobId,
      title: basePrompt ? `套图任务：${basePrompt.slice(0, 20)}` : `套图任务 ${new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
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

    setBatchJobs((prev) => [initialJob, ...prev]);
    setSelectedBatchJobId(jobId);

    batchAbortRef.current?.abort();
    batchAbortRef.current = new AbortController();
    const controller = batchAbortRef.current;

    setIsBatchGenerating(true);
    setBatchGenerationProgress(null);

    for (let i = 0; i < slots.length; i++) {
      if (controller.signal.aborted) break;
      const slot = slots[i];
      const item = items[i];
      const slotPrompt = buildBatchSlotPrompt({
        basePrompt,
        total: slots.length,
        index: i,
        scene: item.scene,
        sceneLabel: item.sceneLabel,
        note: item.note,
      });

      setBatchGenerationProgress({
        currentSlot: i + 1,
        totalSlots: slots.length,
        currentSlotLabel: item.sceneLabel
      });

      updateBatchJobById(jobId, (job) => {
        const nextSlots = job.slots.map((s) => (s.id === slot.id ? { ...s, status: "running", error: undefined } : s));
        const next = { ...job, status: "running", updatedAt: nowTs(), slots: nextSlots };
        return appendBatchActionLog(next, "slot_run_start", { slotId: slot.id, index: i });
      });

      try {
        const generated = await runBatchSlotGeneration({
          jobId,
          slotId: slot.id,
          slotLabel: slot.title,
          slotPrompt,
          referenceImage: fixedReferenceImage,
          productImage: job.productImageUrl || null,
          modelImage: job.modelImageUrl || null,
        });

        if (!generated.length) {
          throw new Error("未返回图片");
        }

        setBalanceRefreshTick((v) => v + 1);
        updateBatchJobById(jobId, (job) => {
          const nextSlots = job.slots.map((s) => {
            if (s.id !== slot.id) return s;
            const prevLast = s.versions[s.versions.length - 1];
            const appended = generated.map((v, idx) => ({
              ...v,
              index: s.versions.length + idx + 1,
              source: s.versions.length === 0 ? "generate" : "rerun",
              parentVersionId: prevLast?.id,
            }));
            const merged = [
              ...s.versions.map((v) => ({ ...v, isPrimary: false })),
              ...appended.map((v, idx) => ({ ...v, isPrimary: idx === 0 })),
            ];
            return {
              ...s,
              status: "completed" as const,
              versions: merged,
              activeVersionId: appended[0]?.id || s.activeVersionId,
            };
          });
          const next = {
            ...job,
            slots: nextSlots,
            status: mapSlotStatusToJobStatus(nextSlots),
            updatedAt: nowTs(),
          };
          return appendBatchActionLog(next, "slot_run_success", { slotId: slot.id, generatedCount: generated.length });
        });
      } catch (e) {
        const errorText = e instanceof Error ? e.message : String(e);
        updateBatchJobById(jobId, (job) => {
          const nextSlots = job.slots.map((s) => (s.id === slot.id ? { ...s, status: "failed", error: errorText } : s));
          const next = {
            ...job,
            slots: nextSlots,
            status: mapSlotStatusToJobStatus(nextSlots),
            updatedAt: nowTs(),
          };
          return appendBatchActionLog(next, "slot_run_failed", { slotId: slot.id, error: errorText });
        });
      }
    }

    updateBatchJobById(jobId, (job) => {
      const finalStatus = mapSlotStatusToJobStatus(job.slots);
      const next = {
        ...job,
        status: finalStatus,
        updatedAt: nowTs(),
      };
      return appendBatchActionLog(next, "job_finished", { status: finalStatus });
    });

    setIsBatchGenerating(false);
    setBatchGenerationProgress(null);
    if (batchAbortRef.current === controller) {
      batchAbortRef.current = null;
    }
  }, [appendBatchActionLog, authUser, buildBatchSlotPrompt, currentSession, inputText, isGenerating, runBatchSlotGeneration, selectedImage, updateBatchJobById]);

  const handleUpdateBatchJobImages = useCallback((
    jobId: string,
    updates: { productImageUrl?: string | null; modelImageUrl?: string | null }
  ) => {
    updateBatchJobById(jobId, (job) => ({
      ...job,
      ...updates,
      updatedAt: nowTs(),
    }));
  }, [updateBatchJobById]);

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
    setBatchJobs((prev) => {
      const source = prev.find((j) => j.id === jobId);
      if (!source) return prev;
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
      setSelectedBatchJobId(newJobId);
      setCurrentView("batch");
      return [copy, ...prev];
    });
  }, [authUser]);

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
      basename: `topseller-batch-${v.id}`,
      format: options.format,
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

    setIsBatchGenerating(true);
    setBatchGenerationProgress({
      currentSlot: 1,
      totalSlots: 1,
      currentSlotLabel: slot.title
    });
    setCurrentView("batch");
    setSelectedBatchJobId(jobId);

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
        referenceImage: job.referenceImageUrl || null,
        productImage: job.productImageUrl || null,
        modelImage: job.modelImageUrl || null,
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
      setIsBatchGenerating(false);
      setBatchGenerationProgress(null);
      if (batchAbortRef.current === controller) {
        batchAbortRef.current = null;
      }
    }
  }, [appendBatchActionLog, batchJobs, buildBatchSlotPrompt, currentSession, inputText, isBatchGenerating, runBatchSlotGeneration, updateBatchJobById]);

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
        throw new Error("套图槽位不存在或已被删除。");
      }

      batchAbortRef.current?.abort();
      batchAbortRef.current = new AbortController();
      const controller = batchAbortRef.current;

      setIsBatchGenerating(true);
      setBatchGenerationProgress({
        currentSlot: 1,
        totalSlots: 1,
        currentSlotLabel: `${slot.title} 局部编辑`
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
            { api: apiConfig, signal: controller.signal }
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
            }
          );
          generatedImageUrls = result.images;
          modelUsed = result.modelUsed || modelUsed;
        }

        if (!generatedImageUrls.length) {
          throw new Error("局部编辑未生成新图。");
        }

        appendToBatch(generatedImageUrls, modelUsed, size);
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
        setIsBatchGenerating(false);
        setBatchGenerationProgress(null);
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
    setSessions((prev) =>
      prev.map((s) => (s.id === currentSession.id ? { ...s, messages: updatedMessages, updatedAt: Date.now() } : s))
    );

    // If the selected model supports /v1/images/edits (mostly GPT-image), prefer mask-native edit.
    const model = apiConfig.defaultImageModel || "";
    const supportsEdits = /^gpt-image/i.test(model) || /^dall-e/i.test(model);
    if (supportsEdits) {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const controller = abortRef.current;
      let handoffToFallback = false;
      try {
        setIsGenerating(true);
        setErrorDetails(null);
        setGenerationProgress(null);
        setGenerationStage("正在进行遮罩编辑...");

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
          { api: apiConfig, signal: controller.signal }
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
        setSessions((prev) =>
          prev.map((s) => (s.id === currentSession.id ? { ...s, messages: nextMessages, updatedAt: Date.now() } : s))
        );
        setBalanceRefreshTick((v) => v + 1);
        const generatedImageUrls = aiMessage.parts
          .filter((p) => p.type === "image" && p.imageUrl)
          .map((p) => p.imageUrl as string);
        if (generatedImageUrls.length === 0) {
          throw new Error("局部编辑未返回新图片，请重试。");
        }
        return { generatedImageUrls };
      } catch (e) {
        // Fall back to the non-native approach below.
        console.warn("images/edits 失败，自动退化为参考图编辑：", e);
        handoffToFallback = true;
      } finally {
        if (!handoffToFallback) {
          setIsGenerating(false);
          setGenerationStage(null);
        } else {
          setGenerationStage("原生编辑失败，已切换为参考图模式");
        }
        setGenerationProgress(null);
        // 只清理当前请求对应的 controller，避免竞态覆盖新请求
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

  if (!authReady) {
    return (
      <div className="min-h-screen bg-dark-900 text-gray-200 flex items-center justify-center">
        <div className="text-sm text-gray-400">正在检查登录状态...</div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="min-h-screen bg-dark-900 text-gray-200 flex items-center justify-center p-4">
        <form onSubmit={handleLoginSubmit} className="w-full max-w-sm bg-dark-800 border border-dark-700 rounded-2xl p-6 space-y-4 shadow-2xl">
          <div className="text-xl font-bold text-banana-400">TopSeller 图销冠</div>
          <div className="text-sm text-gray-400">请登录后继续使用。</div>
          <div className="space-y-2">
            <label className="text-xs text-gray-400">账号</label>
            <input
              type="text"
              value={loginForm.username}
              onChange={(e) => setLoginForm((prev) => ({ ...prev, username: e.target.value }))}
              className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-banana-500"
              placeholder="请输入账号"
              autoComplete="username"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-gray-400">密码</label>
            <input
              type="password"
              value={loginForm.password}
              onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))}
              className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-banana-500"
              placeholder="请输入密码"
              autoComplete="current-password"
            />
          </div>
          {authError && <div className="text-xs text-red-400">{authError}</div>}
          <button
            type="submit"
            disabled={authLoading}
            className="w-full bg-banana-500 hover:bg-banana-400 disabled:opacity-60 text-dark-900 font-semibold py-2.5 rounded-lg transition-colors"
          >
            {authLoading ? "登录中..." : "登录"}
          </button>
        </form>
      </div>
    );
  }

  if (!currentSession) return <div className="text-white text-center mt-10">初始化中...</div>;

  return (
    <div className="flex h-screen bg-dark-900 overflow-hidden font-sans">
      <Sidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={(id) => {
          setCurrentSessionId(id);
          setCurrentView("chat");
        }}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        isOpen={isSidebarOpen}
        toggleSidebar={toggleSidebar}
        apiConfig={apiConfig}
        onUpdateApiConfig={handleUpdateApiConfig}
        onOpenAssets={openAssets}
        onOpenModelsLibrary={() => setIsModelsLibraryOpen(true)}
        assetCount={totalAssetCount}
        modelCount={models.length}
        batchJobCount={activeBatchJobCount}
        authUser={authUser}
        authLoading={authLoading}
        onLogout={handleLogout}
        currentSettings={currentSession.settings}
        onUpdateCurrentSettings={handleUpdateSettings}
        balanceRefreshTick={balanceRefreshTick}
        currentView={currentView}
        onViewChange={setCurrentView}
      />
      <div className="flex-1 flex flex-col h-full min-h-0 relative">
        <div className="lg:hidden h-14 border-b border-dark-700 flex items-center px-4 justify-between bg-dark-800">
          <button onClick={() => setIsSidebarOpen(true)} className="text-gray-400"><Icon name="bars" /></button>
          <span className="font-semibold text-gray-200 truncate max-w-[200px]">
            {currentView === "batch" ? (selectedBatchJob?.title || "套图工作台") : currentSession.title}
          </span>
          <button
            onClick={handleLogout}
            disabled={authLoading}
            className="text-[11px] px-2 py-1 rounded border border-dark-600 bg-dark-800 text-gray-300 disabled:opacity-60"
          >
            退出
          </button>
        </div>
        <SystemPromptBar
          key={currentSession.id}
          settings={currentSession.settings}
          onUpdateSettings={handleUpdateSettings}
          templates={templates}
          onSaveTemplate={handleSaveTemplate}
        />
        {currentView === "chat" ? (
          <>
            <div className="flex-1 overflow-y-auto p-4 lg:p-8 scroll-smooth">
              <div className="w-full max-w-none min-h-full flex flex-col pr-1 lg:pr-4">
                {currentSession.messages.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-gray-500 opacity-50 mt-10">
                    <Icon name="image" className="text-6xl mb-4" />
                    <p className="text-lg text-center">写下指令，选择画幅比例，然后开始创作。</p>
                  </div>
                ) : (
                  currentSession.messages.map(msg => (
                    <ChatMessage
                      key={msg.id}
                      message={msg}
                      onPreviewImage={setPreviewImageUrl}
                      onVariation={handleVariation}
                      onMaskEdit={openMaskEditFromChat}
                      onUseAsReference={setSelectedImage}
                    />
                  ))
                )}
                {isGenerating && (
                  <div className="flex items-center gap-3 text-banana-400 mb-6 max-w-[70%]">
                     <div className="w-8 h-8 rounded-full bg-banana-500 text-dark-900 flex items-center justify-center animate-pulse"><Icon name="robot" /></div>
                     <div className="bg-dark-800 px-4 py-3 rounded-2xl rounded-tl-none border border-dark-700">
                       <span className="text-sm flex gap-2 items-center">
                        {generationStage || (currentSession.settings.selectedModelId ? "正在同步已锁定的人物..." : "正在整理视觉上下文...")}
                       </span>
                       <div className="mt-2 text-[11px] text-gray-400 flex items-center justify-between gap-3">
                         <span>
                           {generationProgress
                             ? `进度：${generationProgress.current}/${generationProgress.total}`
                             : "进度：准备中..."}
                         </span>
                         <button
                           onClick={cancelGeneration}
                           className="px-2 py-1 bg-dark-900 hover:bg-dark-700 text-gray-200 border border-dark-600 rounded-md"
                           title="取消当前生成"
                         >
                           取消
                         </button>
                       </div>
                     </div>
                  </div>
                )}
                <div ref={chatEndRef} className="h-4" />
              </div>
            </div>
            <div className="bg-dark-800 border-t border-dark-700 p-4 lg:p-6">
              <div className="w-full max-w-none flex flex-col gap-3 pr-1 lg:pr-4">
                {errorDetails && (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2">
                    <span className="text-xs text-red-300 truncate max-w-full">
                      {getFriendlyErrorMessage(errorDetails.message)}
                    </span>
                    <button
                      onClick={retryLastGeneration}
                      disabled={!lastRunRef.current || isGenerating}
                      className="px-2.5 py-1 text-[11px] bg-dark-700 hover:bg-dark-600 text-gray-200 border border-dark-600 rounded-md disabled:opacity-40"
                    >
                      重试
                    </button>
                    <button
                      onClick={() => setIsErrorModalOpen(true)}
                      className="px-2.5 py-1 text-[11px] bg-dark-700 hover:bg-dark-600 text-gray-200 border border-dark-600 rounded-md"
                    >
                      查看详情
                    </button>
                    <button
                      onClick={() => {
                        setErrorDetails(null);
                        setIsErrorModalOpen(false);
                      }}
                      className="px-2.5 py-1 text-[11px] bg-dark-700 hover:bg-dark-600 text-gray-300 border border-dark-600 rounded-md"
                    >
                      忽略
                    </button>
                  </div>
                )}
                <div className="rounded-lg border border-dark-600 bg-dark-800/60 px-3 py-2">
                  <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => setIsAdvancedPanelOpen((v) => !v)}
                        className="h-8 px-2.5 rounded-md border border-dark-600 bg-dark-800 hover:bg-dark-700 text-[11px] text-gray-200 transition-colors flex items-center gap-1.5"
                      >
                        <Icon name={isAdvancedPanelOpen ? "chevron-up" : "chevron-down"} />
                        {isAdvancedPanelOpen ? "收起高级设置" : "展开高级设置"}
                      </button>
                      {currentSession.settings.productImage && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full border border-banana-500/30 bg-banana-500/10 text-banana-300">
                          已设产品图
                        </span>
                      )}
                      {currentSession.settings.selectedModelId && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full border border-banana-500/30 bg-banana-500/10 text-banana-300">
                          已锁模特
                        </span>
                      )}
                      {selectedImage && (
                        <div className="flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                          <span>已设参考图</span>
                          <button
                            onClick={() => setIsAdvancedPanelOpen(true)}
                            className="underline underline-offset-2 hover:text-emerald-200"
                          >
                            查看
                          </button>
                          <button
                            onClick={() => setSelectedImage(null)}
                            className="text-emerald-200 hover:text-white"
                            title="清除参考图"
                          >
                            <Icon name="times" />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-300 font-medium">连续编辑</span>
                      <label className="inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={currentSession.settings.autoUseLastImage}
                          onChange={(e) => {
                            const next = { ...currentSession.settings, autoUseLastImage: e.target.checked };
                            if (e.target.checked && next.selectedModelId !== null) {
                              next.selectedModelId = null;
                            }
                            handleUpdateSettings(next);
                          }}
                          className="h-4 w-4 accent-banana-500"
                        />
                      </label>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                        currentSession.settings.autoUseLastImage
                          ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/10"
                          : "text-gray-400 border-dark-500 bg-dark-700"
                      }`}>
                        {currentSession.settings.autoUseLastImage ? "已开启" : "已关闭"}
                      </span>
                    </div>
                  </div>
                  {!isAdvancedPanelOpen && (
                    <p className="mt-1 text-[10px] text-gray-500 leading-relaxed">
                      输入指令即可生成。产品/模特、快捷词在「高级设置」中按需展开，减少占用空间。
                    </p>
                  )}
                </div>

                {isAdvancedPanelOpen && (
                  <div className="space-y-2 rounded-lg border border-dark-700 bg-dark-900/30 p-2">
                    <PromptModelPanel
                      settings={currentSession.settings}
                      onUpdateSettings={handleUpdateSettings}
                      models={models}
                      onAddModel={handleAddModel}
                      onDeleteModel={handleDeleteModel}
                      onOpenBatchSet={openBatchSetModal}
                    />
                    {selectedImage && (
                      <div className="relative inline-block self-start">
                        <img src={selectedImage} alt="预览" className="h-20 rounded-lg border border-dark-600 object-cover shadow-lg" loading="lazy" decoding="async" />
                        <button
                          onClick={() => {
                            if (window.confirm('确定要删除参考图吗？')) {
                              setSelectedImage(null);
                            }
                          }}
                          className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow-md hover:bg-red-600 transition-colors"
                        >
                          <Icon name="times" />
                        </button>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      {QUICK_PROMPT_PRESETS.map((p) => (
                        <button
                          key={p}
                          onClick={() => setInputText((prev) => (prev ? `${prev}\n${p}` : p))}
                          className="px-2.5 py-1 text-[11px] bg-dark-700 hover:bg-dark-600 text-gray-200 border border-dark-600 rounded-md"
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-end gap-3 bg-dark-900 border border-dark-600 rounded-xl p-2 focus-within:border-dark-500 transition-colors">
                  <button onClick={() => fileInputRef.current?.click()} className="p-3 text-gray-400 hover:text-banana-400 transition-colors rounded-lg hover:bg-dark-800"><Icon name="image" className="text-lg" /></button>
                  <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="image/*" className="hidden" />
                  <textarea value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={handleKeyDown} onPaste={handlePaste} placeholder="例如：给人物加一顶红色帽子..." className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 text-gray-200 placeholder-gray-600 max-h-32 py-3 resize-none custom-scrollbar" rows={1} style={{ minHeight: '44px' }} />
                  <button onClick={handleEnhancePrompt} disabled={!inputText.trim() || isEnhancing || isGenerating} className={`p-3 text-banana-500 hover:text-banana-400 rounded-lg hover:bg-dark-800 ${isEnhancing ? 'animate-pulse' : ''}`}><Icon name="magic" /></button>
                  <button onClick={handleSendMessage} disabled={(!inputText.trim() && !selectedImage) || isGenerating} className={`p-3 rounded-lg font-semibold transition-all ${(!inputText.trim() && !selectedImage) || isGenerating ? 'bg-dark-700 text-gray-500' : 'bg-banana-500 hover:bg-banana-400 text-dark-900 shadow-lg'}`}><Icon name="paper-plane" /></button>
                </div>
                <div className="text-[11px] text-gray-500">
                  回车发送，Shift+回车换行。支持粘贴图片，或在素材库中一键设为参考图。
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 min-h-0 overflow-hidden">
            <BatchJobsPanel
              jobs={batchJobs}
              selectedJobId={selectedBatchJobId}
              isBusy={isBatchGenerating}
              onSelectJob={(jobId) => setSelectedBatchJobId(jobId)}
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
              onUpdateJobImages={handleUpdateBatchJobImages}
            />
          </div>
        )}
        {previewImageUrl && <ImagePreviewModal imageUrl={previewImageUrl} onClose={() => setPreviewImageUrl(null)} />}
        <AssetsModal
          isOpen={isAssetsOpen}
          assets={allAssets}
          onClose={() => setIsAssetsOpen(false)}
          onOpenMaskEdit={openMaskEditFromChat}
          onUseAsReference={(imageUrl) => {
            setSelectedImage(imageUrl);
            setIsAssetsOpen(false);
          }}
          onUsePrompt={(prompt) => {
            setInputText(prompt);
            setIsAssetsOpen(false);
          }}
        />
        <BatchSetModal
          isOpen={isBatchSetOpen}
          onClose={() => setIsBatchSetOpen(false)}
          onSubmit={(items) => {
            void handleBatchSetSubmit(items);
          }}
        />
        {isModelsLibraryOpen && (
          <ModelsLibraryModal
            models={models}
            onAddModel={handleAddModel}
            onDeleteModel={handleDeleteModel}
            onRenameModel={handleRenameModel}
            onClose={() => setIsModelsLibraryOpen(false)}
          />
        )}
        {errorDetails && isErrorModalOpen && (
          <ErrorDetailsModal
            error={errorDetails}
            onClose={() => setIsErrorModalOpen(false)}
          />
        )}
        {maskEditBaseUrl && (
          <MaskEditorModal
            baseImageUrl={maskEditBaseUrl}
            historyItems={maskHistoryItems}
            onSelectBaseImage={setMaskEditBaseUrl}
            onClose={() => {
              setMaskEditBaseUrl(null);
              setMaskEditContext(null);
            }}
            onSubmit={handleMaskSubmit}
          />
        )}
      </div>
    </div>
  );
};

export default App;
