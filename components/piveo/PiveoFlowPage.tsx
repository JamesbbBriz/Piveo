import React, { useMemo, useState } from 'react';
import { getSupportedSizeForAspect } from '@/services/sizeUtils';
import type { AspectRatio, BrandKit } from '@/types';
import { processUploadFile } from '@/services/uploadPipeline';
import { generateMediaSet } from '@/services/mediaPipeline';
import { PiveoNavbar } from './PiveoNavbar';
import { SceneSelector } from './SceneSelector';
import { UploadZone } from './UploadZone';
import { StyleSelector } from './StyleSelector';
import { GenerateCta } from './GenerateCta';
import { ResultGrid } from './ResultGrid';
import { BrandKitSelector } from './BrandKitSelector';
import { STYLE_LIBRARY } from './config';
import type { GeneratedMediaImage, GeneratedMediaVideo, ProcessedUpload, PiveoScene } from './types';

interface PiveoFlowPageProps {
  model: string;
  aspectRatio: AspectRatio | string;
  systemPrompt?: string;
  brandKits: BrandKit[];
  activeBrandKit: BrandKit | null;
  onActivateBrandKit: (id: string | null) => void;
  onOpenBrandKitManager?: () => void;
  onOpenSettings?: () => void;
}

export const PiveoFlowPage: React.FC<PiveoFlowPageProps> = ({
  model,
  aspectRatio,
  systemPrompt,
  brandKits,
  activeBrandKit,
  onActivateBrandKit,
  onOpenBrandKitManager,
  onOpenSettings,
}) => {
  const [scene, setScene] = useState<PiveoScene>('product');
  const [upload, setUpload] = useState<ProcessedUpload | null>(null);
  const [selectedStyleIds, setSelectedStyleIds] = useState<string[]>(['studio-clean']);
  const [images, setImages] = useState<GeneratedMediaImage[]>([]);
  const [video, setVideo] = useState<GeneratedMediaVideo | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressText, setProgressText] = useState<string>('');

  const selectedStyles = useMemo(
    () => STYLE_LIBRARY.filter((style) => selectedStyleIds.includes(style.id) && style.sceneCompat.includes(scene)),
    [selectedStyleIds, scene]
  );

  const canGenerate = Boolean(upload?.previewUrl) && selectedStyles.length > 0 && !generating;

  const toggleStyle = (styleId: string) => {
    setSelectedStyleIds((prev) => {
      const next = prev.includes(styleId) ? prev.filter((id) => id !== styleId) : [...prev, styleId];
      return next;
    });
  };

  const handleUpload = async (file: File) => {
    setError(null);
    try {
      const processed = await processUploadFile(file);
      setUpload(processed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setError(msg);
    }
  };

  const handleGenerate = async () => {
    if (!canGenerate || !upload) return;
    setGenerating(true);
    setError(null);
    setProgressText('Preparing generation...');

    try {
      const result = await generateMediaSet(
        {
          scene,
          uploadedImage: upload.previewUrl,
          styles: selectedStyles,
          activeBrandKit,
          model,
          size: getSupportedSizeForAspect(aspectRatio, model),
          systemPrompt,
        },
        (phase, current, total) => {
          if (phase === 'images') {
            setProgressText(`Generating images ${current}/${total}`);
          } else {
            setProgressText('Generating first-frame video...');
          }
        }
      );

      setImages(result.images);
      setVideo(result.video);
      setProgressText('Completed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Generation failed';
      setError(msg);
      setProgressText('');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="h-full bg-[var(--piveo-bg)] text-[var(--piveo-text)] overflow-y-auto">
      <PiveoNavbar onOpenSettings={onOpenSettings} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="rounded-xl bg-[var(--piveo-card)] border border-[var(--piveo-border)] p-4 sm:p-6 space-y-5">
          <SceneSelector scene={scene} onChange={setScene} />
          <UploadZone value={upload} onFileSelect={handleUpload} disabled={generating} />
          <StyleSelector scene={scene} selectedStyleIds={selectedStyleIds} onToggle={toggleStyle} />
          <BrandKitSelector
            brandKits={brandKits}
            activeBrandKitId={activeBrandKit?.id || null}
            onSelect={onActivateBrandKit}
            onOpenManager={onOpenBrandKitManager}
          />
          <GenerateCta onClick={handleGenerate} disabled={!canGenerate} loading={generating} />
          {progressText && <p className="text-xs text-[var(--piveo-body)]">{progressText}</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <ResultGrid images={images} video={video} loading={generating} />
      </div>
    </div>
  );
};
