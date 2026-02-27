import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Icon } from './Icon';
import { sendRefineMessage, type RefineMessage } from '../services/refine';

interface RefinePanelProps {
  imageUrl: string;
  prompt?: string;
  model: string;
  aspectRatio: string;
  systemPrompt?: string;
  onClose: () => void;
  onFinish: (finalImageUrl: string) => void;
}

const REFINE_QUICK_PROMPTS = [
  "背景换成纯白",
  "产品放大 20%",
  "产品缩小 20%",
  "提高画面清晰度",
  "调整光线更自然",
];

export const RefinePanel: React.FC<RefinePanelProps> = ({
  imageUrl,
  prompt,
  model,
  aspectRatio,
  systemPrompt,
  onClose,
  onFinish,
}) => {
  const [messages, setMessages] = useState<RefineMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState(0);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Start with empty messages — the original image will be attached
  // to the first user message so Gemini sees it as user-provided context
  // (Gemini API requires conversations to start with role: "user")
  useEffect(() => {
    setMessages([]);
  }, [imageUrl]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  // Extract all model image versions
  const versions = messages.filter((m) => m.role === 'model' && m.imageUrl);

  // Keep selectedVersion in bounds and default to latest
  useEffect(() => {
    if (versions.length > 0) {
      setSelectedVersion(versions.length - 1);
    }
  }, [versions.length]);

  const currentImage = versions[selectedVersion]?.imageUrl || imageUrl;

  const hasUserMessages = messages.some((m) => m.role === 'user');

  const handleSend = useCallback(async (text?: string) => {
    const msgText = (text || inputText).trim();
    if (!msgText || isGenerating) return;

    // Attach original image to the first user message so the model can see it
    const isFirstMessage = !messages.some((m) => m.role === 'user');
    const userMsg: RefineMessage = {
      role: 'user',
      text: msgText,
      imageUrl: isFirstMessage ? imageUrl : undefined,
    };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInputText('');
    setIsGenerating(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await sendRefineMessage(updatedMessages, {
        model,
        aspectRatio,
        systemPrompt,
      }, controller.signal);

      const modelMsg: RefineMessage = {
        role: 'model',
        imageUrl: result.imageUrl,
        text: result.text,
        _rawContent: result._rawContent,
      };
      setMessages((prev) => [...prev, modelMsg]);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const errorText = err instanceof Error ? err.message : String(err);
      const errorMsg: RefineMessage = {
        role: 'model',
        text: `迭代失败：${errorText}`,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [inputText, isGenerating, messages, model, aspectRatio, systemPrompt, imageUrl]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleFinish = () => {
    // Use the latest version image (or selected)
    onFinish(currentImage);
  };

  return (
    <div className="fixed inset-0 z-50 bg-dark-900 flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-dark-700 flex items-center">
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-200 transition-colors mr-3"
        >
          <Icon name="arrow-left" />
        </button>
        <span className="text-sm font-bold text-gray-200 flex items-center gap-2">
          <Icon name="wand-magic-sparkles" className="text-cyan-400 text-xs" />
          迭代模式
        </span>
        {prompt && (
          <span className="text-[10px] text-gray-500 ml-3 truncate max-w-[200px]" title={prompt}>
            {prompt}
          </span>
        )}
        <div className="ml-auto">
          <button
            onClick={handleFinish}
            className="text-cyan-400 hover:text-cyan-300 text-sm font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Icon name="check" />
            完成
          </button>
        </div>
      </div>

      {/* Main image preview */}
      <div className="flex-1 min-h-0 flex items-center justify-center p-4 bg-dark-950">
        <img
          src={currentImage}
          alt="迭代预览"
          className="max-w-full max-h-full object-contain rounded-lg"
        />
      </div>

      {/* Version timeline */}
      {versions.length > 1 && (
        <div className="px-4 py-2 border-t border-dark-700 flex gap-2 overflow-x-auto">
          {versions.map((v, idx) => (
            <img
              key={idx}
              src={v.imageUrl}
              alt={`v${idx + 1}`}
              onClick={() => setSelectedVersion(idx)}
              className={`w-12 h-12 rounded-md border-2 cursor-pointer object-cover flex-shrink-0 ${
                idx === selectedVersion ? 'border-cyan-500' : 'border-dark-600'
              }`}
            />
          ))}
        </div>
      )}

      {/* Chat history */}
      {messages.length > 0 && (
        <div ref={chatRef} className="px-4 py-2 border-t border-dark-700 max-h-[200px] overflow-y-auto">
          {messages.map((msg, idx) => {
            return (
              <div
                key={idx}
                className={`flex mb-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'user' ? (
                  <div className="bg-dark-700 text-gray-200 text-xs px-3 py-1.5 rounded-lg rounded-tr-none max-w-[80%]">
                    {msg.text}
                  </div>
                ) : (
                  <div className="flex items-start gap-2 max-w-[80%]">
                    {msg.imageUrl && (
                      <img
                        src={msg.imageUrl}
                        alt="迭代结果"
                        className="w-10 h-10 rounded-md object-cover border border-dark-600 flex-shrink-0"
                      />
                    )}
                    {msg.text && (
                      <div className="bg-dark-800 border border-dark-700 text-gray-300 text-xs px-3 py-1.5 rounded-lg rounded-tl-none">
                        {msg.text}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {isGenerating && (
            <div className="flex justify-start mb-2">
              <div className="bg-dark-800 border border-dark-700 text-cyan-400 text-xs px-3 py-1.5 rounded-lg rounded-tl-none">
                <Icon name="spinner" className="fa-spin" /> 迭代中...
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick prompts */}
      {!hasUserMessages && (
        <div className="px-4 py-2 border-t border-dark-700 flex flex-wrap gap-1.5">
          {REFINE_QUICK_PROMPTS.map((qp) => (
            <button
              key={qp}
              onClick={() => void handleSend(qp)}
              disabled={isGenerating}
              className="px-2.5 py-1 text-[11px] bg-dark-800 border border-dark-600 text-gray-300 rounded-full hover:border-cyan-500/50 hover:text-cyan-300 transition-colors disabled:opacity-40"
            >
              {qp}
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="px-4 py-3 border-t border-dark-700 flex gap-2">
        <textarea
          ref={inputRef}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入迭代指令..."
          rows={1}
          className="flex-1 bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 resize-none"
        />
        <button
          onClick={() => void handleSend()}
          disabled={isGenerating || !inputText.trim()}
          className="px-4 py-2 rounded-lg bg-cyan-500 text-dark-900 font-semibold text-sm hover:bg-cyan-400 disabled:opacity-40 transition-colors flex items-center gap-1.5"
        >
          {isGenerating ? (
            <Icon name="spinner" className="fa-spin" />
          ) : (
            <Icon name="paper-plane" />
          )}
        </button>
      </div>
    </div>
  );
};
