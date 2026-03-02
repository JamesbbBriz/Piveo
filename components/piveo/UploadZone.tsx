import React, { useRef, useState } from 'react';
import { Button } from '@/components/base/buttons/button';
import type { ProcessedUpload } from './types';

interface UploadZoneProps {
  value: ProcessedUpload | null;
  onFileSelect: (file: File) => void;
  disabled?: boolean;
}

export const UploadZone: React.FC<UploadZoneProps> = ({ value, onFileSelect, disabled = false }) => {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-[var(--piveo-text)]">2. Upload</h2>
      <div
        role="button"
        tabIndex={0}
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        onDrop={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onFileSelect(file);
        }}
        className={`h-44 rounded-xl border border-dashed transition-all duration-200 piveo-spring-soft flex items-center justify-center ${
          dragOver
            ? 'border-[var(--piveo-accent)] bg-[#E7ECF3] scale-[1.01]'
            : value
              ? 'border-[var(--piveo-border)] bg-[var(--piveo-card)]'
              : 'border-[var(--piveo-border)] bg-[var(--piveo-card)] hover:bg-[#FCFCFD]'
        }`}
      >
        {!value ? (
          <div className="text-center px-4">
            <p className="text-sm font-medium text-[var(--piveo-text)]">上传商品 / 模特主图</p>
            <p className="mt-1 text-xs text-[var(--piveo-body)]">Drop your image here or browse</p>
            <div className="mt-3">
              <Button type="button" size="sm" color="secondary" isDisabled={disabled}>
                Browse Image
              </Button>
            </div>
          </div>
        ) : (
          <img src={value.previewUrl} alt="Upload preview" className="h-[160px] max-w-full rounded-lg object-cover shadow-sm" />
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelect(file);
          e.target.value = '';
        }}
      />
    </section>
  );
};
