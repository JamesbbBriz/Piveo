import React from 'react';
import { STYLE_LIBRARY } from './config';
import type { PiveoScene } from './types';

interface StyleSelectorProps {
  scene: PiveoScene;
  selectedStyleIds: string[];
  onToggle: (styleId: string) => void;
}

export const StyleSelector: React.FC<StyleSelectorProps> = ({ scene, selectedStyleIds, onToggle }) => {
  const visibleStyles = STYLE_LIBRARY.filter((style) => style.sceneCompat.includes(scene));

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-[var(--piveo-text)]">3. Style</h2>
      <div className="flex gap-3 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-1">
        {visibleStyles.map((style) => {
          const active = selectedStyleIds.includes(style.id);
          return (
            <button
              key={style.id}
              type="button"
              onClick={() => onToggle(style.id)}
              className={`snap-start w-[170px] shrink-0 rounded-xl border overflow-hidden transition-all duration-200 piveo-spring-soft ${
                active
                  ? 'border-[var(--piveo-accent)] ring-1 ring-[var(--piveo-accent)] scale-[1.03]'
                  : 'border-[var(--piveo-border)] hover:scale-[1.01]'
              }`}
            >
              <div className="h-24 bg-[var(--piveo-card)]">
                <img src={style.thumbnail} alt={style.name} className="h-full w-full object-cover" loading="lazy" decoding="async" />
              </div>
              <div className={`px-3 py-2 text-xs text-left ${active ? 'bg-[#E7ECF3]' : 'bg-white'}`}>
                <p className="font-medium text-[var(--piveo-text)]">{style.name}</p>
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-[var(--piveo-muted)]">已选择 {selectedStyleIds.length} 个风格，将生成 {selectedStyleIds.length || 0} 张图 + 1 个视频。</p>
    </section>
  );
};
