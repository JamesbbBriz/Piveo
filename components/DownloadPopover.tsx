import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Icon } from './Icon';
import type { DownloadFormat, DownloadOptions } from '../services/imageDownload';
import { loadDownloadOptions, saveDownloadOptions, downloadImageWithFormat } from '../services/imageDownload';
import { useToast } from './Toast';

const REMEMBER_KEY = 'topseller_download_remember_v1';

const loadRemember = (): boolean => {
  try {
    return localStorage.getItem(REMEMBER_KEY) === '1';
  } catch {
    return false;
  }
};

const saveRemember = (v: boolean) => {
  try {
    localStorage.setItem(REMEMBER_KEY, v ? '1' : '0');
  } catch { /* ignore */ }
};

interface DownloadPopoverProps {
  imageUrl: string;
  basename?: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

const FORMATS: { key: DownloadFormat; label: string }[] = [
  { key: 'png', label: 'PNG' },
  { key: 'jpg', label: 'JPG' },
  { key: 'webp', label: 'WebP' },
];

export const DownloadPopover: React.FC<DownloadPopoverProps> = ({
  imageUrl,
  basename,
  anchorRef,
  onClose,
}) => {
  const [options, setOptions] = useState<DownloadOptions>(loadDownloadOptions);
  const [remember, setRemember] = useState(loadRemember);
  const [downloading, setDownloading] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const { addToast } = useToast();

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, anchorRef]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      if (remember) {
        saveDownloadOptions(options);
        saveRemember(true);
      }
      await downloadImageWithFormat(imageUrl, {
        basename,
        format: options.format,
        quality: options.quality,
      });
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast({ type: 'error', message: `下载失败：${msg}` });
    } finally {
      setDownloading(false);
    }
  }, [imageUrl, basename, options, remember, onClose]);

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-full left-0 mb-2 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-30 w-[220px]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-2.5 border-b border-zinc-700 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-zinc-200">下载设置</span>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200 text-[10px]">
          <Icon name="times" />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Format selection */}
        <div>
          <div className="text-[10px] text-zinc-400 mb-1.5">格式</div>
          <div className="flex gap-1.5">
            {FORMATS.map((f) => (
              <button
                key={f.key}
                onClick={() => setOptions((prev) => ({ ...prev, format: f.key }))}
                className={`flex-1 h-7 rounded-md border text-[10px] font-semibold transition-colors ${
                  options.format === f.key
                    ? 'border-banana-500 bg-banana-500/10 text-banana-400'
                    : 'border-zinc-600 bg-zinc-900 text-zinc-300 hover:border-zinc-500'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Quality slider (not for PNG) */}
        {options.format !== 'png' && (
          <div>
            <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1">
              <span>质量</span>
              <span className="text-zinc-200 font-semibold">{options.quality}</span>
            </div>
            <input
              type="range"
              min={70}
              max={100}
              value={options.quality}
              onChange={(e) => setOptions((prev) => ({ ...prev, quality: Number(e.target.value) }))}
              className="w-full accent-banana-500"
            />
          </div>
        )}

        {/* Remember checkbox */}
        <label className="flex items-center gap-2 cursor-pointer" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => {
              const v = e.target.checked;
              setRemember(v);
              if (v) {
                saveDownloadOptions(options);
                saveRemember(true);
              } else {
                saveRemember(false);
              }
            }}
            className="h-3.5 w-3.5 accent-banana-500"
          />
          <span className="text-[10px] text-zinc-300">记住我的选择</span>
        </label>
      </div>

      <div className="px-3 pb-3">
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="w-full h-8 rounded-md border border-banana-500 bg-banana-500 text-dark-900 text-[11px] font-semibold hover:bg-banana-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {downloading ? (
            <>
              <Icon name="spinner" className="fa-spin text-[10px]" />
              下载中...
            </>
          ) : (
            <>
              <Icon name="download" className="text-[10px]" />
              下载
            </>
          )}
        </button>
      </div>
    </div>
  );
};

/**
 * Hook to handle download with "remember" preference.
 * Returns { triggerDownload, popoverProps } — if remember is on, triggerDownload downloads directly.
 * Otherwise it opens the popover.
 */
export function useDownloadPopover() {
  const [popoverTarget, setPopoverTarget] = useState<{
    imageUrl: string;
    basename?: string;
  } | null>(null);
  const { addToast } = useToast();

  const triggerDownload = useCallback(async (imageUrl: string, basename?: string) => {
    const remembered = loadRemember();
    if (remembered) {
      try {
        const opts = loadDownloadOptions();
        await downloadImageWithFormat(imageUrl, {
          basename,
          format: opts.format,
          quality: opts.quality,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        addToast({ type: 'error', message: `下载失败：${msg}` });
      }
    } else {
      setPopoverTarget({ imageUrl, basename });
    }
  }, [addToast]);

  const closePopover = useCallback(() => {
    setPopoverTarget(null);
  }, []);

  return { popoverTarget, triggerDownload, closePopover };
}
