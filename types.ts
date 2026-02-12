
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
