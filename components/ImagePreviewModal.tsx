import React from 'react';
import { Icon } from './Icon';
import { DownloadOptionsModal } from './DownloadOptionsModal';
import { downloadImageWithFormat, loadDownloadOptions, saveDownloadOptions } from '../services/imageDownload';
import { useModalA11y } from './useModalA11y';
import { useToast } from './Toast';

interface ImagePreviewModalProps {
  imageUrl: string;
  onClose: () => void;
  // P0-#2: 把图片操作搬到预览模态里，避免用户必须先关闭模态才能"设为参考图 / 迭代 / 局部编辑 / 生成矩阵"
  onUseAsReference?: (imageUrl: string) => void;
  onRefine?: (imageUrl: string) => void;
  onMaskEdit?: (imageUrl: string) => void;
  onBatchFromImage?: (imageUrl: string) => void;
}

export const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({
  imageUrl,
  onClose,
  onUseAsReference,
  onRefine,
  onMaskEdit,
  onBatchFromImage,
}) => {
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
        basename: `piveo-preview-${Date.now()}`,
        quality: downloadOptions.quality,
      });
      setDownloadOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast({ type: 'error', message: `下载失败：${msg}` });
    }
  };

  // 选完动作之后顺手关闭模态，进入对应的下一步流程
  const wrapAndClose = (handler?: (url: string) => void) => () => {
    if (!handler) return;
    handler(imageUrl);
    onClose();
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
           className="max-w-full max-h-[80vh] object-contain rounded-md shadow-2xl"
         />

         {/* 完整操作工具栏：下载 + 图片相关动作 */}
         <div className="mt-4 flex gap-2 flex-wrap items-center justify-center">
           <button
              onClick={handleDownload}
              className="bg-banana-500 hover:bg-banana-400 text-dark-900 font-semibold px-5 py-2.5 rounded-full flex items-center gap-2 transition-colors shadow-lg"
           >
             <Icon name="download" /> 下载
           </button>
           {onUseAsReference && (
             <button
               onClick={wrapAndClose(onUseAsReference)}
               className="bg-white/10 hover:bg-white/20 text-white px-4 py-2.5 rounded-full flex items-center gap-2 transition-colors"
               title="设为参考图，回到聊天框继续生成"
             >
               <Icon name="image" /> 设为参考图
             </button>
           )}
           {onRefine && (
             <button
               onClick={wrapAndClose(onRefine)}
               className="bg-cyan-500/80 hover:bg-cyan-500 text-dark-900 font-medium px-4 py-2.5 rounded-full flex items-center gap-2 transition-colors"
               title="基于这张图迭代调整"
             >
               <Icon name="wand-magic-sparkles" /> 迭代
             </button>
           )}
           {onMaskEdit && (
             <button
               onClick={wrapAndClose(onMaskEdit)}
               className="bg-white/10 hover:bg-white/20 text-white px-4 py-2.5 rounded-full flex items-center gap-2 transition-colors"
               title="局部编辑（涂抹遮罩）"
             >
               <Icon name="paint-brush" /> 局部编辑
             </button>
           )}
           {onBatchFromImage && (
             <button
               onClick={wrapAndClose(onBatchFromImage)}
               className="bg-white/10 hover:bg-white/20 text-white px-4 py-2.5 rounded-full flex items-center gap-2 transition-colors"
               title="基于这张图生成矩阵"
             >
               <Icon name="layer-group" /> 生成矩阵
             </button>
           )}
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
