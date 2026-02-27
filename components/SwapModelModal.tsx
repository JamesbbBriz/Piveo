import React, { useState, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Icon } from './Icon';
import { generateResponse, generateModelCharacter } from '../services/gemini';
import type { ModelCharacter, SessionSettings } from '../types';
import { useToast } from './Toast';

interface SwapModelModalProps {
  sourceImageUrl: string;
  sourcePrompt?: string;
  models: ModelCharacter[];
  settings: SessionSettings;
  onAddModel: (model: ModelCharacter) => void;
  onClose: () => void;
  onFinish: (resultImageUrl: string) => void;
}

function buildSwapModelPrompt(note: string): string {
  const lines = [
    '【换模特任务】请仔细观察图片1（原图），完成以下操作：',
    '1. 识别原图中的产品/商品，记住其外观、颜色、材质、品牌标识、角度等所有细节',
    '2. 识别原图中人物的姿势、握持/穿戴产品的方式、站位',
    '3. 识别原图的场景、背景、光线、色调、拍摄角度',
    '4. 将原图中的人物替换为图片2中的模特（面部、肤色、身材、发型以图片2为准）',
    '5. 新模特采用与原图人物相同的姿势和位置，自然融入场景',
    '6. 产品保持与原图完全一致——外观、颜色、大小、位置不得改变',
    '7. 背景、光线、色调、整体氛围保持与原图一致',
    '',
    '严禁修改产品外观。严禁改变背景环境。只替换人物。',
  ];
  if (note.trim()) {
    lines.push(`\n补充要求：${note.trim()}`);
  }
  return lines.join('\n');
}

export const SwapModelModal: React.FC<SwapModelModalProps> = ({
  sourceImageUrl,
  sourcePrompt,
  models,
  settings,
  onAddModel,
  onClose,
  onFinish,
}) => {
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [additionalNote, setAdditionalNote] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingModel, setIsGeneratingModel] = useState(false);
  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToast();

  const selectedModel = selectedModelId ? models.find((m) => m.id === selectedModelId) : null;

  const handleGenerate = useCallback(async () => {
    if (!selectedModel || isGenerating) return;
    setIsGenerating(true);
    setError(null);
    setResultImageUrl(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const prompt = buildSwapModelPrompt(additionalNote);
      const result = await generateResponse(
        prompt,
        sourceImageUrl,       // referenceImage = original photo
        selectedModel.imageUrl, // modelImage = new model
        null,                   // productImage = null (product is in original)
        [],                     // empty history
        settings,
        {
          disableAutoUseLastImage: true,
          referenceIntent: 'all',
          queueSource: 'chat',
          signal: controller.signal,
        }
      );
      if (result.images.length > 0) {
        setResultImageUrl(result.images[0]);
      } else {
        setError('未返回图片结果，请重试。');
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setError(e?.message || '生成失败，请重试。');
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [selectedModel, isGenerating, additionalNote, sourceImageUrl, settings]);

  const handleAccept = useCallback(() => {
    if (resultImageUrl) {
      onFinish(resultImageUrl);
    }
  }, [resultImageUrl, onFinish]);

  const handleRetry = useCallback(() => {
    setResultImageUrl(null);
    setError(null);
  }, []);

  const handleUploadModel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const model: ModelCharacter = {
        id: uuidv4(),
        name: `自定义模特 ${models.length + 1}`,
        imageUrl: reader.result as string,
      };
      onAddModel(model);
      setSelectedModelId(model.id);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleGenerateModel = async () => {
    setIsGeneratingModel(true);
    try {
      const imageUrl = await generateModelCharacter();
      const model: ModelCharacter = {
        id: uuidv4(),
        name: `AI 模特 ${models.length + 1}`,
        imageUrl,
      };
      onAddModel(model);
      setSelectedModelId(model.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addToast({ type: 'error', message: `生成模特失败：${msg}` });
    } finally {
      setIsGeneratingModel(false);
    }
  };

  const handleClose = () => {
    abortRef.current?.abort();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={handleClose}>
      <div
        className="bg-dark-900 border border-dark-600 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto custom-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-dark-700">
          <div className="flex items-center gap-2">
            <Icon name="user-pen" className="text-purple-400 text-sm" />
            <span className="text-sm font-bold text-gray-200">换模特</span>
          </div>
          <button onClick={handleClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <Icon name="times" className="text-sm" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Source image thumbnail */}
          <div>
            <div className="text-[11px] text-gray-500 mb-1.5">原图</div>
            <div className="w-16 h-16 rounded-lg overflow-hidden border border-dark-600 bg-dark-800">
              <img src={sourceImageUrl} alt="原图" className="w-full h-full object-cover" />
            </div>
          </div>

          {!resultImageUrl ? (
            <>
              {/* Model selection grid */}
              <div>
                <div className="text-[11px] text-gray-500 mb-1.5">选择新模特</div>
                <div className="flex flex-wrap gap-2 mb-2">
                  {models.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setSelectedModelId(m.id)}
                      className={`relative h-14 w-14 rounded-lg overflow-hidden border-2 transition-colors ${
                        selectedModelId === m.id
                          ? 'border-purple-500'
                          : 'border-dark-600 hover:border-gray-400'
                      }`}
                      title={m.name}
                    >
                      <img src={m.imageUrl} alt={m.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" decoding="async" />
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => uploadRef.current?.click()}
                    className="flex-1 h-7 rounded-md border border-dark-600 bg-dark-800 text-[11px] text-gray-300 hover:border-gray-500 transition-colors flex items-center justify-center gap-1"
                  >
                    <Icon name="upload" className="text-[9px]" />
                    上传
                  </button>
                  <button
                    onClick={handleGenerateModel}
                    disabled={isGeneratingModel}
                    className="flex-1 h-7 rounded-md border border-dark-600 bg-dark-800 text-[11px] text-purple-400 hover:border-gray-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                  >
                    <Icon name={isGeneratingModel ? 'spinner' : 'magic'} className={isGeneratingModel ? 'fa-spin' : ''} />
                    AI生成
                  </button>
                </div>
                <input ref={uploadRef} type="file" accept="image/*" className="hidden" onChange={handleUploadModel} />
              </div>

              {/* Additional note */}
              <div>
                <div className="text-[11px] text-gray-500 mb-1.5">补充说明（可选）</div>
                <input
                  type="text"
                  value={additionalNote}
                  onChange={(e) => setAdditionalNote(e.target.value)}
                  placeholder="如：侧身看镜头、微笑..."
                  className="w-full h-9 px-3 bg-dark-800 border border-dark-600 rounded-lg text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500/50"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && selectedModel) handleGenerate();
                  }}
                />
              </div>

              {/* Error */}
              {error && (
                <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              {/* Generate button */}
              <button
                onClick={handleGenerate}
                disabled={!selectedModel || isGenerating}
                className="w-full h-10 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:bg-dark-700 disabled:text-gray-600 text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2"
              >
                {isGenerating ? (
                  <>
                    <Icon name="spinner" className="fa-spin text-xs" />
                    正在替换模特…
                  </>
                ) : (
                  <>
                    <Icon name="user-pen" className="text-xs" />
                    开始替换
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              {/* Result preview */}
              <div>
                <div className="text-[11px] text-gray-500 mb-1.5">替换结果</div>
                <div className="rounded-lg overflow-hidden border border-dark-600 bg-dark-800">
                  <img src={resultImageUrl} alt="替换结果" className="w-full object-contain max-h-[400px]" />
                </div>
              </div>

              {/* Accept / Retry buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleRetry}
                  className="flex-1 h-10 rounded-lg border border-dark-600 bg-dark-800 text-sm text-gray-300 hover:text-gray-100 hover:border-gray-500 transition-colors flex items-center justify-center gap-2"
                >
                  <Icon name="redo" className="text-xs" />
                  重试
                </button>
                <button
                  onClick={handleAccept}
                  className="flex-1 h-10 rounded-lg bg-purple-600 hover:bg-purple-500 text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2"
                >
                  <Icon name="check" className="text-xs" />
                  采用
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
