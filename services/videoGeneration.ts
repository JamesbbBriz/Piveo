import { v4 as uuidv4 } from 'uuid';

export interface BuildVideoRequestInput {
  imageUrl: string;
  lastFrameImageUrl?: string;
  durationSec?: number;
  prompt?: string;
  model?: string;
  aspectRatio?: string;
  resolution?: string;
}

export interface VideoRequestPayload {
  prompt: string;
  model: string;
  size: string;
  input_reference: string[];
}

export interface VideoGenerationResult {
  id: string;
  url: string;
  durationSec: number;
  status?: string;
}

const DEFAULT_VIDEO_MODEL = 'veo_3_1-fl';
const FIXED_DURATION_SEC = 8;
const VIDEO_UPSTREAM_ERROR_PREFIX = 'Veo 上游生成失败';
const VIDEO_CONSISTENCY_SYSTEM_PROMPT = [
  '你是一个高质量视频生成助手。请严格基于用户提供的首帧、尾帧和提示词生成视频，并始终优先保证主体一致性与时序连续性。',
  '主体一致性优先：无论主体是人物、动物、车辆、产品或其他物体，都必须保持为同一主体，不能在视频过程中替换、漂移、重绘或变成另一种外观相似但身份不同的对象。',
  '外观一致性：主体的整体结构、比例、轮廓、颜色、材质、纹理、关键特征、配件和识别性细节必须在整个视频中保持稳定。禁止随时间出现无原因的新增、缺失、变形、错位、闪烁或跳变。',
  '首尾帧严格对齐：首帧定义起始状态，尾帧定义结束状态。视频中间过程必须是从首帧到尾帧的自然连续过渡，不能出现与首尾帧矛盾的主体形态、场景关系或运动轨迹。',
  '时序连续性：动作、镜头、光影、空间关系和物理运动必须连续、平滑、合理。避免突变、抽搐、漂移、瞬间换主体、局部结构崩坏或不合逻辑的运动。',
  '细节稳定：保持主体的身份特征稳定，包括但不限于五官、发型、服饰、肢体比例、品牌标识、产品形状、车辆结构、配件位置、表面细节和材质反射逻辑。',
  '背景服务主体：背景、环境和光影可以自然变化，但不能压过主体一致性。若背景变化与主体一致性冲突，应优先保证主体稳定。',
  '写实与质量：输出应具有高细节、稳定结构、真实材质、自然光影、合理透视和电影级流畅运动。避免低质量重绘感、闪烁感、变形感和帧间不一致。',
  '禁止出现以下问题：主体身份漂移、主体替换、结构变形、局部崩坏、细节闪烁、材质跳变、比例异常、配件丢失、配件新增、错误重绘、帧间不连续、首尾不一致。',
  '如果用户提示词与主体一致性冲突，优先保证主体一致性、首尾帧一致性和物理连续性。',
].join('\n');

const composeVideoPrompt = (userPrompt: string) => {
  const trimmedUserPrompt = String(userPrompt || '').trim();
  if (!trimmedUserPrompt) return VIDEO_CONSISTENCY_SYSTEM_PROMPT;
  return `${VIDEO_CONSISTENCY_SYSTEM_PROMPT}\n\n用户创作要求：${trimmedUserPrompt}`;
};

const resolveVideoSize = (model: string, aspectRatio: string, resolution: string) => {
  if (String(model || '').startsWith('veo_3_1')) {
    if (aspectRatio === '9:16') return '1080x1920';
    return '1920x1080';
  }
  throw new Error(`当前视频工作流仅支持 veo_3_1 模型，收到：${model || 'unknown'}`);
};

export const buildVideoRequest = ({
  imageUrl,
  lastFrameImageUrl,
  prompt = '',
  model = DEFAULT_VIDEO_MODEL,
  aspectRatio = '16:9',
  resolution = '1080p',
}: BuildVideoRequestInput): VideoRequestPayload => ({
  prompt: composeVideoPrompt(prompt),
  model,
  size: resolveVideoSize(model, aspectRatio, resolution),
  input_reference: [imageUrl, lastFrameImageUrl].filter(Boolean) as string[],
});

const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
  const resp = await fetch(dataUrl);
  if (!resp.ok) throw new Error(`参考图读取失败（HTTP ${resp.status}）`);
  return await resp.blob();
};

const readResponsePayload = async (resp: Response): Promise<any> => {
  const contentType = String(resp.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    return await resp.json().catch(() => ({}));
  }
  const text = await resp.text().catch(() => '');
  return text ? { message: text } : {};
};

const extractErrorMessage = (payload: any, fallback: string) => {
  const candidates = [
    payload?.error?.message,
    payload?.message,
    payload?.detail,
    payload?.error,
  ];
  const found = candidates.find((value) => typeof value === 'string' && value.trim());
  return found ? String(found) : fallback;
};

const extractVideoUrl = (json: any): string | null => {
  const candidates = [
    json?.url,
    json?.video_url,
    json?.video?.url,
    json?.data?.url,
    json?.result?.url,
    json?.output?.url,
    Array.isArray(json?.output) ? json.output[0]?.url : null,
    Array.isArray(json?.data) ? json.data[0]?.url : null,
  ];
  const found = candidates.find((value) => typeof value === 'string' && value.trim());
  return found ? String(found) : null;
};

const extractTaskId = (json: any): string | null => {
  const candidates = [
    json?.id,
    json?.task_id,
    json?.video_id,
    json?.video?.id,
    json?.task?.id,
    json?.data?.id,
    Array.isArray(json?.data) ? json.data[0]?.id : null,
  ];
  const found = candidates.find((value) => typeof value === 'string' && value.trim());
  return found ? String(found) : null;
};

const isTerminalStatus = (status: string) => ['completed', 'succeeded', 'failed', 'error', 'cancelled'].includes(status);
export const fetchUpstreamVideoTask = async (taskId: string): Promise<VideoGenerationResult> => {
  const resp = await fetch(`/api/v1/videos/${taskId}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  const json = await readResponsePayload(resp);
  if (!resp.ok) {
    throw new Error(`视频任务状态查询失败（${extractErrorMessage(json, `HTTP ${resp.status}`)}）`);
  }
  const status = String(json?.status || '').toLowerCase() || 'processing';
  const videoUrl = extractVideoUrl(json)
    || ((status === 'completed' || status === 'succeeded') ? `/api/v1/videos/${taskId}/content` : '');
  if (isTerminalStatus(status) && status !== 'completed' && status !== 'succeeded') {
    throw new Error(String(json?.error?.message || json?.message || `视频任务失败：${status}`));
  }
  return {
    id: extractTaskId(json) || taskId,
    url: videoUrl,
    durationSec: FIXED_DURATION_SEC,
    status,
  };
};

export const startFirstFrameVideo = async (input: BuildVideoRequestInput): Promise<VideoGenerationResult> => {
  const model = input.model || DEFAULT_VIDEO_MODEL;

  if (!String(model || '').startsWith('veo_3_1')) {
    throw new Error(`当前视频工作流仅支持 veo_3_1 模型，收到：${model || 'unknown'}`);
  }

  const payload = buildVideoRequest(input);

  try {
    const formData = new FormData();
    formData.append('prompt', payload.prompt);
    formData.append('model', payload.model);
    formData.append('size', payload.size);
    formData.append('seconds', String(FIXED_DURATION_SEC));
    if (payload.input_reference.length > 0) {
      for (const [index, reference] of payload.input_reference.entries()) {
        const referenceBlob = await dataUrlToBlob(reference);
        formData.append('input_reference', referenceBlob, `video-reference-${index + 1}.webp`);
      }
    }

    const resp = await fetch('/api/v1/videos', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    const created = await readResponsePayload(resp);
    if (!resp.ok) {
      throw new Error(extractErrorMessage(created, `HTTP ${resp.status}`));
    }
    const immediateUrl = extractVideoUrl(created);
    const taskId = extractTaskId(created);
    if (immediateUrl) {
      return {
        id: taskId || uuidv4(),
        url: immediateUrl,
        durationSec: FIXED_DURATION_SEC,
        status: String(created?.status || 'completed').toLowerCase() || 'completed',
      };
    }
    if (!taskId) throw new Error('视频任务创建成功，但未返回任务 ID。');
    return {
      id: taskId,
      url: '',
      durationSec: FIXED_DURATION_SEC,
      status: String(created?.status || 'queued').toLowerCase() || 'queued',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    console.error(`[video] upstream generation failed: ${message}`);
    throw new Error(`${VIDEO_UPSTREAM_ERROR_PREFIX}：${message}`);
  }
};

export const startFrameToFrameVideo = async (input: BuildVideoRequestInput): Promise<VideoGenerationResult> => {
  return await startFirstFrameVideo(input);
};
