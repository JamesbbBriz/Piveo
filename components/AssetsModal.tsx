import React, { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { Icon } from "./Icon";
import { downloadImageWithFormat, loadDownloadOptions, saveDownloadOptions } from "../services/imageDownload";
import { dataUrlToBlob } from "../services/imageData";
import { useToast } from "./Toast";
import type { DownloadOptions } from "../services/imageDownload";

export interface AssetItem {
  id: string;
  url: string;
  sessionId: string;
  sessionTitle: string;
  createdAt: number;
  prompt?: string;
  model?: string;
  size?: string;
  responseFormat?: string;
  parentImageUrl?: string;
}

interface AssetsModalProps {
  isOpen?: boolean;
  assets: AssetItem[];
  onClose?: () => void;
  onOpenMaskEdit: (baseImageUrl: string) => void;
  onUseAsReference: (imageUrl: string) => void;
  onUsePrompt: (prompt: string) => void;
}

const TAGS_KEY = "topseller_asset_tags_v1";
const LEGACY_TAGS_KEY = "nanobanana_asset_tags_v1";

const loadTags = (): Record<string, string[]> => {
  try {
    const raw = localStorage.getItem(TAGS_KEY) || localStorage.getItem(LEGACY_TAGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, string[]>;
  } catch {
    return {};
  }
};

const saveTags = (tags: Record<string, string[]>) => {
  localStorage.setItem(TAGS_KEY, JSON.stringify(tags));
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const guessExt = (url: string): string => {
  const m = /^data:([^;]+);base64,/i.exec(url);
  const mime = m?.[1] || "";
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "png";
};

export const AssetsModal: React.FC<AssetsModalProps> = ({
  isOpen = true,
  assets,
  onClose,
  onOpenMaskEdit,
  onUseAsReference,
  onUsePrompt,
}) => {
  const [query, setQuery] = useState("");
  const [sessionFilter, setSessionFilter] = useState<string>("__all__");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tagMap, setTagMap] = useState<Record<string, string[]>>({});
  const [isExporting, setIsExporting] = useState(false);
  const [downloadOptions] = useState<DownloadOptions>(loadDownloadOptions);
  const { addToast } = useToast();

  useEffect(() => {
    if (!isOpen) return;
    setTagMap(loadTags());
    setSessionFilter("__all__");
  }, [isOpen]);

  const sessions = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of assets) m.set(a.sessionId, a.sessionTitle);
    return Array.from(m.entries()).map(([id, title]) => ({ id, title }));
  }, [assets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets
      .filter((a) => (sessionFilter === "__all__" ? true : a.sessionId === sessionFilter))
      .filter((a) => {
        if (!q) return true;
        const tags = (tagMap[a.id] || []).join(" ").toLowerCase();
        const hay =
          `${a.sessionTitle} ${a.prompt || ""} ${a.model || ""} ${a.size || ""} ${tags}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [assets, query, sessionFilter, tagMap]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return assets.find((a) => a.id === selectedId) || null;
  }, [assets, selectedId]);

  const setTagsFor = (id: string, tags: string[]) => {
    const next = { ...tagMap, [id]: tags };
    setTagMap(next);
    saveTags(next);
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      addToast({ type: 'success', message: '已复制到剪贴板' });
    } catch {
      addToast({ type: 'error', message: '复制失败（浏览器权限限制）' });
    }
  };

  const exportJson = () => {
    const payload = {
      exportedAt: Date.now(),
      assets: filtered.map((a) => ({
        ...a,
        tags: tagMap[a.id] || [],
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    downloadBlob(blob, `piveo-assets-${Date.now()}.json`);
  };

  const downloadOne = async (a: AssetItem) => {
    try {
      await downloadImageWithFormat(a.url, {
        basename: `piveo-${a.id}`,
        quality: downloadOptions.quality,
      });
    } catch (e) {
      addToast({ type: 'error', message: '下载失败（可能是跨域或链接已失效）' });
      console.warn("downloadOne failed:", e);
    }
  };

  const exportZip = async () => {
    setIsExporting(true);
    try {
      const zip = new JSZip();
      const manifest = filtered.map((a) => ({
        ...a,
        tags: tagMap[a.id] || [],
      }));

      zip.file("metadata.json", JSON.stringify({ exportedAt: Date.now(), assets: manifest }, null, 2));

      const folder = zip.folder("images");
      if (!folder) throw new Error("创建 zip 目录失败");

      const concurrency = 5;
      let cursor = 0;
      let skipped = 0;
      const workers = Array.from({ length: Math.min(concurrency, filtered.length || 1) }, async () => {
        while (cursor < filtered.length) {
          const index = cursor++;
          const a = filtered[index];
          const ext = guessExt(a.url);
          const filename = `${String(index + 1).padStart(3, "0")}_${a.id}.${ext}`;
          try {
            if (a.url.startsWith("data:")) {
              const blob = await dataUrlToBlob(a.url);
              folder.file(filename, blob);
            } else {
              const resp = await fetch(a.url);
              if (!resp.ok) {
                skipped += 1;
                continue;
              }
              folder.file(filename, await resp.blob());
            }
          } catch {
            skipped += 1;
          }
        }
      });
      await Promise.all(workers);

      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, `piveo-assets-${Date.now()}.zip`);
      if (skipped > 0) {
        addToast({ type: 'warning', message: `导出完成，跳过 ${skipped} 张失效图片。` });
      } else {
        addToast({ type: 'success', message: '导出 ZIP 完成' });
      }
    } catch (e) {
      console.warn("exportZip failed:", e);
      addToast({ type: 'error', message: '导出失败，请重试。' });
    } finally {
      setIsExporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="relative w-full h-full flex overflow-hidden">
        {/* Left: list */}
        <div className="w-full lg:w-[55%] border-r border-dark-700 flex flex-col">
          <div className="p-4 border-b border-dark-700 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Icon name="images" />
              <h2 className="text-sm font-semibold text-gray-200 truncate">素材库</h2>
              <span className="text-[10px] bg-dark-700 px-2 py-0.5 rounded text-gray-500">
                {filtered.length} 张
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={exportJson}
                className="px-3 py-2 text-xs bg-dark-700 hover:bg-dark-600 text-gray-200 border border-dark-600 rounded-lg"
                title="导出 JSON"
              >
                <Icon name="file-export" /> 导出 JSON
              </button>
              <button
                onClick={exportZip}
                disabled={isExporting}
                className="px-3 py-2 text-xs bg-dark-700 hover:bg-dark-600 text-gray-200 border border-dark-600 rounded-lg disabled:opacity-50"
                title="导出 ZIP"
              >
                <Icon name={isExporting ? "spinner" : "file-archive"} className={isExporting ? "fa-spin" : ""} />{" "}
                导出 ZIP
              </button>
            </div>
          </div>

          <div className="p-4 border-b border-dark-700 flex gap-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索：提示词/标签/尺寸/模型..."
              className="flex-1 bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-banana-500"
            />
            <select
              value={sessionFilter}
              onChange={(e) => setSessionFilter(e.target.value)}
              className="bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-banana-500"
              title="按项目筛选"
            >
              <option value="__all__">全部项目</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {filtered.length === 0 ? (
              <div className="text-center text-gray-500 text-sm py-10">没有找到素材</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {filtered.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setSelectedId(a.id)}
                    className={`relative rounded-xl overflow-hidden border transition-colors ${
                      selectedId === a.id ? "border-banana-500" : "border-dark-700 hover:border-gray-500"
                    }`}
                    title={a.prompt || ""}
                  >
                    <img src={a.url} alt="素材" className="w-full h-28 object-cover bg-black/20" loading="lazy" decoding="async" />
                    <div className="absolute inset-x-0 bottom-0 bg-black/55 backdrop-blur px-2 py-1">
                      <div className="text-[10px] text-gray-200 truncate">{a.size || "—"}</div>
                      <div className="text-[10px] text-gray-400 truncate">{a.sessionTitle}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: detail */}
        <div className="hidden lg:flex lg:w-[45%] flex-col">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
              选择一张素材查看详情
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-dark-700 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-200 truncate">素材详情</div>
                  <div className="text-[11px] text-gray-500 truncate">
                    {selected.model || "—"} · {selected.size || "—"} · {new Date(selected.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onOpenMaskEdit(selected.url)}
                    className="px-3 py-2 text-xs bg-dark-700 hover:bg-dark-600 text-gray-200 border border-dark-600 rounded-lg"
                    title="局部编辑"
                  >
                    <Icon name="paint-brush" /> 局部编辑
                  </button>
                  <button
                    onClick={() => downloadOne(selected)}
                    className="px-3 py-2 text-xs bg-banana-500 hover:bg-banana-400 text-dark-900 font-semibold rounded-lg"
                    title="下载"
                  >
                    <Icon name="download" /> 下载
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="rounded-xl overflow-hidden border border-dark-700 bg-black/20">
                  <img src={selected.url} alt="素材预览" className="w-full h-auto object-contain max-h-[340px] block" loading="lazy" decoding="async" />
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      onUseAsReference(selected.url);
                      addToast({ type: 'success', message: '已设为参考图' });
                    }}
                    className="px-3 py-2 text-xs bg-dark-700 hover:bg-dark-600 text-gray-200 border border-dark-600 rounded-lg"
                  >
                    <Icon name="image" /> 设为参考图
                  </button>
                  {selected.prompt && (
                    <button
                      onClick={() => {
                        onUsePrompt(selected.prompt || "");
                        addToast({ type: 'success', message: '已回填提示词' });
                      }}
                      className="px-3 py-2 text-xs bg-dark-700 hover:bg-dark-600 text-gray-200 border border-dark-600 rounded-lg"
                    >
                      <Icon name="pen" /> 回填提示词
                    </button>
                  )}
                </div>

                <div className="bg-dark-900/40 border border-dark-700 rounded-xl p-3">
                  <div className="text-[11px] text-gray-400 mb-2">提示词</div>
                  <div className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
                    {selected.prompt || "（无）"}
                  </div>
                  {selected.prompt && (
                    <div className="mt-3">
                      <button
                        onClick={() => handleCopy(selected.prompt!)}
                        className="px-3 py-2 text-xs bg-dark-700 hover:bg-dark-600 text-gray-200 border border-dark-600 rounded-lg"
                      >
                        <Icon name="copy" /> 复制提示词
                      </button>
                    </div>
                  )}
                </div>

                <div className="bg-dark-900/40 border border-dark-700 rounded-xl p-3">
                  <div className="text-[11px] text-gray-400 mb-2">标签（逗号分隔）</div>
                  <input
                    value={(tagMap[selected.id] || []).join(", ")}
                    onChange={(e) =>
                      setTagsFor(
                        selected.id,
                        e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean)
                      )
                    }
                    className="w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-banana-500"
                    placeholder="例如：电商, 白底, 发圈"
                  />
                </div>

              </div>
            </>
          )}
        </div>

        {/* Mobile detail overlay */}
        {selected && (
          <div className="lg:hidden absolute inset-0 bg-dark-800 flex flex-col">
            <div className="p-4 border-b border-dark-700 flex items-center justify-between gap-3">
              <button
                onClick={() => setSelectedId(null)}
                className="px-3 py-2 text-xs bg-dark-700 hover:bg-dark-600 text-gray-200 border border-dark-600 rounded-lg"
              >
                <Icon name="chevron-left" /> 返回
              </button>
              <div className="min-w-0 text-center">
                <div className="text-sm font-semibold text-gray-200 truncate">素材详情</div>
                <div className="text-[11px] text-gray-500 truncate">
                  {selected.model || "—"} · {selected.size || "—"}
                </div>
              </div>
              <div />
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="rounded-xl overflow-hidden border border-dark-700 bg-black/20">
                <img src={selected.url} alt="素材预览" className="w-full h-auto object-contain max-h-[52vh] block" loading="lazy" decoding="async" />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    onUseAsReference(selected.url);
                    addToast({ type: 'success', message: '已设为参考图' });
                  }}
                  className="px-3 py-2 text-xs bg-dark-700 hover:bg-dark-600 text-gray-200 border border-dark-600 rounded-lg"
                >
                  <Icon name="image" /> 设为参考图
                </button>
                {selected.prompt && (
                  <button
                    onClick={() => {
                      onUsePrompt(selected.prompt || "");
                      addToast({ type: 'success', message: '已回填提示词' });
                    }}
                    className="px-3 py-2 text-xs bg-dark-700 hover:bg-dark-600 text-gray-200 border border-dark-600 rounded-lg"
                  >
                    <Icon name="pen" /> 回填提示词
                  </button>
                )}
                <button
                  onClick={() => onOpenMaskEdit(selected.url)}
                  className="px-3 py-2 text-xs bg-dark-700 hover:bg-dark-600 text-gray-200 border border-dark-600 rounded-lg"
                >
                  <Icon name="paint-brush" /> 局部编辑
                </button>
                <button
                  onClick={() => downloadOne(selected)}
                  className="px-3 py-2 text-xs bg-banana-500 hover:bg-banana-400 text-dark-900 font-semibold rounded-lg"
                >
                  <Icon name="download" /> 下载
                </button>
              </div>

              <div className="bg-dark-900/40 border border-dark-700 rounded-xl p-3">
                <div className="text-[11px] text-gray-400 mb-2">提示词</div>
                <div className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
                  {selected.prompt || "（无）"}
                </div>
                {selected.prompt && (
                  <div className="mt-3">
                    <button
                      onClick={() => handleCopy(selected.prompt!)}
                      className="px-3 py-2 text-xs bg-dark-700 hover:bg-dark-600 text-gray-200 border border-dark-600 rounded-lg"
                    >
                      <Icon name="copy" /> 复制提示词
                    </button>
                  </div>
                )}
              </div>

              <div className="bg-dark-900/40 border border-dark-700 rounded-xl p-3">
                <div className="text-[11px] text-gray-400 mb-2">标签（逗号分隔）</div>
                <input
                  value={(tagMap[selected.id] || []).join(", ")}
                  onChange={(e) =>
                    setTagsFor(
                      selected.id,
                      e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean)
                    )
                  }
                  className="w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-banana-500"
                  placeholder="例如：电商, 白底, 发圈"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
