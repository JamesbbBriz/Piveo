import React from 'react';
import { Session } from '../types';
import { Icon } from './Icon';
import { CreativeSettingsSidebar } from './CreativeSettingsSidebar';
import { SessionSettings } from "../types";
import { ApiConfig } from '../services/apiConfig';
import { ModelSwitcherFooter } from './ModelSwitcherFooter';

interface SidebarProps {
  sessions: Session[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string, e: React.MouseEvent) => void;
  isOpen: boolean;
  toggleSidebar: () => void;
  apiConfig: ApiConfig;
  onUpdateApiConfig: (cfg: ApiConfig) => void;
  onOpenAssets: () => void;
  assetCount: number;
  currentSettings: SessionSettings;
  onUpdateCurrentSettings: (next: SessionSettings) => void;
  balanceRefreshTick: number;
}

const SidebarInner: React.FC<SidebarProps> = ({
  sessions,
  currentSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  isOpen,
  toggleSidebar,
  apiConfig,
  onUpdateApiConfig,
  onOpenAssets,
  assetCount,
  currentSettings,
  onUpdateCurrentSettings,
  balanceRefreshTick,
}) => {
  return (
    <>
      {/* Mobile Overlay */}
      <div 
        className={`fixed inset-0 bg-black/50 z-20 lg:hidden transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={toggleSidebar}
      />

      {/* Sidebar Content */}
      <div className={`fixed inset-y-0 left-0 z-30 w-60 bg-dark-800 border-r border-dark-700 transform transition-transform duration-300 lg:translate-x-0 lg:static ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="px-3.5 py-2.5 border-b border-dark-700 flex items-center justify-between">
            <h1 className="text-[18px] font-bold text-banana-400 flex items-center gap-1.5">
              <Icon name="bolt" />
              <span>TopSeller 图销冠</span>
            </h1>
            <button onClick={toggleSidebar} className="lg:hidden text-gray-400">
              <Icon name="times" />
            </button>
          </div>

          <div className="flex-1 min-h-0 flex flex-col">
            {/* Fixed Top Controls */}
            <div className="px-3 py-2.5 border-b border-dark-700/60">
              <button
                onClick={() => {
                  onNewSession();
                  if (window.innerWidth < 1024) toggleSidebar();
                }}
                className="w-full h-9 flex items-center justify-center gap-1.5 bg-banana-500 hover:bg-banana-400 text-dark-900 font-semibold text-[14px] px-3 rounded-lg transition-colors"
              >
                <Icon name="plus" /> 新建项目
              </button>
              <button
                onClick={() => {
                  onOpenAssets();
                  if (window.innerWidth < 1024) toggleSidebar();
                }}
                className="w-full mt-1.5 h-9 flex items-center justify-center gap-1.5 bg-dark-700 hover:bg-dark-600 text-gray-200 border border-dark-600 font-semibold text-[14px] px-3 rounded-lg transition-colors"
                title="打开全局素材库"
              >
                <Icon name="images" /> 素材库
                <span className="text-[10px] bg-dark-900/60 px-2 py-0.5 rounded text-gray-300">{assetCount}</span>
              </button>
            </div>

            <div className="shrink-0 border-b border-dark-700/60">
              <CreativeSettingsSidebar
                settings={currentSettings}
                onUpdateSettings={onUpdateCurrentSettings}
              />
            </div>

            {/* Only history scrolls */}
            <div className="flex-1 min-h-0 px-2 pb-2 pt-1.5 flex flex-col">
              <h2 className="text-xs font-semibold text-gray-500 tracking-wider px-2 mb-2 shrink-0">历史</h2>
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-1 pr-1">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`group flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${
                      session.id === currentSessionId
                        ? 'bg-dark-700 text-white'
                        : 'text-gray-400 hover:bg-dark-700/50 hover:text-gray-200'
                    }`}
                    onClick={() => {
                      onSelectSession(session.id);
                      if (window.innerWidth < 1024) toggleSidebar();
                    }}
                  >
                    <div className="flex items-center gap-2.5 overflow-hidden">
                      <Icon name="image" className="text-[13px] opacity-70" />
                      <span className="truncate text-[14px]">{session.title}</span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm("确定要删除此会话吗？所有聊天记录和图片将无法恢复。")) {
                          onDeleteSession(session.id, e);
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-opacity p-1"
                    >
                      <Icon name="trash-alt" />
                    </button>
                  </div>
                ))}
                {sessions.length === 0 && (
                  <div className="text-center text-gray-600 py-8 text-sm">
                    暂无历史记录
                  </div>
                )}
              </div>
            </div>
          </div>

          <ModelSwitcherFooter apiConfig={apiConfig} onUpdateApiConfig={onUpdateApiConfig} refreshTick={balanceRefreshTick} hasActiveFeature={currentSettings.selectedModelId !== null || currentSettings.autoUseLastImage} />
        </div>
      </div>
    </>
  );
};

export const Sidebar = React.memo(SidebarInner, (prev, next) =>
  prev.sessions === next.sessions &&
  prev.currentSessionId === next.currentSessionId &&
  prev.isOpen === next.isOpen &&
  prev.apiConfig === next.apiConfig &&
  prev.assetCount === next.assetCount &&
  prev.currentSettings === next.currentSettings &&
  prev.balanceRefreshTick === next.balanceRefreshTick
);
