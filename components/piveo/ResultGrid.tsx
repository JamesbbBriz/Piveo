import React, { useMemo, useState } from 'react';
import JSZip from 'jszip';
import type { GeneratedMediaImage, GeneratedMediaVideo } from './types';
import { downloadImageWithFormat, fetchImageBlob } from '@/services/imageDownload';
import { Button } from '@/components/base/buttons/button';
import { Badge } from '@/components/base/badges/badges';

interface ResultGridProps {
  images: GeneratedMediaImage[];
  video: GeneratedMediaVideo | null;
  loading: boolean;
}

const downloadBlob = (blob: Blob, filename: string) => {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(href);
};

export const ResultGrid: React.FC<ResultGridProps> = ({ images, video, loading }) => {
  const [packing, setPacking] = useState(false);
  const hasResults = images.length > 0 || Boolean(video);
  const sortedImages = useMemo(() => [...images], [images]);

  const downloadZip = async () => {
    if (!hasResults || packing) return;
    setPacking(true);
    try {
      const zip = new JSZip();
      for (let i = 0; i < sortedImages.length; i++) {
        const img = sortedImages[i];
        const blob = await fetchImageBlob(img.url);
        zip.file(`image-${String(i + 1).padStart(2, '0')}-${img.styleId}.webp`, blob);
      }

      if (video?.url) {
        const videoResp = await fetch(video.url);
        const videoBlob = await videoResp.blob();
        zip.file('video-first-frame.webm', videoBlob);
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, `piveo-${sortedImages.length}-images-${Date.now()}.zip`);
    } finally {
      setPacking(false);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--piveo-text)]">Results</h2>
        <Button
          type="button"
          size="sm"
          color="secondary"
          onClick={() => void downloadZip()}
          isDisabled={!hasResults || packing}
          isLoading={packing}
        >
          Download ZIP
        </Button>
      </div>

      {loading && (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="h-48 rounded-xl bg-[#EAECEF] animate-pulse" />
          ))}
        </div>
      )}

      {sortedImages.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-[var(--piveo-body)]">Images</h3>
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            {sortedImages.map((image, idx) => (
              <article
                key={image.id}
                className="rounded-xl bg-[var(--piveo-card)] shadow-[0_1px_2px_0_rgba(0,0,0,0.04)] overflow-hidden border border-[var(--piveo-border)] animate-[fadeIn_.3s_ease_forwards]"
                style={{ animationDelay: `${idx * 90}ms` }}
              >
                <img src={image.url} alt={image.styleName} className="w-full h-48 object-cover" loading="lazy" decoding="async" />
                <div className="p-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-[var(--piveo-text)]">{image.styleName}</p>
                    <p className="text-[11px] text-[var(--piveo-muted)] truncate">{image.styleId}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    color="secondary"
                    onClick={() => void downloadImageWithFormat(image.url, { basename: `piveo-${image.styleId}` })}
                  >
                    Download
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {video && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-[var(--piveo-body)]">Video</h3>
          <article className="rounded-xl bg-[var(--piveo-card)] border border-[var(--piveo-border)] p-3 space-y-2">
            <video
              src={video.url}
              className="w-full h-[320px] bg-black rounded-lg object-cover"
              autoPlay
              loop
              muted
              playsInline
              controls
            />
            <div className="flex items-center justify-between text-xs text-[var(--piveo-body)]">
              <div className="flex items-center gap-2">
                <span>{video.durationSec}s</span>
                {video.fallback && (
                  <Badge type="pill-color" size="sm" color="warning">
                    Fallback motion
                  </Badge>
                )}
              </div>
              <Button href={video.url} download="piveo-first-frame-video.webm" size="sm" color="secondary">
                Download Video
              </Button>
            </div>
          </article>
        </div>
      )}
    </section>
  );
};
