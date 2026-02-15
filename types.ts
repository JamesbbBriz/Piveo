
export enum AspectRatio {
  Square = "1:1",
  TwoByThree = "2:3",
  ThreeByTwo = "3:2",
  Portrait = "3:4",
  Landscape = "4:3",
  FourByFive = "4:5",
  FiveByFour = "5:4",
  Mobile = "9:16",
  Wide = "16:9",
  UltraWide = "21:9",
}

export enum ProductScale {
  Small = "Small",
  Standard = "Standard",
  Large = "Large"
}

export type ImageResponseFormat = "url" | "b64_json";

export interface SystemTemplate {
  id: string;
  name: string;
  content: string;
}

export interface ModelCharacter {
  id: string;
  name: string;
  imageUrl: string; // Base64
}

export interface ProductCatalogItem {
  id: string;
  name: string;
  imageUrl: string;
  category?: string;
  dimensions?: {
    width?: number;
    height?: number;
    depth?: number;
  };
  size?: string;
  description?: string;
  createdAt: number;
}

export interface ProductImage {
  id: string;
  imageUrl: string;
  createdAt: number;
}

export interface MessagePartMeta {
  // Unique-ish id for assets/exports; optional for backward compatibility.
  id?: string;
  createdAt?: number;
  prompt?: string;
  model?: string;
  size?: string;
  responseFormat?: ImageResponseFormat;
  parentImageUrl?: string;
  action?: string;
}

export interface MessagePart {
  text?: string;
  imageUrl?: string; // Data URL for display
  type: 'text' | 'image';
  meta?: MessagePartMeta;
}

export interface Message {
  id: string;
  role: 'user' | 'model';
  parts: MessagePart[];
  timestamp: number;
}

export interface Session {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
  settings: SessionSettings;
}

export interface SessionSettings {
  systemPrompt: string;
  aspectRatio: AspectRatio;
  selectedModelId: string | null;
  productScale: ProductScale;
  responseFormat: ImageResponseFormat;
  batchCount: number; // 1-10
  batchSizes: string[]; // empty => use aspectRatio mapping
  autoUseLastImage: boolean; // true => 自动沿用最近图片做连续编辑
  productImage: ProductImage | null;
}

export interface AppState {
  sessions: Session[];
  currentSessionId: string | null;
  templates: SystemTemplate[];
  models: ModelCharacter[];
}

export type BatchSceneType = "model" | "flatlay" | "detail" | "white" | "custom";

export type BatchJobStatus = "draft" | "running" | "completed" | "failed" | "archived" | "deleted";
export type BatchSlotStatus = "pending" | "running" | "completed" | "failed";
export type BatchVersionSource = "generate" | "rerun" | "mask-edit" | "refine";

export interface BatchVersion {
  id: string;
  slotId: string;
  index: number;
  imageUrl?: string;
  blobKey?: string;
  thumbnailUrl?: string;
  model: string;
  promptUsed: string;
  size: string;
  createdAt: number;
  parentVersionId?: string;
  isPrimary?: boolean;
  source: BatchVersionSource;
}

export interface BatchSlot {
  id: string;
  jobId: string;
  type: BatchSceneType;
  title: string;
  targetCount: number;
  promptTemplate: string;
  size: string;
  status: BatchSlotStatus;
  error?: string;
  versions: BatchVersion[];
  activeVersionId?: string;
}

export interface BatchActionLog {
  id: string;
  jobId: string;
  action: string;
  operator: string;
  ts: number;
  payload?: Record<string, unknown>;
}

export interface BatchJob {
  id: string;
  title: string;
  projectId?: string;
  productId?: string;
  status: BatchJobStatus;
  basePrompt: string;
  referenceImageUrl?: string;
  productImageUrl?: string;  // 套图专用产品图
  modelImageUrl?: string;     // 套图专用固定模特图
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  deletedAt?: number;
  tags?: string[];
  slots: BatchSlot[];
  actionLogs: BatchActionLog[];
}
