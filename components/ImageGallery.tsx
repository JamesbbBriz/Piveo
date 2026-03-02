import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import { Icon } from './Icon';
import { ImageCard, ImageCardSkeleton } from './ImageCard';
import { Onboarding, type OnboardingProps } from './Onboarding';
import { fetchImageBlob, blobToFormat, loadDownloadOptions } from '../services/imageDownload';
import type { GeneratedImage } from '../types';
import { Button } from '@/components/base/buttons/button';
import { Badge } from '@/components/base/badges/badges';
import { Tabs } from '@/components/application/tabs/tabs';

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
  const filterItems: Array<{ id: 'all' | 'single'; label: string }> = [
    { id: 'all', label: '全部' },
    { id: 'single', label: '单图' },
  ];

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
      a.download = `piveo-${selected.length}-images-${Date.now()}.zip`;
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
      <div className="shrink-0 px-4 py-2.5 border-b border-[var(--piveo-border)] bg-white flex items-center justify-between gap-3">
        {/* Tabs */}
        <div className="flex items-center gap-1 min-w-0">
          <Tabs selectedKey={filterTab} onSelectionChange={(key) => setFilterTab(String(key) as 'all' | 'single')}>
            <Tabs.List
              items={filterItems}
              type="button-gray"
              size="sm"
              className="bg-transparent ring-0 p-0 gap-1 overflow-x-auto scrollbar-hide"
            >
              {(tab) => (
                <Tabs.Item
                  id={tab.id}
                  textValue={tab.label}
                  className="!text-[11px] !px-3 !py-1 !rounded-md !border !border-transparent !text-[var(--piveo-body)] hover:!text-[var(--piveo-text)] hover:!bg-[#EEF2F6]"
                >
                  {tab.label}
                </Tabs.Item>
              )}
            </Tabs.List>
          </Tabs>
          {onGoToBatch && (
            <Button
              type="button"
              color="tertiary"
              size="sm"
              onClick={onGoToBatch}
              className="!text-[11px] !px-3 !py-1 !rounded-md !border !border-transparent !text-[var(--piveo-body)] hover:!text-[var(--piveo-text)] hover:!bg-[#EEF2F6]"
            >
              矩阵
            </Button>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Badge type="pill-color" size="sm" color="gray">
            {sortedImages.length} 张图片
          </Badge>
          <Button
            type="button"
            color={isMultiSelect ? "primary" : "secondary"}
            size="sm"
            onClick={toggleMultiSelect}
            className="!text-[10px] !px-2 !py-1"
          >
            <Icon name="check-square" className="mr-1" />
            {isMultiSelect ? '退出选择' : '多选'}
          </Button>
        </div>
      </div>

      {/* Batch progress inline */}
      {hasBatchProgress && (
        <div className="shrink-0 px-4 py-2 border-b border-[var(--piveo-border)] bg-[var(--piveo-card)]">
          {Object.entries(batchProgress!).map(([key, prog]) => (
            <div key={key} className="flex items-center gap-2 text-[11px]">
              <Icon name="spinner" className="fa-spin text-[var(--piveo-accent)]" />
              <span className="text-[var(--piveo-text)]">
                正在生成 {prog.current}/{prog.total}
              </span>
              <Badge type="pill-color" size="sm" color="warning">
                {prog.status}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {/* Gallery grid */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 bg-[var(--piveo-bg)]">
        {sortedImages.length === 0 && !isGenerating ? (
          onboardingProps ? (
            <Onboarding {...onboardingProps} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-[var(--piveo-body)] opacity-70">
              <Icon name="images" className="text-5xl mb-4" />
              <p className="text-sm">暂无图片</p>
              <p className="text-xs mt-1 text-[var(--piveo-muted)]">在下方输入提示词，开始创作</p>
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
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2.5 bg-white border border-[var(--piveo-border)] rounded-xl shadow-[0_4px_10px_rgba(0,0,0,0.08)] z-20">
          <Badge type="pill-color" size="sm" color="brand">
            已选择 {checkedCount} 张图片
          </Badge>
          <Button
            type="button"
            size="sm"
            color="primary"
            onClick={() => void handleBatchDownload()}
            isDisabled={isZipping}
            isLoading={isZipping}
            className="!text-[11px] !px-3 !py-1.5 whitespace-nowrap"
          >
            {!isZipping && <Icon name="file-archive" className="text-[10px]" />}
            下载 ZIP
          </Button>
          <Button
            type="button"
            size="sm"
            color="secondary"
            onClick={toggleMultiSelect}
            className="!text-[11px] !px-2.5 !py-1.5 whitespace-nowrap"
          >
            取消
          </Button>
        </div>
      )}
    </div>
  );
};
