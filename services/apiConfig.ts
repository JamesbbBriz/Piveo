export interface ApiConfig {
  baseUrl: string;
  authorization: string;
  defaultImageModel: string;
}

const STORAGE_KEY = "nanobanana_api_config_v1";

const readEnvString = (key: string): string => {
  const v = (import.meta as any).env?.[key];
  return typeof v === "string" ? v : "";
};

export const getEnvApiConfig = (): ApiConfig => {
  const baseUrl = (readEnvString("VITE_API_BASE_URL") || "/api").trim();
  // 安全策略：前端不再直接持有上游令牌。
  // 上游 Authorization 统一由后端网关注入。
  const authorization = "";

  const defaultImageModel = (readEnvString("VITE_DEFAULT_IMAGE_MODEL") || "gemini-2.5-flash-image-preview").trim();

  return {
    baseUrl,
    authorization,
    defaultImageModel,
  };
};

export const loadStoredApiConfig = (): Partial<ApiConfig> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const obj = parsed as Partial<ApiConfig>;
    return {
      // 安全策略：地址与鉴权只从 .env 读取，不走浏览器本地覆盖。
      defaultImageModel: typeof obj.defaultImageModel === "string" ? obj.defaultImageModel : undefined,
    };
  } catch {
    return {};
  }
};

export const saveStoredApiConfig = (cfg: ApiConfig) => {
  if (typeof window === "undefined") return;
  // 安全策略：仅持久化前端可调参数（模型）；鉴权和地址不持久化。
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      defaultImageModel: cfg.defaultImageModel,
    })
  );
};

export const getEffectiveApiConfig = (): ApiConfig => {
  const env = getEnvApiConfig();
  const stored = loadStoredApiConfig();
  return {
    baseUrl: env.baseUrl.trim(),
    authorization: env.authorization.trim(),
    defaultImageModel: (stored.defaultImageModel || env.defaultImageModel).trim(),
  };
};
