import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Icon } from './Icon';

interface BeforeAfterViewProps {
  beforeUrl: string;
  afterUrl: string;
  beforeLabel?: string;
  afterLabel?: string;
  onClose: () => void;
  onExport?: () => void;
}

type ViewMode = 'slider' | 'side-by-side';

export const BeforeAfterView: React.FC<BeforeAfterViewProps> = ({
  beforeUrl,
  afterUrl,
  beforeLabel = '原图',
  afterLabel = '生成',
  onClose,
  onExport,
}) => {
  const [position, setPosition] = useState(50);
  const [mode, setMode] = useState<ViewMode>('slider');
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const getPositionFromEvent = useCallback(
    (clientX: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return position;
      const x = clientX - rect.left;
      return Math.max(0, Math.min(100, (x / rect.width) * 100));
    },
    [position]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (mode !== 'slider') return;
      e.preventDefault();
      setIsDragging(true);
      setPosition(getPositionFromEvent(e.clientX));
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [mode, getPositionFromEvent]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      setPosition(getPositionFromEvent(e.clientX));
    },
    [isDragging, getPositionFromEvent]
  );

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      {/* Header controls */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-3">
        {/* Mode toggle */}
        <button
          onClick={() =>
            setMode((m) => (m === 'slider' ? 'side-by-side' : 'slider'))
          }
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-dark-700/80 text-gray-300 hover:text-white hover:bg-dark-600 transition-colors text-sm"
          title={mode === 'slider' ? '切换到并排模式' : '切换到滑块模式'}
        >
          <Icon
            name={mode === 'slider' ? 'columns' : 'arrows-alt-h'}
            className="text-xs"
          />
          <span>{mode === 'slider' ? '并排' : '滑块'}</span>
        </button>
        {/* Close */}
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-dark-700/80 text-gray-300 hover:text-white hover:bg-dark-600 transition-colors"
        >
          <Icon name="times" />
        </button>
      </div>

      {/* Main content */}
      {mode === 'slider' ? (
        <div
          ref={containerRef}
          className="relative max-h-[80vh] max-w-[90vw] select-none cursor-col-resize overflow-hidden rounded-lg"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {/* Before image (full, underneath) */}
          <img
            src={beforeUrl}
            alt={beforeLabel}
            className="block max-h-[80vh] max-w-[90vw] object-contain"
            draggable={false}
          />

          {/* After image (clipped overlay) */}
          <img
            src={afterUrl}
            alt={afterLabel}
            className="absolute inset-0 w-full h-full object-contain"
            style={{
              clipPath: `inset(0 ${100 - position}% 0 0)`,
            }}
            draggable={false}
          />

          {/* Labels */}
          <span className="absolute top-3 left-3 px-2 py-0.5 rounded bg-black/60 text-white text-sm font-medium pointer-events-none">
            {beforeLabel}
          </span>
          <span className="absolute top-3 right-3 px-2 py-0.5 rounded bg-black/60 text-white text-sm font-medium pointer-events-none">
            {afterLabel}
          </span>

          {/* Divider line */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white/80 pointer-events-none"
            style={{ left: `${position}%`, transform: 'translateX(-50%)' }}
          />

          {/* Drag handle */}
          <div
            className="absolute top-1/2 w-10 h-10 -mt-5 rounded-full bg-white shadow-lg flex items-center justify-center pointer-events-none"
            style={{ left: `${position}%`, transform: 'translateX(-50%)' }}
          >
            <Icon name="arrows-alt-h" className="text-dark-800 text-sm" />
          </div>
        </div>
      ) : (
        /* Side-by-side mode */
        <div className="flex gap-2 max-h-[80vh] max-w-[90vw]">
          <div className="relative flex-1 min-w-0">
            <img
              src={beforeUrl}
              alt={beforeLabel}
              className="block max-h-[80vh] max-w-[45vw] object-contain rounded-lg"
              draggable={false}
            />
            <span className="absolute top-3 left-3 px-2 py-0.5 rounded bg-black/60 text-white text-sm font-medium">
              {beforeLabel}
            </span>
          </div>
          <div className="relative flex-1 min-w-0">
            <img
              src={afterUrl}
              alt={afterLabel}
              className="block max-h-[80vh] max-w-[45vw] object-contain rounded-lg"
              draggable={false}
            />
            <span className="absolute top-3 left-3 px-2 py-0.5 rounded bg-black/60 text-white text-sm font-medium">
              {afterLabel}
            </span>
          </div>
        </div>
      )}

      {/* Export button */}
      {onExport && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
          <button
            onClick={onExport}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-banana-500 hover:bg-banana-400 text-dark-900 font-medium transition-colors text-sm"
          >
            <Icon name="download" className="text-xs" />
            导出对比图
          </button>
        </div>
      )}
    </div>
  );
};
