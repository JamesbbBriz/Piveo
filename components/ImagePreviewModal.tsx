import React from 'react';
import { Icon } from './Icon';
import { DownloadOptionsModal } from './DownloadOptionsModal';
import { downloadImageWithFormat, loadDownloadOptions, saveDownloadOptions } from '../services/imageDownload';
import { useModalA11y } from './useModalA11y';
import { useToast } from './Toast';

interface ImagePreviewModalProps {
  imageUrl: string;
  onClose: () => void;
}

export const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({ imageUrl, onClose }) => {
  const [downloadOptions, setDownloadOptions] = React.useState(loadDownloadOptions);
  const [downloadOpen, setDownloadOpen] = React.useState(false);
  const modalRef = React.useRef<HTMLDivElement>(null);
  const { addToast } = useToast();
  useModalA11y(!downloadOpen, modalRef, onClose);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDownloadOpen(true);
  };

  const confirmDownload = async () => {
    saveDownloadOptions(downloadOptions);
    try {
      await downloadImageWithFormat(imageUrl, {
        basename: `topseller-preview-${Date.now()}`,
        quality: downloadOptions.quality,
      });
      setDownloadOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast({ type: 'error', message: `下载失败：${msg}` });
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <button 
        onClick={onClose}
        className="absolute top-4 right-4 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-full p-3 transition-colors z-10"
      >
        <Icon name="times" className="text-xl" />
      </button>
      
      <div ref={modalRef} tabIndex={-1} className="relative max-w-full max-h-full flex flex-col items-center" onClick={e => e.stopPropagation()}>
         <img 
           src={imageUrl} 
           alt="预览" 
           className="max-w-full max-h-[85vh] object-contain rounded-md shadow-2xl" 
         />
         
         <div className="mt-4 flex gap-4">
           <button
              onClick={handleDownload}
              className="bg-banana-500 hover:bg-banana-400 text-dark-900 font-semibold px-6 py-2 rounded-full flex items-center gap-2 transition-colors shadow-lg"
           >
             <Icon name="download" /> 下载
           </button>
         </div>
      </div>
      <DownloadOptionsModal
        isOpen={downloadOpen}
        options={downloadOptions}
        onChange={setDownloadOptions}
        onCancel={() => setDownloadOpen(false)}
        onConfirm={() => void confirmDownload()}
        title="下载设置"
        confirmLabel="开始下载"
        imageUrl={imageUrl}
      />
    </div>
  );
};
