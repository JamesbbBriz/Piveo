import { v4 as uuidv4 } from 'uuid';
import type { BrandKit } from '@/types';
import type {
  PiveoGenerateContext,
  PiveoScene,
  PiveoStylePreset,
  GeneratedMediaImage,
  GeneratedMediaVideo,
} from '@/components/piveo/types';
import { ResponseFormat, imageObjToDataUrl, imagesGenerations } from './openaiImages';
import { buildBrandKitPrompt } from './brandkitPrompt';
import { startFirstFrameVideo } from './videoGeneration';
import { urlToDataUrl } from './imageData';

export interface BuiltMediaTasks {
  imageTasks: Array<{ style: string }>;
  videoTask: { type: 'first-frame-video' };
  sharedContext: { brandKitId: string | null };
}

export interface GenerateMediaSetResult {
  images: GeneratedMediaImage[];
  video: GeneratedMediaVideo | null;
}

const scenePromptDirective = (scene: PiveoScene) => {
  if (scene === 'product') {
    return '任务场景：商品展示。确保产品外观真实，适合独立站主图与详情页。';
  }
  if (scene === 'model') {
    return '任务场景：模特展示。确保人像自然，服饰或商品穿戴关系准确。';
  }
  return '任务场景：房屋与空间设计。可用于建筑外观与室内方案，保持结构比例、尺度关系与材质表达真实。';
};

const resolveBrandKitImages = async (brandKit: BrandKit | null): Promise<string[]> => {
  if (!brandKit?.images?.length) return [];
  const resolved = await Promise.all(
    brandKit.images
      .map((img) => img.imageUrl)
      .filter(Boolean)
      .slice(0, 3)
      .map(async (url) => {
        if (/^data:|^https?:\/\//i.test(url)) return url;
        try {
          return await urlToDataUrl(url);
        } catch {
          return null;
        }
      })
  );
  return resolved.filter((v): v is string => Boolean(v));
};

export const buildMediaTasks = ({ styles, brandKitId }: { styles: string[]; brandKitId?: string }): BuiltMediaTasks => ({
  imageTasks: styles.map((style) => ({ style })),
  videoTask: { type: 'first-frame-video' },
  sharedContext: { brandKitId: brandKitId || null },
});

const buildPrompt = (scene: PiveoScene, style: PiveoStylePreset, brandKit: BrandKit | null): string => {
  const bk = buildBrandKitPrompt(brandKit);
  return [scenePromptDirective(scene), bk, `风格：${style.name}。`, style.promptTemplate]
    .filter(Boolean)
    .join('\n')
    .trim();
};

export const generateMediaSet = async (
  context: PiveoGenerateContext,
  onProgress?: (phase: 'images' | 'video', current: number, total: number) => void
): Promise<GenerateMediaSetResult> => {
  const images: GeneratedMediaImage[] = [];
  const styles = context.styles;
  const total = styles.length;
  const brandKitImages = await resolveBrandKitImages(context.activeBrandKit);

  for (let i = 0; i < styles.length; i++) {
    const style = styles[i];
    const prompt = buildPrompt(context.scene, style, context.activeBrandKit);
    const resp = await imagesGenerations(
      {
        model: context.model as any,
        prompt,
        systemPrompt: context.systemPrompt,
        image: [context.uploadedImage, ...brandKitImages],
        n: 1,
        size: context.size,
        response_format: ResponseFormat.Url,
      },
      {
        signal: context.signal,
        queueSource: 'chat',
      }
    );

    const generated = imageObjToDataUrl(resp.data[0]);
    if (generated) {
      images.push({
        id: uuidv4(),
        url: generated,
        styleId: style.id,
        styleName: style.name,
        promptUsed: prompt,
      });
    }
    onProgress?.('images', i + 1, total);
  }

  onProgress?.('video', 0, 1);
  let video: GeneratedMediaVideo | null = null;
  try {
    const generatedVideo = await startFirstFrameVideo({
      imageUrl: context.uploadedImage,
      durationSec: 15,
      prompt: `Create social-ready motion in ${context.scene} style`,
    });
    video = {
      id: generatedVideo.id,
      url: generatedVideo.url,
      durationSec: generatedVideo.durationSec,
      mutedAutoplay: true,
    };
  } finally {
    onProgress?.('video', 1, 1);
  }

  return { images, video };
};
