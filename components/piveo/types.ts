import type { BrandKit } from '@/types';

export type PiveoScene = 'product' | 'model' | 'architecture';

export interface PiveoSceneOption {
  id: PiveoScene;
  label: string;
  hint: string;
  icon: string;
}

export interface PiveoStylePreset {
  id: string;
  name: string;
  thumbnail: string;
  promptTemplate: string;
  sceneCompat: PiveoScene[];
}

export interface ProcessedUpload {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
  mime: string;
}

export interface GeneratedMediaImage {
  id: string;
  url: string;
  styleId: string;
  styleName: string;
  promptUsed: string;
}

export interface GeneratedMediaVideo {
  id: string;
  url: string;
  durationSec: number;
  mutedAutoplay: boolean;
  fallback?: boolean;
}

export interface PiveoGenerateContext {
  scene: PiveoScene;
  uploadedImage: string;
  styles: PiveoStylePreset[];
  activeBrandKit: BrandKit | null;
  model: string;
  size: string;
  systemPrompt?: string;
  signal?: AbortSignal;
}
