import React from 'react';
import { Badge } from '@/components/base/badges/badges';
import { Button } from '@/components/base/buttons/button';
import { Tabs } from '@/components/application/tabs/tabs';
import type { BrandKit } from '@/types';

interface BrandKitSelectorProps {
  brandKits: BrandKit[];
  activeBrandKitId: string | null;
  onSelect: (id: string | null) => void;
  onOpenManager?: () => void;
}

export const BrandKitSelector: React.FC<BrandKitSelectorProps> = ({
  brandKits,
  activeBrandKitId,
  onSelect,
  onOpenManager,
}) => {
  const items = [{ id: 'off', label: 'Off' }, ...brandKits.map((kit) => ({ id: kit.id, label: kit.name }))];

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-[var(--piveo-text)]">BrandKit</h2>
          {activeBrandKitId && <Badge type="pill-color" size="sm" color="brand">Active</Badge>}
        </div>
        <Button type="button" size="sm" color="secondary" onClick={onOpenManager}>
          Manage
        </Button>
      </div>
      <Tabs selectedKey={activeBrandKitId || 'off'} onSelectionChange={(k) => onSelect(k === 'off' ? null : String(k))}>
        <Tabs.List
          items={items}
          type="button-gray"
          size="sm"
          className="overflow-x-auto scrollbar-hide gap-2 p-0 bg-transparent ring-0"
        >
          {(item) => (
            <Tabs.Item
              id={item.id}
              textValue={item.label}
              className="!h-8 !rounded-full border border-[var(--piveo-border)] bg-[#E7ECF3] px-3 py-1 text-xs font-medium"
            >
              {item.label}
            </Tabs.Item>
          )}
        </Tabs.List>
      </Tabs>
      <p className="text-xs text-[var(--piveo-muted)]">默认启用当前激活 BrandKit；可随时关闭，避免品牌约束影响创作自由。</p>
    </section>
  );
};
