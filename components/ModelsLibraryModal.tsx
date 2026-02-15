import React, { useRef, useState } from "react";
import { ModelCharacter } from "../types";
import { Icon } from "./Icon";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { generateModelCharacter } from "../services/gemini";

interface ModelsLibraryModalProps {
  models: ModelCharacter[];
  onAddModel: (model: ModelCharacter) => void;
  onDeleteModel: (modelId: string) => void;
  onRenameModel: (modelId: string, newName: string) => void;
  onClose: () => void;
}

export const ModelsLibraryModal: React.FC<ModelsLibraryModalProps> = ({
  models,
  onAddModel,
  onDeleteModel,
  onRenameModel,
  onClose,
}) => {
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [awaitingPaste, setAwaitingPaste] = useState(false);
  const [genDescription, setGenDescription] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const pasteTargetRef = useRef<HTMLDivElement>(null);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const imageUrl = await generateModelCharacter({
        description: genDescription.trim() || undefined,
      });
      onAddModel({
        id: crypto.randomUUID(),
        name: genDescription.trim()
          ? genDescription.trim().slice(0, 10)
          : `AI 模特 ${models.length + 1}`,
        imageUrl,
      });
      setGenDescription("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`生成模特失败：${msg}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onloadend = () => {
          onAddModel({
            id: crypto.randomUUID(),
            name: `自定义模特 ${models.length + 1}`,
            imageUrl: reader.result as string,
          });
        };
        reader.readAsDataURL(file);
        setAwaitingPaste(false);
        return;
      }
    }
  };

  const primePaste = () => {
    pasteTargetRef.current?.focus();
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const newModel: ModelCharacter = {
        id: crypto.randomUUID(),
        name: `自定义模特 ${models.length + 1}`,
        imageUrl: reader.result as string,
      };
      onAddModel(newModel);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const startRename = (model: ModelCharacter) => {
    setEditingModelId(model.id);
    setEditingName(model.name);
  };

  const saveRename = (modelId: string) => {
    const trimmed = editingName.trim();
    if (trimmed && trimmed !== models.find(m => m.id === modelId)?.name) {
      onRenameModel(modelId, trimmed);
    }
    setEditingModelId(null);
    setEditingName("");
  };

  const cancelRename = () => {
    setEditingModelId(null);
    setEditingName("");
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div
          className="bg-dark-900 border border-dark-700 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700">
            <div className="flex items-center gap-3">
              <Icon name="users" className="text-banana-400 text-xl" />
              <h2 className="text-xl font-semibold text-gray-100">模特库</h2>
              <span className="px-2 py-0.5 text-xs rounded-full bg-dark-800 text-gray-400 border border-dark-600">
                {models.length} 个模特
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={genDescription}
                onChange={(e) => setGenDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isGenerating) handleGenerate();
                }}
                placeholder="描述模特风格（可选）"
                disabled={isGenerating}
                className="h-8 w-48 px-2.5 text-xs rounded-md border border-dark-600 bg-dark-800 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-banana-500 disabled:opacity-50"
              />
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="h-8 px-2.5 rounded-md border border-banana-500/40 bg-banana-500/10 text-banana-400 hover:bg-banana-500/20 text-[11px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                title="AI 生成模特"
              >
                {isGenerating ? (
                  <Icon name="spinner" className="animate-spin" />
                ) : (
                  <Icon name="magic" />
                )}
                AI 生成
              </button>
              <div
                ref={pasteTargetRef}
                tabIndex={0}
                onFocus={() => setAwaitingPaste(true)}
                onBlur={() => setAwaitingPaste(false)}
                onPaste={handlePaste}
                className="sr-only"
                aria-label="粘贴模特图片目标"
              />
              <button
                onClick={primePaste}
                className={`h-8 px-2.5 rounded-md border text-[11px] transition-colors ${
                  awaitingPaste
                    ? "border-banana-500/40 bg-banana-500/10 text-banana-400"
                    : "border-dark-600 bg-dark-800 text-gray-300 hover:text-gray-100 hover:border-gray-500"
                }`}
                title="粘贴模特图"
              >
                粘贴模特
              </button>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg bg-dark-800 hover:bg-dark-700 text-gray-400 hover:text-gray-200 flex items-center justify-center transition-colors"
              >
                <Icon name="times" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {/* Upload Card */}
              <div
                onClick={() => uploadInputRef.current?.click()}
                className="aspect-[3/4] rounded-lg border-2 border-dashed border-dark-600 bg-dark-800/40 hover:border-banana-500 hover:bg-dark-800 transition-colors cursor-pointer flex flex-col items-center justify-center gap-2 text-gray-500 hover:text-banana-400"
              >
                <Icon name="plus" className="text-3xl" />
                <span className="text-xs">上传模特</span>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleUpload}
                />
              </div>

              {/* Model Cards */}
              {models.map((model) => (
                <div
                  key={model.id}
                  className="aspect-[3/4] rounded-lg border border-dark-700 bg-dark-800/60 overflow-hidden group relative"
                >
                  {/* Image */}
                  <img
                    src={model.imageUrl}
                    alt={model.name}
                    onClick={() => setPreviewImageUrl(model.imageUrl)}
                    className="w-full h-full object-cover cursor-pointer group-hover:opacity-90 transition-opacity"
                    loading="lazy"
                    decoding="async"
                  />

                  {/* Overlay with actions */}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-3 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {/* Name / Edit */}
                    {editingModelId === model.id ? (
                      <div className="flex gap-1">
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveRename(model.id);
                            if (e.key === "Escape") cancelRename();
                          }}
                          className="flex-1 px-2 py-1 text-xs rounded bg-dark-900 border border-dark-600 text-gray-200 focus:outline-none focus:border-banana-500"
                          autoFocus
                        />
                        <button
                          onClick={() => saveRename(model.id)}
                          className="px-2 py-1 text-xs rounded bg-banana-500 text-dark-900 hover:bg-banana-400"
                        >
                          <Icon name="check" />
                        </button>
                        <button
                          onClick={cancelRename}
                          className="px-2 py-1 text-xs rounded bg-dark-700 text-gray-300 hover:bg-dark-600"
                        >
                          <Icon name="times" />
                        </button>
                      </div>
                    ) : (
                      <div
                        onClick={() => startRename(model)}
                        className="text-xs text-gray-200 font-medium truncate cursor-pointer hover:text-banana-400"
                        title={`点击重命名：${model.name}`}
                      >
                        {model.name}
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-1">
                      <button
                        onClick={() => startRename(model)}
                        className="flex-1 px-2 py-1 text-xs rounded bg-dark-800/80 border border-dark-600 text-gray-300 hover:border-banana-500 hover:text-banana-400 transition-colors"
                      >
                        <Icon name="edit" className="mr-1" />
                        改名
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`确定要删除模特"${model.name}"吗？`)) {
                            onDeleteModel(model.id);
                          }
                        }}
                        className="flex-1 px-2 py-1 text-xs rounded bg-dark-800/80 border border-red-500/40 text-red-300 hover:bg-red-500/20 transition-colors"
                      >
                        <Icon name="trash" className="mr-1" />
                        删除
                      </button>
                    </div>
                  </div>

                  {/* Delete button (top-right, always visible) */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`确定要删除模特"${model.name}"吗？`)) {
                        onDeleteModel(model.id);
                      }
                    }}
                    className="absolute top-2 right-2 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center text-xs shadow-lg hover:bg-red-600 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Icon name="times" />
                  </button>
                </div>
              ))}
            </div>

            {models.length === 0 && (
              <div className="py-16 text-center">
                <Icon name="users" className="text-6xl text-gray-700 mb-4" />
                <p className="text-gray-500 text-sm">还没有模特，点击上方卡片上传第一个模特</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-dark-700 flex items-center justify-between bg-dark-900/60">
            <p className={`text-xs ${awaitingPaste ? "text-banana-400" : "text-gray-500"}`}>
              {awaitingPaste
                ? "现在直接按 Cmd/Ctrl + V 即可把剪贴板图片放进模特库。"
                : "提示：点击模特名称可以重命名"}
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-dark-800 hover:bg-dark-700 text-gray-200 border border-dark-600 transition-colors"
            >
              关闭
            </button>
          </div>
        </div>
      </div>

      {/* Image Preview */}
      {previewImageUrl && (
        <ImagePreviewModal
          imageUrl={previewImageUrl}
          onClose={() => setPreviewImageUrl(null)}
        />
      )}
    </>
  );
};
