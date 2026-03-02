import React from 'react';
import { Icon } from '@/components/Icon';
import { Tabs } from '@/components/application/tabs/tabs';
import { SCENE_OPTIONS } from './config';
import type { PiveoScene } from './types';

interface SceneSelectorProps {
  scene: PiveoScene;
  onChange: (scene: PiveoScene) => void;
}

export const SceneSelector: React.FC<SceneSelectorProps> = ({ scene, onChange }) => {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-[var(--piveo-text)]">1. Scene</h2>
      <Tabs selectedKey={scene} onSelectionChange={(k) => onChange(String(k) as PiveoScene)}>
        <Tabs.List
          items={SCENE_OPTIONS}
          type="button-border"
          size="sm"
          className="overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-1"
        >
          {(option) => (
            <Tabs.Item id={option.id} textValue={option.label} className="snap-start !min-w-[220px] !p-0">
              <div className="w-full rounded-lg border border-[var(--piveo-border)] bg-[var(--piveo-card)] p-3 text-left">
                <div className="flex items-center gap-2 text-[var(--piveo-text)]">
                  <Icon name={option.icon} className="text-sm" />
                  <span className="font-medium">{option.label}</span>
                </div>
                <p className="mt-1 text-xs text-[var(--piveo-body)]">{option.hint}</p>
              </div>
            </Tabs.Item>
          )}
        </Tabs.List>
      </Tabs>
    </section>
  );
};
