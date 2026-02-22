import React, { useState, useRef, useEffect } from 'react';
import { useTeam } from '../store/AppContext';
import { SET_CURRENT_TEAM_ID } from '../store/actions';
import { Icon } from './Icon';

interface TeamSwitcherProps {
  onManageTeams?: () => void;
}

export const TeamSwitcher: React.FC<TeamSwitcherProps> = ({ onManageTeams }) => {
  const { teams, currentTeamId, dispatch } = useTeam();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const currentTeam = currentTeamId
    ? teams.find((t) => t.id === currentTeamId)
    : null;
  const displayName = currentTeam ? currentTeam.name : '个人空间';

  return (
    <div className="relative w-full px-1" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full h-7 rounded-md border border-dark-600 bg-dark-800/70 flex items-center justify-center gap-1 text-[9px] text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors"
        title={displayName}
      >
        <Icon name="users" className="text-[10px]" />
        <Icon name={open ? "chevron-up" : "chevron-down"} className="text-[8px]" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-44 bg-dark-700 border border-dark-600 rounded-lg shadow-xl z-50 py-1">
          {/* Personal Space */}
          <button
            onClick={() => {
              dispatch({ type: SET_CURRENT_TEAM_ID, payload: null });
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-2 text-[11px] rounded-md transition-colors ${
              currentTeamId === null
                ? 'text-banana-400 bg-banana-500/10'
                : 'text-gray-300 hover:bg-dark-600'
            }`}
          >
            <div className="flex items-center gap-2">
              {currentTeamId === null ? (
                <Icon name="check" className="text-[9px] text-banana-400" />
              ) : (
                <span className="w-[9px]" />
              )}
              <Icon name="user" className="text-[10px]" />
              <span>个人空间</span>
            </div>
          </button>

          {teams.length > 0 && (
            <div className="border-t border-dark-600 my-1" />
          )}

          {/* Team list */}
          {teams.map((team) => (
            <button
              key={team.id}
              onClick={() => {
                dispatch({ type: SET_CURRENT_TEAM_ID, payload: team.id });
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-[11px] rounded-md transition-colors ${
                currentTeamId === team.id
                  ? 'text-banana-400 bg-banana-500/10'
                  : 'text-gray-300 hover:bg-dark-600'
              }`}
            >
              <div className="flex items-center gap-2">
                {currentTeamId === team.id ? (
                  <Icon name="check" className="text-[9px] text-banana-400" />
                ) : (
                  <span className="w-[9px]" />
                )}
                <Icon name="users" className="text-[10px]" />
                <span className="truncate">{team.name}</span>
              </div>
            </button>
          ))}

          {teams.length === 0 && (
            <div className="px-3 py-2 text-[10px] text-gray-500">
              暂无团队
            </div>
          )}

          {/* Manage teams link */}
          {onManageTeams && (
            <>
              <div className="border-t border-dark-600 my-1" />
              <button
                onClick={() => {
                  onManageTeams();
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-[10px] text-gray-400 hover:text-gray-200 hover:bg-dark-600 rounded-md transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Icon name="gear" className="text-[9px]" />
                  <span>管理团队</span>
                </div>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
