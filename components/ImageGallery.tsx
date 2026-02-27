import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import { Icon } from './Icon';
import { ImageCard, ImageCardSkeleton } from './ImageCard';
import { Onboarding, type OnboardingProps } from './Onboarding';
import { fetchImageBlob, blobToFormat, loadDownloadOptions } from '../services/imageDownload';
import type { GeneratedImage } from '../types';

export interface ImageGalleryProps {
  images: GeneratedImage[];
  onImageClick: (image: GeneratedImage) => void;
  onImageAction: (image: GeneratedImage, action: string) => void;
  selectedImageId?: string;
  isGenerating?: boolean;
  batchProgress?: Record<string, { current: number; total: number; status: string }>;
  onboardingProps?: OnboardingProps;
  onOpenBatchSet?: () => void;
  onGoToBatch?: () => void;
}

export const ImageGallery: React.FC<ImageGalleryProps> = ({
  images,
  onImageClick,
  onImageAction,
  selectedImageId,
  isGenerating = false,
  batchProgress,
  onboardingProps,
  onOpenBatchSet,
  onGoToBatch,
}) => {
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [isZipping, setIsZipping] = useState(false);
  const [filterTab, setFilterTab] = useState<'all' | 'single'>('all');
  const containerRef = useRef<HTMLDivElement>(null);

  // Sort images by createdAt descending (newest first)
  const sortedImages = useMemo(() => {
    const filtered = filterTab === 'single'
      ? images.filter((img) => img.source !== 'batch')
      : images;
    return [...filtered].sort((a, b) => b.createdAt - a.createdAt);
  }, [images, filterTab]);

  // Find the selected image object
  const selectedImage = useMemo(() => {
    if (!selectedImageId) return null;
    return images.find((img) => img.id === selectedImageId) || null;
  }, [images, selectedImageId]);

  const handleCheck = useCallback((id: string, checked: boolean) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleMultiSelect = useCallback(() => {
    setIsMultiSelect((v) => !v);
    setCheckedIds(new Set());
  }, []);

  // Batch ZIP download
  const handleBatchDownload = useCallback(async () => {
    const selected = sortedImages.filter((img) => checkedIds.has(img.id));
    if (selected.length === 0) return;

    // Single image — just download directly
    if (selected.length === 1) {
      onImageAction(selected[0], 'download');
      return;
    }

    setIsZipping(true);
    try {
      const zip = new JSZip();
      const opts = loadDownloadOptions();
      const ext = opts.format === 'png' ? 'png' : opts.format === 'webp' ? 'webp' : 'jpg';

      await Promise.all(
        selected.map(async (img, idx) => {
          if (!img.imageUrl) return;
          try {
            const srcBlob = await fetchImageBlob(img.imageUrl);
            const outBlob = await blobToFormat(srcBlob, opts.format, opts.quality);
            const promptSlug = (img.prompt || 'image')
              .slice(0, 30)
              .replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_')
              .replace(/_+/g, '_')
              .replace(/^_|_$/g, '');
            const filename = `${String(idx + 1).padStart(2, '0')}_${promptSlug}_${img.id.slice(0, 6)}.${ext}`;
            zip.file(filename, outBlob);
          } catch (err) {
            console.error(`Failed to add image ${img.id} to ZIP:`, err);
          }
        })
      );

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `topseller-${selected.length}images-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('ZIP download failed:', err);
    } finally {
      setIsZipping(false);
    }
  }, [sortedImages, checkedIds, onImageAction]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only handle when gallery is focused (not in input/textarea)
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (!selectedImage) return;

      // Escape → deselect
      if (e.key === 'Escape') {
        // Fire a deselect by clicking on a null image
        onImageAction(selectedImage, 'deselect');
        return;
      }

      // Delete / Backspace → delete (with confirm)
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onImageAction(selectedImage, 'delete');
        return;
      }

      const isMod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl + C → copy prompt
      if (isMod && e.key === 'c') {
        // Only intercept if no text is selected in the page
        const selection = window.getSelection();
        if (selection && selection.toString().length > 0) return;
        e.preventDefault();
        onImageAction(selectedImage, 'copy-prompt');
        return;
      }

      // Cmd/Ctrl + D → download
      if (isMod && e.key === 'd') {
        e.preventDefault();
        onImageAction(selectedImage, 'download');
        return;
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectedImage, onImageAction]);

  const hasBatchProgress = batchProgress && Object.keys(batchProgress).length > 0;
  const checkedCount = checkedIds.size;

  return (
    <div ref={containerRef} className="flex flex-col h-full min-h-0 relative">
      {/* Header bar */}
      <div className="shrink-0 px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between gap-3">
        {/* Tabs */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setFilterTab('all')}
            className={`px-3 py-1 rounded-md text-[11px] font-medium border transition-colors ${
              filterTab === 'all'
                ? 'bg-banana-500/15 text-banana-400 border-banana-500/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border-transparent'
            }`}
          >
            全部
          </button>
          <button
            onClick={() => setFilterTab('single')}
            className={`px-3 py-1 rounded-md text-[11px] font-medium border transition-colors ${
              filterTab === 'single'
                ? 'bg-banana-500/15 text-banana-400 border-banana-500/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border-transparent'
            }`}
          >
            单图
          </button>
          {onGoToBatch && (
            <button
              onClick={onGoToBatch}
              className="px-3 py-1 rounded-md text-[11px] font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-transparent transition-colors"
            >
              矩阵
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500">{sortedImages.length} 张图片</span>
          <button
            onClick={toggleMultiSelect}
            className={`px-2 py-1 rounded-md text-[10px] border transition-colors ${
              isMultiSelect
                ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                : 'border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
            }`}
          >
            <Icon name="check-square" className="mr-1" />
            {isMultiSelect ? '退出选择' : '多选'}
          </button>
        </div>
      </div>

      {/* Batch progress inline */}
      {hasBatchProgress && (
        <div className="shrink-0 px-4 py-2 border-b border-zinc-800 bg-zinc-900/50">
          {Object.entries(batchProgress!).map(([key, prog]) => (
            <div key={key} className="flex items-center gap-2 text-[11px]">
              <Icon name="spinner" className="fa-spin text-banana-400" />
              <span className="text-zinc-300">
                正在生成 {prog.current}/{prog.total}
              </span>
              <span className="text-zinc-500">{prog.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* Gallery grid */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        {sortedImages.length === 0 && !isGenerating ? (
          onboardingProps ? (
            <Onboarding {...onboardingProps} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500 opacity-60">
              <Icon name="images" className="text-5xl mb-4" />
              <p className="text-sm">暂无图片</p>
              <p className="text-xs mt-1 text-zinc-600">在下方输入提示词，开始创作</p>
            </div>
          )
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
            {/* Generation skeleton */}
            {isGenerating && <ImageCardSkeleton />}
            {sortedImages.map((image) => (
              <ImageCard
                key={image.id}
                image={image}
                isSelected={image.id === selectedImageId}
                isMultiSelect={isMultiSelect}
                isChecked={checkedIds.has(image.id)}
                onClick={() => onImageClick(image)}
                onCheck={(checked) => handleCheck(image.id, checked)}
                onAction={(action) => onImageAction(image, action)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Floating multi-select action bar */}
      {isMultiSelect && checkedCount > 0 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2.5 bg-zinc-800 border border-zinc-600 rounded-xl shadow-2xl z-20">
          <span className="text-[11px] text-zinc-300 whitespace-nowrap">
            已选择 <span className="text-banana-400 font-semibold">{checkedCount}</span> 张图片
          </span>
          <button
            onClick={() => void handleBatchDownload()}
            disabled={isZipping}
            className="px-3 py-1.5 rounded-md text-[11px] border border-banana-500 bg-banana-500 text-dark-900 font-semibold hover:bg-banana-400 transition-colors disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
          >
            {isZipping ? (
              <>
                <Icon name="spinner" className="fa-spin text-[10px]" />
                打包中...
              </>
            ) : (
              <>
                <Icon name="file-archive" className="text-[10px]" />
                下载 ZIP
              </>
            )}
          </button>
          <button
            onClick={toggleMultiSelect}
            className="px-2.5 py-1.5 rounded-md text-[11px] border border-zinc-600 text-zinc-300 hover:bg-zinc-700 transition-colors whitespace-nowrap"
          >
            取消
          </button>
        </div>
      )}
    </div>
  );
};
