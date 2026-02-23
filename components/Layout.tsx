import React, { useState } from 'react';
import { NavRail } from './NavRail';

interface LayoutProps {
  children: React.ReactNode;
  propertyPanel?: React.ReactNode;
  navView: string;
  onNavChange: (view: string) => void;
  // NavRail props passed through
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

export const Layout: React.FC<LayoutProps> = ({
  children,
  propertyPanel,
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
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  return (
    <div className="flex h-screen bg-dark-900 overflow-hidden font-sans">
      {/* Mobile Overlay */}
      <div
        className={`fixed inset-0 bg-black/50 z-20 lg:hidden transition-opacity ${isMobileNavOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setIsMobileNavOpen(false)}
      />

      {/* NavRail — fixed left */}
      <div className={`fixed inset-y-0 left-0 z-30 flex transform transition-transform duration-300 lg:translate-x-0 lg:static ${isMobileNavOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <NavRail
          navView={navView}
          onNavChange={(view) => {
            onNavChange(view);
            if (window.innerWidth < 1024) setIsMobileNavOpen(false);
          }}
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelectSession={(id) => {
            onSelectSession(id);
            if (window.innerWidth < 1024) setIsMobileNavOpen(false);
          }}
          onNewSession={() => {
            onNewSession();
            if (window.innerWidth < 1024) setIsMobileNavOpen(false);
          }}
          onDeleteSession={onDeleteSession}
          authUser={authUser}
          onLogout={onLogout}
          onOpenSettings={onOpenSettings}
          assetCount={assetCount}
          modelCount={modelCount}
          productCount={productCount}
          isSuperAdmin={isSuperAdmin}
        />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full min-h-0 min-w-0 relative">
        {/* Mobile top bar */}
        <div className="lg:hidden h-14 border-b border-dark-700 flex items-center px-4 justify-between bg-dark-800 shrink-0">
          <button onClick={() => setIsMobileNavOpen(true)} className="text-gray-400 hover:text-gray-200">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="5" x2="17" y2="5" />
              <line x1="3" y1="10" x2="17" y2="10" />
              <line x1="3" y1="15" x2="17" y2="15" />
            </svg>
          </button>
          <span className="font-semibold text-gray-200 truncate max-w-[200px] text-sm">TopSeller</span>
          <button
            onClick={onLogout}
            className="text-[11px] px-2 py-1 rounded border border-dark-600 bg-dark-800 text-gray-300"
          >
            退出
          </button>
        </div>

        {/* Content + PropertyPanel row */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Center content */}
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            {children}
          </div>

          {/* Property Panel — right side, desktop only */}
          {propertyPanel && (
            <div className="hidden lg:flex w-[300px] shrink-0 border-l border-dark-700 bg-dark-900 flex-col h-full overflow-hidden">
              {propertyPanel}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
