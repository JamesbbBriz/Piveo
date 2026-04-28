import React from 'react';
import { Icon } from './Icon';

// 附件模型：id 由调用方分配，url 可以是 data URL 或 http(s) URL
export interface Attachment {
  id: string;
  url: string;
  filename?: string;
}

export interface NumberedAttachmentsStripProps {
  attachments: Attachment[];
  onRemove: (id: string) => void;
  onReorder?: (fromIdx: number, toIdx: number) => void;
  onInsertRef?: (idx: number) => void;
  maxCount?: number;
  className?: string;
}

const DEFAULT_MAX = 6;

export const NumberedAttachmentsStrip: React.FC<NumberedAttachmentsStripProps> = ({
  attachments,
  onRemove,
  onReorder,
  onInsertRef,
  maxCount = DEFAULT_MAX,
  className = '',
}) => {
  if (!attachments || attachments.length === 0) return null;

  // 超过上限的情况只是防御性提示，真正的裁剪在 caller 层
  if (attachments.length > maxCount) {
    // eslint-disable-next-line no-console
    console.warn(
      `[NumberedAttachmentsStrip] attachments (${attachments.length}) exceeds maxCount (${maxCount}); extras will not be rendered.`
    );
  }

  const visible = attachments.slice(0, maxCount);

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, idx: number) => {
    if (!onReorder) return;
    e.dataTransfer.setData('text/plain', String(idx));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!onReorder) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, toIdx: number) => {
    if (!onReorder) return;
    e.preventDefault();
    const raw = e.dataTransfer.getData('text/plain');
    const fromIdx = Number(raw);
    if (!Number.isInteger(fromIdx) || fromIdx === toIdx) return;
    onReorder(fromIdx, toIdx);
  };

  return (
    <div
      className={`flex items-center gap-2 flex-wrap ${className}`}
      role="list"
      aria-label="已附加的参考图"
    >
      {visible.map((att, idx) => {
        const displayNum = idx + 1;
        const refLabel = `@图${displayNum}`;
        return (
          <div
            key={att.id}
            role="listitem"
            draggable={!!onReorder}
            onDragStart={(e) => handleDragStart(e, idx)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, idx)}
            className="group relative w-16 h-16 rounded-lg overflow-hidden ring-1 ring-[var(--piveo-border)] bg-white shadow-sm"
          >
            <img
              src={att.url}
              alt={att.filename || `参考图 ${displayNum}`}
              className="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
              decoding="async"
              draggable={false}
            />

            {/* 左上角编号徽标：点击插入 @图N 引用 */}
            <button
              type="button"
              onClick={() => onInsertRef?.(idx)}
              disabled={!onInsertRef}
              title={onInsertRef ? `插入 ${refLabel}` : refLabel}
              aria-label={onInsertRef ? `插入 ${refLabel}` : `${refLabel}`}
              className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-[var(--piveo-text)] text-white flex items-center justify-center text-sm font-semibold leading-none shadow-sm transition-transform ${
                onInsertRef ? 'cursor-pointer hover:scale-110 hover:bg-[var(--piveo-accent-hover)]' : 'cursor-default'
              }`}
            >
              {displayNum}
            </button>

            {/* 右上角删除按钮：hover 时显现避免桌面端误点；触控设备无 hover，永久显示。
                P1-#14：之前 opacity-0 group-hover:opacity-100 让 iPad 用户根本删不掉附件，
                因为 thumbnail 的点击被 onInsertRef 占用了，没法触发 hover。 */}
            <button
              type="button"
              onClick={() => onRemove(att.id)}
              title="移除此参考图"
              aria-label={`移除参考图 ${displayNum}`}
              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] leading-none shadow-sm md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 transition-opacity hover:bg-red-600"
            >
              <Icon name="times" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
