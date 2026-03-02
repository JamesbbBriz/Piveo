import React, { useState, useEffect } from 'react';
import { Icon } from './Icon';
import { TeamSwitcher } from './TeamSwitcher';

const PANEL_STORAGE_KEY = 'navrail-panel-open';

interface NavRailProps {
  navView: string;
  onNavChange: (view: string) => void;
  sessions: { id: string; title: string }[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string, e: React.MouseEvent) => void;
  authUser: string | null;
  onLogout: () => void;
  onOpenSettings: () => void;
  assetCount: number;
  modelCount: number;
  productCount: number;
  isSuperAdmin?: boolean;
}

/* ── Icon Rail Button ── */
const RailBtn: React.FC<{
  icon: string;
  label: string;
  active?: boolean;
  badge?: number;
  onClick?: () => void;
  className?: string;
  svgIcon?: React.ReactNode;
}> = ({ icon, label, active, badge, onClick, className, svgIcon }) => (
  <button
    onClick={onClick}
    className={`relative w-full px-1 py-1.5 flex flex-col items-center gap-0.5 rounded-lg transition-colors
      ${active
        ? "bg-[#E7ECF3] text-[var(--piveo-accent)]"
        : "text-[var(--piveo-body)] hover:text-[var(--piveo-text)] hover:bg-[#E7ECF3]"
      } ${className ?? ""}`}
    title={label}
  >
    {svgIcon || <Icon name={icon} className="text-[14px]" />}
    <span className="text-[9px] leading-tight">{label}</span>
    {badge != null && badge > 0 && (
      <span className="absolute top-0.5 right-0.5 min-w-[14px] h-3.5 px-0.5 flex items-center justify-center text-[8px] font-semibold bg-[var(--piveo-accent)] text-white rounded-full">
        {badge}
      </span>
    )}
  </button>
);

const RailDivider = () => <div className="w-full my-0.5 border-t border-[var(--piveo-border)]" />;

export const NavRail: React.FC<NavRailProps> = ({
  navView,
  onNavChange,
  sessions,
  currentSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  authUser,
  onLogout,
  onOpenSettings,
  assetCount,
  modelCount,
  productCount,
  isSuperAdmin,
}) => {
  const [panelOpen, setPanelOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(PANEL_STORAGE_KEY);
      return stored !== null ? stored === 'true' : false;
    } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(PANEL_STORAGE_KEY, String(panelOpen)); } catch {}
  }, [panelOpen]);

  return (
    <div className="flex h-full">
      {/* Icon Rail */}
      <div className="w-16 shrink-0 flex flex-col items-center bg-white border-r border-[var(--piveo-border)] py-2 px-1.5 gap-0.5">
        {/* Brand */}
        <div className="w-full flex flex-col items-center py-1 mb-0.5 text-[var(--piveo-accent)]">
          <div className="w-7 h-7 rounded-md bg-[var(--piveo-accent)] text-white flex items-center justify-center text-[11px] font-semibold">P</div>
        </div>

        {/* Team Switcher */}
        <div className="w-full py-1 mb-0.5">
          <TeamSwitcher onManageTeams={() => onNavChange('team')} />
        </div>

        <RailDivider />

        {/* New Project */}
        <RailBtn
          icon="plus"
          label="新建项目"
          onClick={onNewSession}
          className="text-[var(--piveo-accent)] hover:text-[var(--piveo-accent-hover)]"
        />

        {/* Project List */}
        <RailBtn
          icon="th-large"
          label="项目列表"
          active={navView === 'projects'}
          onClick={() => onNavChange('projects')}
        />

        <RailDivider />

        {/* Assets */}
        <RailBtn
          icon="images"
          label="素材库"
          badge={assetCount}
          active={navView === 'assets'}
          onClick={() => onNavChange('assets')}
        />

        {/* Models Library */}
        <RailBtn
          icon="users"
          label="模特库"
          badge={modelCount}
          active={navView === 'models'}
          onClick={() => onNavChange('models')}
        />

        {/* Products Library */}
        <RailBtn
          icon="cube"
          label="产品库"
          badge={productCount}
          active={navView === 'products'}
          onClick={() => onNavChange('products')}
        />

        {/* Brand Kit */}
        <RailBtn
          icon="palette"
          label="品牌套件"
          active={navView === 'brandkit'}
          onClick={() => onNavChange('brandkit')}
        />

        <RailDivider />

        {/* History toggle */}
        <RailBtn
          icon="clock-rotate-left"
          label="历史记录"
          active={panelOpen}
          onClick={() => setPanelOpen((v) => !v)}
        />

        {/* Super Admin */}
        {isSuperAdmin && (
          <>
            <RailDivider />
            <RailBtn
              icon="shield-halved"
              label="管理面板"
              active={navView === 'admin'}
              onClick={() => onNavChange('admin')}
            />
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        <RailDivider />

        {/* Settings */}
        <RailBtn
          icon="gear"
          label="设置"
          active={navView === 'settings'}
          onClick={onOpenSettings}
        />

        {/* User → go to settings */}
        <button
          onClick={onOpenSettings}
          className={`w-full px-1 py-1.5 flex flex-col items-center gap-0.5 rounded-lg transition-colors
            ${navView === 'settings'
              ? "bg-[#E7ECF3] text-[var(--piveo-accent)]"
              : "text-[var(--piveo-body)] hover:text-[var(--piveo-text)] hover:bg-[#E7ECF3]"
            }`}
          title={authUser || "用户"}
        >
          <Icon name="user" className="text-[14px]" />
          <span className="text-[9px] leading-tight truncate w-full text-center">{authUser || "用户"}</span>
        </button>
      </div>

      {/* History Panel (collapsible) */}
      {panelOpen && (
        <div className="w-[200px] shrink-0 flex flex-col bg-white border-r border-[var(--piveo-border)]">
          {/* Panel header */}
          <div className="px-3 py-2.5 border-b border-[var(--piveo-border)] flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--piveo-body)] tracking-wider">历史记录</span>
            <button
              onClick={() => setPanelOpen(false)}
              className="text-[var(--piveo-muted)] hover:text-[var(--piveo-text)] transition-colors p-0.5"
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
                    ? 'bg-[#E7ECF3] text-[var(--piveo-text)]'
                    : 'text-[var(--piveo-body)] hover:bg-[#EEF2F6] hover:text-[var(--piveo-text)]'
                }`}
                onClick={() => {
                  onSelectSession(session.id);
                  onNavChange('project');
                }}
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
                  className="opacity-0 group-hover:opacity-100 text-[var(--piveo-muted)] hover:text-red-500 transition-opacity p-0.5 shrink-0"
                >
                  <Icon name="trash-alt" className="text-[11px]" />
                </button>
              </div>
            ))}
            {sessions.length === 0 && (
              <div className="text-center text-[var(--piveo-muted)] py-8 text-[12px]">
                暂无历史记录
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
