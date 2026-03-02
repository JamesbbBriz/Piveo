import React from 'react';
import { Button } from '@/components/base/buttons/button';

interface PiveoNavbarProps {
  onOpenSettings?: () => void;
}

export const PiveoNavbar: React.FC<PiveoNavbarProps> = ({ onOpenSettings }) => {
  return (
    <header className="h-16 border-b border-[var(--piveo-border)] bg-white px-4 sm:px-6 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-[var(--piveo-accent)] text-white flex items-center justify-center text-sm font-semibold">P</div>
        <div>
          <h1 className="text-[15px] font-semibold text-[var(--piveo-text)]">Piveo</h1>
          <p className="text-[11px] text-[var(--piveo-muted)]">Single Image to Set + Video</p>
        </div>
      </div>
      <Button type="button" color="secondary" size="sm" onClick={onOpenSettings}>
        Settings
      </Button>
    </header>
  );
};
