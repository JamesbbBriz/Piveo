import React, { useState, useCallback } from 'react';
import { Icon } from './Icon';
import type { Team } from '../types';

export interface TeamManagerProps {
  teams: Team[];
  currentTeamId: string | null;
  onCreateTeam: (name: string) => void;
  onDeleteTeam: (teamId: string) => void;
  onUpdateTeam: (teamId: string, name: string) => void;
  onAddMember: (teamId: string, username: string) => void;
  onRemoveMember: (teamId: string, userId: string) => void;
  onSwitchTeam: (teamId: string | null) => void;
}

const TeamCard: React.FC<{
  team: Team;
  isCurrent: boolean;
  onDelete: () => void;
  onUpdate: (name: string) => void;
  onAddMember: (username: string) => void;
  onRemoveMember: (userId: string) => void;
  onSwitch: () => void;
}> = ({ team, isCurrent, onDelete, onUpdate, onAddMember, onRemoveMember, onSwitch }) => {
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(team.name);
  const [memberInput, setMemberInput] = useState('');

  const handleSaveName = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== team.name) {
      onUpdate(trimmed);
    }
    setIsEditing(false);
  }, [editName, team.name, onUpdate]);

  const handleAddMember = useCallback(() => {
    const trimmed = memberInput.trim();
    if (trimmed) {
      onAddMember(trimmed);
      setMemberInput('');
    }
  }, [memberInput, onAddMember]);

  return (
    <div
      className={`rounded-xl border transition-all ${
        isCurrent
          ? 'border-banana-500/50 bg-banana-500/5'
          : 'border-zinc-700 bg-zinc-900'
      }`}
    >
      {/* Team header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
            isCurrent ? 'bg-banana-500/20 text-banana-400' : 'bg-zinc-800 text-zinc-400'
          }`}>
            <Icon name="users" className="text-sm" />
          </div>
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div className="flex items-center gap-2">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={handleSaveName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveName();
                    if (e.key === 'Escape') { setEditName(team.name); setIsEditing(false); }
                  }}
                  autoFocus
                  className="flex-1 h-7 px-2 rounded bg-zinc-800 border border-zinc-600 text-[12px] text-zinc-200 focus:outline-none focus:border-banana-500/50"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-zinc-200 truncate">{team.name}</span>
                {isCurrent && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-banana-500/20 text-banana-400 shrink-0">
                    当前
                  </span>
                )}
              </div>
            )}
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-[10px] text-zinc-500">
                <Icon name="user" className="mr-0.5" />
                {team.members.length} 成员
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!isCurrent && (
            <button
              onClick={onSwitch}
              className="px-2 py-1 rounded-md text-[10px] border border-zinc-700 text-zinc-400 hover:text-banana-400 hover:border-banana-500/40 transition-colors"
              title="切换到此团队"
            >
              切换
            </button>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <Icon name={expanded ? 'chevron-up' : 'chevron-down'} className="text-[10px]" />
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-zinc-800 pt-3 space-y-3">
          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setEditName(team.name); setIsEditing(true); }}
              className="px-2.5 py-1.5 rounded-md text-[10px] border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
              <Icon name="pen" className="mr-1 text-[9px]" />
              重命名
            </button>
            <button
              onClick={() => {
                if (window.confirm(`确定要删除团队「${team.name}」吗？此操作不可撤销。`)) {
                  onDelete();
                }
              }}
              className="px-2.5 py-1.5 rounded-md text-[10px] border border-zinc-700 text-red-400/70 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/5 transition-colors"
            >
              <Icon name="trash-alt" className="mr-1 text-[9px]" />
              删除团队
            </button>
          </div>

          {/* Members */}
          <div>
            <h4 className="text-[11px] font-medium text-zinc-400 mb-2">成员列表</h4>
            {team.members.length === 0 ? (
              <p className="text-[11px] text-zinc-600 py-2">暂无成员</p>
            ) : (
              <div className="space-y-1">
                {team.members.map((member) => (
                  <div
                    key={member.userId}
                    className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-zinc-800/50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center">
                        <Icon name="user" className="text-[9px] text-zinc-500" />
                      </div>
                      <span className="text-[11px] text-zinc-300">
                        {member.displayName || member.username}
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                        member.role === 'admin'
                          ? 'bg-amber-500/15 text-amber-400'
                          : 'bg-zinc-800 text-zinc-500'
                      }`}>
                        {member.role === 'admin' ? '管理员' : '成员'}
                      </span>
                    </div>
                    <button
                      onClick={() => onRemoveMember(member.userId)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400 transition-all text-[10px]"
                      title="移除成员"
                    >
                      <Icon name="times" className="text-[9px]" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add member */}
          <div className="flex items-center gap-2">
            <input
              value={memberInput}
              onChange={(e) => setMemberInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddMember();
              }}
              placeholder="输入用户名..."
              className="flex-1 h-8 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
            />
            <button
              onClick={handleAddMember}
              disabled={!memberInput.trim()}
              className="px-3 h-8 rounded-lg bg-banana-500 text-dark-900 text-[11px] font-medium hover:bg-banana-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              邀请
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const TeamManager: React.FC<TeamManagerProps> = ({
  teams,
  currentTeamId,
  onCreateTeam,
  onDeleteTeam,
  onUpdateTeam,
  onAddMember,
  onRemoveMember,
  onSwitchTeam,
}) => {
  const [newTeamName, setNewTeamName] = useState('');

  const handleCreate = useCallback(() => {
    const trimmed = newTeamName.trim();
    if (trimmed) {
      onCreateTeam(trimmed);
      setNewTeamName('');
    }
  }, [newTeamName, onCreateTeam]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-200 mb-3">团队管理</h2>

        {/* Create team */}
        <div className="flex items-center gap-2">
          <input
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
            placeholder="新团队名称..."
            className="flex-1 h-8 px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-[11px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
          />
          <button
            onClick={handleCreate}
            disabled={!newTeamName.trim()}
            className="px-4 h-8 rounded-lg bg-banana-500 text-dark-900 text-[11px] font-semibold hover:bg-banana-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Icon name="plus" className="mr-1 text-[9px]" />
            创建
          </button>
        </div>
      </div>

      {/* Team list */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
        {/* Personal space card */}
        <div
          className={`rounded-xl border px-4 py-3 cursor-pointer transition-all ${
            currentTeamId === null
              ? 'border-banana-500/50 bg-banana-500/5'
              : 'border-zinc-700 bg-zinc-900 hover:border-zinc-500'
          }`}
          onClick={() => onSwitchTeam(null)}
        >
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              currentTeamId === null ? 'bg-banana-500/20 text-banana-400' : 'bg-zinc-800 text-zinc-400'
            }`}>
              <Icon name="user" className="text-sm" />
            </div>
            <div>
              <span className="text-[13px] font-medium text-zinc-200">个人空间</span>
              {currentTeamId === null && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-banana-500/20 text-banana-400 ml-2">
                  当前
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Teams */}
        {teams.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            isCurrent={team.id === currentTeamId}
            onDelete={() => onDeleteTeam(team.id)}
            onUpdate={(name) => onUpdateTeam(team.id, name)}
            onAddMember={(username) => onAddMember(team.id, username)}
            onRemoveMember={(userId) => onRemoveMember(team.id, userId)}
            onSwitch={() => onSwitchTeam(team.id)}
          />
        ))}

        {/* Empty state */}
        {teams.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
            <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center mb-3">
              <Icon name="users" className="text-xl opacity-30" />
            </div>
            <p className="text-[12px] mb-1">还没有团队</p>
            <p className="text-[10px] text-zinc-600">创建一个团队，邀请成员一起协作</p>
          </div>
        )}
      </div>
    </div>
  );
};
