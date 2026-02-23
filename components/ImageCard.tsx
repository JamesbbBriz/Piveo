import React, { useState, useRef, useEffect } from 'react';
import { Icon } from './Icon';
import type { GeneratedImage } from '../types';

export interface ImageCardProps {
  image: GeneratedImage;
  isSelected?: boolean;
  isMultiSelect?: boolean;
  isChecked?: boolean;
  onClick: () => void;
  onCheck?: (checked: boolean) => void;
  onAction: (action: string) => void;
}

const toThumbUrl = (url: string | undefined): string | undefined => {
  if (!url) return url;
  // Only rewrite server blob URLs to use thumbnail endpoint
  const m = /^\/api\/data\/blobs\/([a-f0-9-]+)$/i.exec(url);
  if (m) return `${url}/thumb`;
  return url;
};

export const ImageCard: React.FC<ImageCardProps> = ({
  image,
  isSelected = false,
  isMultiSelect = false,
  isChecked = false,
  onClick,
  onCheck,
  onAction,
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  const promptExcerpt = image.prompt
    ? image.prompt.length > 60
      ? image.prompt.slice(0, 60) + '...'
      : image.prompt
    : '(无提示词)';

  const sourceLabel = image.source === 'batch' ? '套图'
    : image.source === 'mask-edit' ? '局部编辑'
    : image.source === 'variation' ? '变体'
    : image.source === 'refine' ? '优化'
    : '单张';

  return (
    <div
      className={`group relative bg-zinc-900 rounded-xl border overflow-hidden cursor-pointer transition-all duration-200 ${
        isSelected
          ? 'border-blue-500 ring-2 ring-blue-500/30'
          : 'border-zinc-700 hover:border-zinc-500'
      } hover:scale-[1.02]`}
      onClick={onClick}
    >
      {/* Multi-select checkbox */}
      {isMultiSelect && (
        <div className="absolute top-2 right-2 z-10" onClick={(e) => e.stopPropagation()}>
          <label className="flex items-center justify-center w-5 h-5 rounded border border-zinc-500 bg-zinc-800/80 cursor-pointer hover:border-zinc-300 transition-colors">
            <input
              type="checkbox"
              checked={isChecked}
              onChange={(e) => onCheck?.(e.target.checked)}
              className="sr-only"
            />
            {isChecked && (
              <Icon name="check" className="text-[10px] text-blue-400" />
            )}
          </label>
        </div>
      )}

      {/* Image thumbnail */}
      <div className="aspect-square bg-zinc-950 relative overflow-hidden">
        {image.imageUrl ? (
          <img
            src={toThumbUrl(image.imageUrl) || image.imageUrl}
            alt={promptExcerpt}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Icon name="image" className="text-3xl text-zinc-700" />
          </div>
        )}
      </div>

      {/* Info bar */}
      <div className="px-2.5 py-2 space-y-1">
        <p className="text-[11px] text-zinc-300 leading-tight line-clamp-2">{promptExcerpt}</p>
        <div className="flex items-center gap-1.5 flex-wrap">
          {image.model && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
              {image.model.length > 20 ? image.model.slice(0, 20) + '...' : image.model}
            </span>
          )}
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
            {sourceLabel}
          </span>
          {image.size && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
              {image.size}
            </span>
          )}
        </div>
      </div>

      {/* Action bar — always visible at bottom */}
      <div className="flex items-center justify-between px-2 py-1.5 border-t border-zinc-800 bg-zinc-900/80">
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onAction('download'); }}
            className="p-1.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center"
            title="下载"
          >
            <Icon name="download" className="text-[11px]" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onAction('preview'); }}
            className="p-1.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center"
            title="预览"
          >
            <Icon name="eye" className="text-[11px]" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onAction('mask-edit'); }}
            className="p-1.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center"
            title="局部编辑"
          >
            <Icon name="paint-brush" className="text-[11px]" />
          </button>
        </div>

        {/* Context menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
            className="p-1.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center"
            title="更多操作"
          >
            <Icon name="ellipsis-h" className="text-[11px]" />
          </button>
          {showMenu && (
            <div className="absolute bottom-full right-0 mb-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 min-w-[140px] z-20">
              <button
                onClick={(e) => { e.stopPropagation(); onAction('set-reference'); setShowMenu(false); }}
                className="w-full text-left px-3 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-700 transition-colors flex items-center gap-2"
              >
                <Icon name="crosshairs" className="text-[10px] text-zinc-500 w-3" />
                设为参考图
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onAction('variation'); setShowMenu(false); }}
                className="w-full text-left px-3 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-700 transition-colors flex items-center gap-2"
              >
                <Icon name="clone" className="text-[10px] text-zinc-500 w-3" />
                创建变体
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onAction('copy-prompt'); setShowMenu(false); }}
                className="w-full text-left px-3 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-700 transition-colors flex items-center gap-2"
              >
                <Icon name="copy" className="text-[10px] text-zinc-500 w-3" />
                复制提示词
              </button>
              <div className="border-t border-zinc-700 my-1" />
              <button
                onClick={(e) => { e.stopPropagation(); onAction('delete'); setShowMenu(false); }}
                className="w-full text-left px-3 py-1.5 text-[11px] text-red-400 hover:bg-zinc-700 transition-colors flex items-center gap-2"
              >
                <Icon name="trash-alt" className="text-[10px] text-red-500 w-3" />
                删除
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/** Skeleton placeholder during generation */
export const ImageCardSkeleton: React.FC = () => (
  <div className="bg-zinc-900 rounded-xl border border-zinc-700 overflow-hidden animate-pulse">
    <div className="aspect-square bg-zinc-800" />
    <div className="px-2.5 py-2 space-y-2">
      <div className="h-3 bg-zinc-800 rounded w-3/4" />
      <div className="h-2.5 bg-zinc-800 rounded w-1/2" />
    </div>
    <div className="px-2 py-1.5 border-t border-zinc-800">
      <div className="h-3 bg-zinc-800 rounded w-1/3" />
    </div>
  </div>
);
