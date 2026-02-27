import React, { useState, useEffect } from 'react';
import { Session } from '../types';
import { Icon } from './Icon';
import { SessionSettings } from "../types";
import { ApiConfig } from '../services/apiConfig';
import { ModelSwitcherFooter } from './ModelSwitcherFooter';
import { SettingsPanel, DefaultPreferences } from './SettingsPanel';

const PANEL_STORAGE_KEY = 'sidebar-panel-open';

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
  onOpenModelsLibrary: () => void;
  onOpenProductsLibrary: () => void;
  assetCount: number;
  modelCount: number;
  productCount: number;
  batchJobCount: number;
  authUser: string | null;
  authLoading: boolean;
  onLogout: () => void;
  currentSettings: SessionSettings;
  onUpdateCurrentSettings: (next: SessionSettings) => void;
  balanceRefreshTick: number;
  currentView: "chat" | "batch";
  onViewChange: (view: "chat" | "batch") => void;
  defaultPreferences: DefaultPreferences;
  onUpdateDefaultPreferences: (prefs: DefaultPreferences) => void;
}

/* ── Icon Rail Button ── */
const RailBtn: React.FC<{
  icon: string;
  label: string;
  active?: boolean;
  badge?: number;
  onClick?: () => void;
  className?: string;
}> = ({ icon, label, active, badge, onClick, className }) => (
  <button
    onClick={onClick}
    className={`relative w-full px-1 py-1.5 flex flex-col items-center gap-0.5 rounded-lg transition-colors
      ${active
        ? "bg-banana-500/20 text-banana-400"
        : "text-gray-400 hover:text-gray-200 hover:bg-dark-700/60"
      } ${className ?? ""}`}
    title={label}
  >
    <Icon name={icon} className="text-[14px]" />
    <span className="text-[9px] leading-tight">{label}</span>
    {badge != null && badge > 0 && (
      <span className="absolute top-0.5 right-0.5 min-w-[14px] h-3.5 px-0.5 flex items-center justify-center text-[8px] font-semibold bg-banana-500 text-dark-900 rounded-full">
        {badge}
      </span>
    )}
  </button>
);

const RailDivider = () => <div className="w-full my-0.5 border-t border-dark-600" />;

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
  onOpenModelsLibrary,
  onOpenProductsLibrary,
  assetCount,
  modelCount,
  productCount,
  batchJobCount,
  authUser,
  authLoading,
  onLogout,
  currentSettings,
  onUpdateCurrentSettings,
  balanceRefreshTick,
  currentView,
  onViewChange,
  defaultPreferences,
  onUpdateDefaultPreferences,
}) => {
  const [panelOpen, setPanelOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(PANEL_STORAGE_KEY);
      return stored !== null ? stored === 'true' : true;
    } catch { return true; }
  });

  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(PANEL_STORAGE_KEY, String(panelOpen)); } catch {}
  }, [panelOpen]);

  const closeMobile = () => { if (window.innerWidth < 1024) toggleSidebar(); };

  /* ── Icon Rail ── */
  const rail = (
    <div className="w-20 shrink-0 flex flex-col items-center bg-dark-800 border-r border-dark-700 py-2 px-1.5 gap-0.5">
      {/* Brand */}
      <div className="w-full flex flex-col items-center py-1 mb-0.5 text-banana-400">
        <Icon name="bolt" className="text-lg" />
      </div>

      {/* New Session */}
      <RailBtn
        icon="plus"
        label="新建项目"
        onClick={() => { onNewSession(); closeMobile(); }}
        className="text-banana-400 hover:text-banana-300"
      />

      <RailDivider />

      {/* Chat */}
      <RailBtn
        icon="comments"
        label="聊天创作"
        active={currentView === "chat"}
        onClick={() => { onViewChange("chat"); closeMobile(); }}
      />

      {/* Batch */}
      <RailBtn
        icon="layer-group"
        label="矩阵工作台"
        active={currentView === "batch"}
        badge={batchJobCount}
        onClick={() => { onViewChange("batch"); closeMobile(); }}
      />

      <RailDivider />

      {/* Assets */}
      <RailBtn icon="images" label="素材库" badge={assetCount} onClick={() => { onOpenAssets(); closeMobile(); }} />
      {/* Models Library */}
      <RailBtn icon="users" label="模特库" badge={modelCount} onClick={() => { onOpenModelsLibrary(); closeMobile(); }} />
      {/* Products Library */}
      <RailBtn icon="cube" label="产品库" badge={productCount} onClick={() => { onOpenProductsLibrary(); closeMobile(); }} />

      <RailDivider />

      {/* History toggle */}
      <RailBtn
        icon="clock-rotate-left"
        label="历史记录"
        active={panelOpen}
        onClick={() => setPanelOpen((v) => !v)}
      />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Compact model/balance (always visible in rail) */}
      <RailDivider />
      <ModelSwitcherFooter
        compact
        apiConfig={apiConfig}
        onUpdateApiConfig={onUpdateApiConfig}
        refreshTick={balanceRefreshTick}
        hasActiveFeature={currentSettings.selectedModelId !== null || currentSettings.autoUseLastImage}
        authUser={authUser}
        authLoading={authLoading}
        onLogout={onLogout}
      />

      {/* User icon → open settings */}
      <RailDivider />
      <button
        onClick={() => setSettingsOpen(true)}
        className="w-full px-1 py-1.5 flex flex-col items-center gap-0.5 text-gray-400 hover:text-gray-200 rounded-lg hover:bg-dark-700/60 transition-colors"
        title={authUser || "用户"}
      >
        <Icon name="user" className="text-[14px]" />
        <span className="text-[9px] leading-tight truncate w-full text-center">{authUser || "用户"}</span>
      </button>
    </div>
  );

  /* ── Panel (history) ── */
  const panel = panelOpen && (
    <div className="w-[200px] shrink-0 flex flex-col bg-dark-800 border-r border-dark-700">
      {/* Panel header */}
      <div className="px-3 py-2.5 border-b border-dark-700 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-400 tracking-wider">历史记录</span>
        <button
          onClick={() => setPanelOpen(false)}
          className="text-gray-500 hover:text-gray-300 transition-colors p-0.5"
          title="收起面板"
        >
          <Icon name="chevron-left" className="text-xs" />
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-2 py-1.5 space-y-0.5">
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`group flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${
              session.id === currentSessionId
                ? 'bg-dark-700 text-white'
                : 'text-gray-400 hover:bg-dark-700/50 hover:text-gray-200'
            }`}
            onClick={() => { onSelectSession(session.id); closeMobile(); }}
          >
            <div className="flex items-center gap-2 overflow-hidden">
              <Icon name="image" className="text-[12px] opacity-70 shrink-0" />
              <span className="truncate text-[13px]">{session.title}</span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm("确定要删除此会话吗？所有聊天记录和图片将无法恢复。")) {
                  onDeleteSession(session.id, e);
                }
              }}
              className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-opacity p-0.5 shrink-0"
            >
              <Icon name="trash-alt" className="text-[11px]" />
            </button>
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="text-center text-gray-600 py-8 text-[12px]">
            暂无历史记录
          </div>
        )}
      </div>

    </div>
  );

  return (
    <>
      {/* Mobile Overlay */}
      <div
        className={`fixed inset-0 bg-black/50 z-20 lg:hidden transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={toggleSidebar}
      />

      {/* Sidebar Container */}
      <div className={`fixed inset-y-0 left-0 z-30 flex transform transition-transform duration-300 lg:translate-x-0 lg:static ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {rail}
        {panel}
      </div>

      {/* Settings Panel */}
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        apiConfig={apiConfig}
        onUpdateApiConfig={onUpdateApiConfig}
        hasActiveFeature={currentSettings.selectedModelId !== null || currentSettings.autoUseLastImage}
        authUser={authUser}
        authLoading={authLoading}
        onLogout={onLogout}
        defaultPreferences={defaultPreferences}
        onUpdateDefaultPreferences={onUpdateDefaultPreferences}
        balanceRefreshTick={balanceRefreshTick}
      />
    </>
  );
};

export const Sidebar = React.memo(SidebarInner, (prev, next) =>
  prev.sessions === next.sessions &&
  prev.currentSessionId === next.currentSessionId &&
  prev.isOpen === next.isOpen &&
  prev.apiConfig === next.apiConfig &&
  prev.assetCount === next.assetCount &&
  prev.modelCount === next.modelCount &&
  prev.productCount === next.productCount &&
  prev.batchJobCount === next.batchJobCount &&
  prev.authUser === next.authUser &&
  prev.authLoading === next.authLoading &&
  prev.currentSettings === next.currentSettings &&
  prev.currentView === next.currentView &&
  prev.balanceRefreshTick === next.balanceRefreshTick &&
  prev.defaultPreferences === next.defaultPreferences
);
