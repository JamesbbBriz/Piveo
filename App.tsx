
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Sidebar } from './components/Sidebar';
import { ChatMessage } from './components/ChatMessage';
import { ImagePreviewModal } from './components/ImagePreviewModal';
import { Icon } from './components/Icon';
import { AspectRatio, ImageResponseFormat, ProductScale, Message, Session, SessionSettings, SystemTemplate, ModelCharacter } from './types';
import { initPersistentStorage, loadSessions, loadTemplates, loadModels, saveSessions, saveTemplates, saveModels } from './services/storage';
import { generateResponse, enhancePrompt } from './services/gemini';
import { DEFAULT_ASPECT_RATIO } from './constants';
import { ApiConfig, getEffectiveApiConfig, saveStoredApiConfig } from './services/apiConfig';
import { AssetsModal, type AssetItem } from './components/AssetsModal';
import { ImageCompareModal } from './components/ImageCompareModal';
import { ErrorDetailsModal, type ErrorDetails } from './components/ErrorDetailsModal';
import { MaskEditorModal } from './components/MaskEditorModal';
import { imagesEdits, imageObjToDataUrl, ResponseFormat } from './services/openaiImages';
import { filterSizesByAspect, getSupportedAspectRatios, getSupportedSizeForAspect } from './services/sizeUtils';
import { PromptModelPanel } from './components/PromptModelPanel';
import { getSession, login, logout } from './services/auth';

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
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
};

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
    }
  };
};

const App: React.FC = () => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
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
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [comparePair, setComparePair] = useState<{ beforeUrl: string; afterUrl: string } | null>(null);
  const [errorDetails, setErrorDetails] = useState<ErrorDetails | null>(null);
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false);
  const [isAssetsOpen, setIsAssetsOpen] = useState(false);
  const [maskEditBaseUrl, setMaskEditBaseUrl] = useState<string | null>(null);
  const [balanceRefreshTick, setBalanceRefreshTick] = useState(0);
  const [hasHydratedStorage, setHasHydratedStorage] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastRunRef = useRef<{
    prompt: string;
    image: string | null;
    customMessages?: Message[];
    opts?: { action?: string; extraImages?: string[]; sizes?: string[] };
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
      const [loadedTemplates, loadedModels, loadedSessions] = await Promise.all([
        loadTemplates(),
        loadModels(),
        loadSessions(),
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
      setHasHydratedStorage(true);
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [authReady, authUser]);

  useEffect(() => {
    if (!hasHydratedStorage) return;
    void saveSessions(sessions);
  }, [sessions, hasHydratedStorage]);
  useEffect(() => {
    if (!hasHydratedStorage) return;
    void saveTemplates(templates);
  }, [templates, hasHydratedStorage]);
  useEffect(() => {
    if (!hasHydratedStorage) return;
    void saveModels(models);
  }, [models, hasHydratedStorage]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessions, currentSessionId, isGenerating]);

  const currentSession = sessions.find(s => s.id === currentSessionId) || sessions[0];

  const allAssets: AssetItem[] = useMemo(() => {
    const out: AssetItem[] = [];
    for (const s of sessions) {
      let lastUserText: string | null = null;
      for (let mi = 0; mi < s.messages.length; mi++) {
        const m = s.messages[mi];
        if (m.role === "user") {
          const t = m.parts
            .filter((p) => p.type === "text" && p.text)
            .map((p) => p.text)
            .join(" ")
            .trim();
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
    return out;
  }, [sessions]);

  const currentAssetCount = useMemo(() => {
    if (!currentSession) return 0;
    return allAssets.filter((a) => a.sessionId === currentSession.id).length;
  }, [allAssets, currentSession]);

  const handleNewSession = () => {
    const newSession = createNewSession(templates);
    setSessions([newSession, ...sessions]);
    setCurrentSessionId(newSession.id);
    setInputText('');
    setSelectedImage(null);
  };

  const handleDeleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSessions = sessions.filter(s => s.id !== id);
    setSessions(newSessions);
    if (currentSessionId === id) setCurrentSessionId(newSessions.length > 0 ? newSessions[0].id : null);
    if (newSessions.length === 0) {
        const fresh = createNewSession(templates);
        setSessions([fresh]);
        setCurrentSessionId(fresh.id);
    }
  };

  const handleUpdateSettings = (newSettings: SessionSettings) => {
    if (!currentSessionId) return;
    setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, settings: newSettings } : s));
  };

  const handleSaveTemplate = (newTemplate: SystemTemplate) => setTemplates(prev => [...prev, newTemplate]);
  const handleAddModel = (newModel: ModelCharacter) => setModels(prev => [...prev, newModel]);
  const handleUpdateApiConfig = (cfg: ApiConfig) => {
    setApiConfig(cfg);
    saveStoredApiConfig(cfg);
  };

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
      setHasHydratedStorage(false);
      setSessions([]);
      setCurrentSessionId(null);
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
    } finally {
      setIsEnhancing(false);
    }
  };

  const cancelGeneration = () => {
    abortRef.current?.abort();
  };

  const executeGeneration = async (
    prompt: string,
    image: string | null,
    customMessages?: Message[],
    opts?: { action?: string; extraImages?: string[]; sizes?: string[] }
  ) => {
    if (!currentSession) return;
    lastRunRef.current = { prompt, image, customMessages, opts };

    const sessionId = currentSession.id;
    const batchCount = currentSession.settings.batchCount || 1;
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

    const messagesToUse = customMessages || currentSession.messages;
    let updatedMessages = messagesToUse;

    const parentImageUrl = image || findLastImageUrl(messagesToUse);

    try {
      for (let i = 0; i < sizes.length; i++) {
        const size = sizes[i];
        setGenerationProgress({ current: i + 1, total: sizes.length });
        stage = `正在生成（${i + 1}/${sizes.length}）· 尺寸 ${size} · 数量 ${batchCount}...`;
        setGenerationStage(stage);

        const result = await generateResponse(
          prompt,
          image,
          modelImage,
          updatedMessages,
          currentSession.settings,
          {
            n: batchCount,
            size,
            responseFormat,
            extraImages: opts?.extraImages,
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
          aiMessage.parts.push({ type: "text", text: `尺寸：${result.sizeUsed}` });
        }
        if (opts?.action) {
          aiMessage.parts.push({ type: "text", text: `操作：${opts.action}` });
        }

        for (const url of result.images) {
          aiMessage.parts.push({
            type: "image",
            imageUrl: url,
            meta: {
              id: uuidv4(),
              createdAt: Date.now(),
              prompt: result.promptUsed,
              model: result.modelUsed || apiConfig.defaultImageModel,
              size: result.sizeUsed,
              responseFormat: result.responseFormat,
              parentImageUrl: parentImageUrl || undefined,
              action: opts?.action,
            },
          });
        }

        if (aiMessage.parts.length === 0) {
          aiMessage.parts.push({ type: 'text', text: '生成完成，但没有返回任何内容。' });
        }

        updatedMessages = [...updatedMessages, aiMessage];
        setSessions(prev => prev.map(s =>
          s.id === sessionId ? { ...s, messages: updatedMessages, updatedAt: Date.now() } : s
        ));
      }
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
        return;
      }

      const msg = e instanceof Error ? e.message : String(e);
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
    } finally {
      setIsGenerating(false);
      setGenerationStage(null);
      setGenerationProgress(null);
      abortRef.current = null;
    }
  };

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

  const handleVariation = async (type: string, imageUrl: string) => {
    if (isGenerating || !currentSession) return;
    const variationPrompt = `基于之前的上下文，生成一个「${type}」变体，并严格保持一致性。`;
    
    const newUserMessage: Message = {
      id: uuidv4(),
      role: 'user',
      parts: [{ type: 'text', text: `(变体操作：${type})` }],
      timestamp: Date.now()
    };

    const updatedMessages = [...currentSession.messages, newUserMessage];
    setSessions(prev => prev.map(s => s.id === currentSession.id ? { ...s, messages: updatedMessages, updatedAt: Date.now() } : s));
    await executeGeneration(variationPrompt, imageUrl, updatedMessages, { action: `变体：${type}` });
  };

  const openCompare = (beforeUrl: string, afterUrl: string) => {
    setComparePair({ beforeUrl, afterUrl });
  };

  const openMaskEdit = (baseImageUrl: string) => {
    setMaskEditBaseUrl(baseImageUrl);
  };

  const handleMaskSubmit = async (params: { prompt: string; maskDataUrl: string; maskOverlayDataUrl: string }) => {
    if (!currentSession) return;
    const base = maskEditBaseUrl;
    setMaskEditBaseUrl(null);
    if (!base) return;

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
    setSessions((prev) =>
      prev.map((s) => (s.id === currentSession.id ? { ...s, messages: updatedMessages, updatedAt: Date.now() } : s))
    );

    // If the selected model supports /v1/images/edits (mostly GPT-image), prefer mask-native edit.
    const model = apiConfig.defaultImageModel || "";
    const supportsEdits = /^gpt-image/i.test(model) || /^dall-e/i.test(model);
    if (supportsEdits) {
      try {
        abortRef.current?.abort();
        abortRef.current = new AbortController();
        const controller = abortRef.current;

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
        return;
      } catch (e) {
        // Fall back to the non-native approach below.
        console.warn("images/edits 失败，自动退化为参考图编辑：", e);
      } finally {
        setIsGenerating(false);
        setGenerationStage(null);
        setGenerationProgress(null);
        abortRef.current = null;
      }
    }

    const augmentedPrompt =
      `${params.prompt}\n\n` +
      `说明：第二张参考图是遮罩提示图，红色区域是需要修改的区域；其它区域尽量保持不变，并严格保持人物/风格一致性。`;

    await executeGeneration(augmentedPrompt, base, updatedMessages, {
      action: "局部编辑",
      extraImages: [params.maskOverlayDataUrl],
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const retryLastGeneration = async () => {
    if (isGenerating || !lastRunRef.current) return;
    const last = lastRunRef.current;
    await executeGeneration(last.prompt, last.image, last.customMessages, last.opts);
  };

  const quickPromptPresets = [
    "电商白底，产品边缘清晰、无噪点。",
    "高级棚拍光效，肤色自然，细节锐利。",
    "保持人物一致，仅优化配件细节。",
    "把产品再缩小 20%，更纤细。",
    "把产品放大 20%，更突出主体。",
  ];

  const continuityStories = [
    "1. 连着微调同一张图：先生成 A，下一句只写“帽子改蓝色”，系统会自动用 A 继续改。",
    "2. 做全新图：关闭后输入新提示词，不会偷偷带上上一张图。",
    "3. 手动指定参考图：在素材库点“设为参考图”，本次优先按这张图改。",
    "4. 开着连续编辑但临时换图：你上传新图时，本次会用新图；下次不上传才回到自动沿用。",
  ];

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
        onSelectSession={setCurrentSessionId}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        isOpen={isSidebarOpen}
        toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        apiConfig={apiConfig}
        onUpdateApiConfig={handleUpdateApiConfig}
        onOpenAssets={() => setIsAssetsOpen(true)}
        assetCount={currentAssetCount}
        currentSettings={currentSession.settings}
        onUpdateCurrentSettings={handleUpdateSettings}
        balanceRefreshTick={balanceRefreshTick}
      />
      <div className="flex-1 flex flex-col h-full relative">
        <div className="absolute top-3 right-4 z-20 hidden lg:flex items-center gap-2">
          <span className="text-xs text-gray-400 px-2 py-1 rounded border border-dark-600 bg-dark-800/70">
            {authUser}
          </span>
          <button
            onClick={handleLogout}
            disabled={authLoading}
            className="text-xs px-2.5 py-1.5 rounded border border-dark-600 bg-dark-800 hover:bg-dark-700 text-gray-200 disabled:opacity-60"
          >
            退出登录
          </button>
        </div>
        <div className="lg:hidden h-14 border-b border-dark-700 flex items-center px-4 justify-between bg-dark-800">
          <button onClick={() => setIsSidebarOpen(true)} className="text-gray-400"><Icon name="bars" /></button>
          <span className="font-semibold text-gray-200 truncate max-w-[200px]">{currentSession.title}</span>
          <button
            onClick={handleLogout}
            disabled={authLoading}
            className="text-[11px] px-2 py-1 rounded border border-dark-600 bg-dark-800 text-gray-300 disabled:opacity-60"
          >
            退出
          </button>
        </div>
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
                  onCompare={openCompare}
                  onMaskEdit={openMaskEdit}
                  onUseAsReference={(url) => setSelectedImage(url)}
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
            <PromptModelPanel
              settings={currentSession.settings}
              onUpdateSettings={handleUpdateSettings}
              templates={templates}
              onSaveTemplate={handleSaveTemplate}
              models={models}
              onAddModel={handleAddModel}
            />
            {selectedImage && (
              <div className="relative inline-block self-start">
                <img src={selectedImage} alt="预览" className="h-24 rounded-lg border border-dark-600 object-cover shadow-lg" loading="lazy" decoding="async" />
                <button onClick={() => setSelectedImage(null)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow-md"><Icon name="times" /></button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {quickPromptPresets.map((p) => (
                <button
                  key={p}
                  onClick={() => setInputText((prev) => (prev ? `${prev}\n${p}` : p))}
                  className="px-2.5 py-1 text-[11px] bg-dark-700 hover:bg-dark-600 text-gray-200 border border-dark-600 rounded-md"
                >
                  {p}
                </button>
              ))}
              <div className="md:ml-auto">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-dark-600 bg-dark-800/60">
                  <span className="text-[11px] text-gray-300 font-medium">连续编辑</span>
                  <label className="inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={currentSession.settings.autoUseLastImage}
                      onChange={(e) =>
                        handleUpdateSettings({
                          ...currentSession.settings,
                          autoUseLastImage: e.target.checked,
                        })
                      }
                      className="h-4 w-4 accent-banana-500"
                    />
                  </label>
                  <span className="text-[11px] text-gray-500">
                    {currentSession.settings.autoUseLastImage ? "开" : "关"}
                  </span>
                  <div className="relative">
                    <button
                      type="button"
                      className="peer text-gray-400 hover:text-banana-400 transition-colors"
                      aria-label="连续编辑使用说明"
                      title="连续编辑使用说明"
                    >
                      <Icon name="info-circle" />
                    </button>
                    <div className="absolute bottom-full right-0 mb-2 w-[min(520px,92vw)] rounded-xl border border-dark-600 bg-dark-900/95 backdrop-blur px-3 py-3 shadow-2xl z-20 opacity-0 pointer-events-none transition-opacity peer-hover:opacity-100">
                      <div className="text-xs font-semibold text-gray-200 mb-2">连续编辑怎么用</div>
                      <div className="space-y-1.5">
                        {continuityStories.map((line) => (
                          <div key={line} className="text-[11px] leading-relaxed text-gray-300">
                            {line}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
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
        {previewImageUrl && <ImagePreviewModal imageUrl={previewImageUrl} onClose={() => setPreviewImageUrl(null)} />}
        <AssetsModal
          isOpen={isAssetsOpen}
          assets={allAssets}
          onClose={() => setIsAssetsOpen(false)}
          onOpenCompare={openCompare}
          onOpenMaskEdit={openMaskEdit}
          onUseAsReference={(imageUrl) => {
            setSelectedImage(imageUrl);
            setIsAssetsOpen(false);
          }}
          onUsePrompt={(prompt) => {
            setInputText(prompt);
            setIsAssetsOpen(false);
          }}
        />
        {comparePair && (
          <ImageCompareModal
            beforeUrl={comparePair.beforeUrl}
            afterUrl={comparePair.afterUrl}
            onClose={() => setComparePair(null)}
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
            onClose={() => setMaskEditBaseUrl(null)}
            onSubmit={handleMaskSubmit}
          />
        )}
      </div>
    </div>
  );
};

export default App;
