
import React from 'react';
import { Message, MessagePart } from '../types';
import { Icon } from './Icon';

interface ChatMessageProps {
  message: Message;
  onPreviewImage: (url: string) => void;
  onVariation: (type: string, imageUrl: string) => void;
  onCompare?: (beforeUrl: string, afterUrl: string) => void;
  onMaskEdit?: (baseImageUrl: string) => void;
  onUseAsReference?: (imageUrl: string) => void;
}

const ChatMessageInner: React.FC<ChatMessageProps> = ({
  message,
  onPreviewImage,
  onVariation,
  onCompare,
  onMaskEdit,
  onUseAsReference,
}) => {
  const isUser = message.role === 'user';
  // 触控可达：点击图片时 toggle 操作按钮，同时保留桌面端 hover 效果
  const [showActionsIdx, setShowActionsIdx] = React.useState<number | null>(null);

  const downloadImage = (dataUrl: string) => {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `topseller-gen-${Date.now()}.png`; 
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className={`flex w-full mb-6 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[88%] lg:max-w-[78%] gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        
        {/* Avatar */}
        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${isUser ? 'bg-dark-600' : 'bg-banana-500 text-dark-900'}`}>
          <Icon name={isUser ? "user" : "robot"} className="text-sm" />
        </div>

        {/* Content Bubble */}
        <div className={`flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'}`}>
          <div className={`p-4 rounded-2xl shadow-sm ${
            isUser 
              ? 'bg-dark-700 text-white rounded-tr-none' 
              : 'bg-dark-800 border border-dark-700 text-gray-200 rounded-tl-none'
          }`}>
            {message.parts.map((part, idx) => (
              <div key={idx} className="mb-2 last:mb-0">
                {part.type === 'text' && (
                  <p className="whitespace-pre-wrap leading-relaxed text-sm">{part.text}</p>
                )}
                {part.type === 'image' && part.imageUrl && (
                  <div className="relative group mt-2 rounded-lg overflow-hidden border border-dark-600 bg-black/20">
                    <img
                      src={part.imageUrl}
                      alt="图片"
                      onClick={(e) => {
                        // 点击图片 toggle 操作按钮（触控可达），桌面端同时保留 hover
                        e.stopPropagation();
                        setShowActionsIdx(showActionsIdx === idx ? null : idx);
                      }}
                      loading="lazy"
                      decoding="async"
                      className="max-w-full h-auto max-h-[400px] object-contain block cursor-pointer"
                    />

                    {/* Hover + Click Toggle Actions */}
                    <div className={`absolute inset-0 bg-black/40 transition-opacity flex flex-col items-center justify-center gap-3 ${showActionsIdx === idx ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto'}`}>
                      
                      {/* Standard Actions */}
                      <div className="pointer-events-auto flex gap-3">
                        <button 
                          onClick={() => downloadImage(part.imageUrl!)}
                          className="bg-white text-dark-900 p-2 rounded-full hover:bg-banana-400 transition-colors shadow-lg"
                          title="下载"
                        >
                          <Icon name="download" />
                        </button>
                        <button 
                          onClick={() => onPreviewImage(part.imageUrl!)}
                          className="bg-dark-800 text-white p-2 rounded-full hover:bg-dark-600 transition-colors shadow-lg"
                          title="查看原图"
                        >
                           <Icon name="expand" />
                        </button>
                        {!isUser && onMaskEdit && (
                          <button
                            onClick={() => onMaskEdit(part.imageUrl!)}
                            className="bg-dark-800 text-white p-2 rounded-full hover:bg-dark-600 transition-colors shadow-lg"
                            title="局部编辑（遮罩）"
                          >
                            <Icon name="paint-brush" />
                          </button>
                        )}
                        {!isUser && onUseAsReference && (
                          <button
                            onClick={() => onUseAsReference(part.imageUrl!)}
                            className="bg-dark-800 text-white p-2 rounded-full hover:bg-dark-600 transition-colors shadow-lg"
                            title="设为参考图"
                          >
                            <Icon name="image" />
                          </button>
                        )}
                        {!isUser && onCompare && part.meta?.parentImageUrl && (
                          <button
                            onClick={() => onCompare(part.meta!.parentImageUrl!, part.imageUrl!)}
                            className="bg-dark-800 text-white p-2 rounded-full hover:bg-dark-600 transition-colors shadow-lg"
                            title="对比上一版"
                          >
                            <Icon name="columns" />
                          </button>
                        )}
                      </div>

                      {/* AI Variations (Only for model generated images) */}
                      {!isUser && (
                         <div className="pointer-events-auto flex flex-col items-center gap-2 bg-dark-900/90 p-2 rounded-xl border border-dark-600 backdrop-blur-sm mt-2 transform translate-y-4 group-hover:translate-y-0 transition-all">
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-gray-400 px-1 font-bold tracking-wider">角度</span>
                                <button onClick={() => onVariation("远景", part.imageUrl!)} className="text-[10px] text-white hover:text-banana-400 px-2 py-1 rounded hover:bg-dark-700">远景</button>
                                <button onClick={() => onVariation("特写", part.imageUrl!)} className="text-[10px] text-white hover:text-banana-400 px-2 py-1 rounded hover:bg-dark-700">特写</button>
                            </div>
                            <div className="h-px w-full bg-dark-600"></div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-gray-400 px-1 font-bold tracking-wider">产品</span>
                                <button onClick={() => onVariation("缩小产品", part.imageUrl!)} className="text-[10px] text-banana-400 hover:text-banana-300 px-2 py-1 rounded hover:bg-dark-700 flex items-center gap-1">
                                    <Icon name="compress-arrows-alt" /> 缩小
                                </button>
                                <button onClick={() => onVariation("放大产品", part.imageUrl!)} className="text-[10px] text-banana-400 hover:text-banana-300 px-2 py-1 rounded hover:bg-dark-700 flex items-center gap-1">
                                    <Icon name="expand-arrows-alt" /> 放大
                                </button>
                            </div>
                         </div>
                      )}

                    </div>

                    {!isUser && part.meta && (
                      <div className="px-3 py-2 bg-dark-900/70 border-t border-dark-700 flex flex-wrap gap-2 text-[10px] text-gray-400">
                        {part.meta.action && (
                          <span className="px-2 py-0.5 rounded bg-dark-800 border border-dark-600 text-gray-300">
                            {part.meta.action}
                          </span>
                        )}
                        {part.meta.model && (
                          <span className="px-2 py-0.5 rounded bg-dark-800 border border-dark-600">
                            {part.meta.model}
                          </span>
                        )}
                        {part.meta.size && (
                          <span className="px-2 py-0.5 rounded bg-dark-800 border border-dark-600">
                            {part.meta.size}
                          </span>
                        )}
                        {part.meta.parentImageUrl && (
                          <span className="px-2 py-0.5 rounded bg-dark-800 border border-dark-600">
                            可对比上一版
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <span className="text-[10px] text-gray-600 px-1">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

      </div>
    </div>
  );
};

export const ChatMessage = React.memo(ChatMessageInner);
