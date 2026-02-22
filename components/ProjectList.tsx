import React, { useState, useMemo } from 'react';
import { Icon } from './Icon';
import type { Session } from '../types';

export interface ProjectListProps {
  projects: Session[];
  currentProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onCreateProject: () => void;
  onDeleteProject: (projectId: string, e: React.MouseEvent) => void;
  currentTeamId: string | null;
}

/** Count image parts in a session's messages */
const countSessionImages = (session: Session): number => {
  let count = 0;
  for (const msg of session.messages) {
    for (const part of msg.parts) {
      if (part.type === 'image' && part.imageUrl) count++;
    }
  }
  return count;
};

/** Get the last image URL from a session for the thumbnail */
const getSessionThumbnail = (session: Session): string | null => {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const msg = session.messages[i];
    for (let j = msg.parts.length - 1; j >= 0; j--) {
      const part = msg.parts[j];
      if (part.type === 'image' && part.imageUrl) return part.imageUrl;
    }
  }
  return null;
};

const formatTimeAgo = (timestamp: number): string => {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(timestamp).toLocaleDateString();
};

export const ProjectList: React.FC<ProjectListProps> = ({
  projects,
  currentProjectId,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  currentTeamId,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects;
    const q = searchQuery.toLowerCase();
    return projects.filter((p) => p.title.toLowerCase().includes(q));
  }, [projects, searchQuery]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-zinc-200">项目列表</h2>
          <span className="text-[10px] text-zinc-500">{projects.length} 个项目</span>
        </div>
        {/* Search */}
        <div className="relative">
          <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 text-[11px]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索项目..."
            className="w-full h-8 pl-8 pr-3 rounded-lg bg-zinc-900 border border-zinc-700 text-[11px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
          />
        </div>
      </div>

      {/* Project grid */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {/* New Project card */}
          <button
            onClick={onCreateProject}
            className="group flex flex-col items-center justify-center h-[200px] bg-zinc-900 border-2 border-dashed border-zinc-700 rounded-xl hover:border-banana-500/50 hover:bg-zinc-900/80 transition-all"
          >
            <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center mb-2 group-hover:bg-banana-500/10 transition-colors">
              <Icon name="plus" className="text-zinc-400 group-hover:text-banana-400 transition-colors" />
            </div>
            <span className="text-[12px] text-zinc-400 group-hover:text-banana-400 transition-colors">新建项目</span>
          </button>

          {/* Project cards */}
          {filteredProjects.map((project) => {
            const thumbnail = getSessionThumbnail(project);
            const imageCount = countSessionImages(project);
            const isActive = project.id === currentProjectId;

            return (
              <div
                key={project.id}
                onClick={() => onSelectProject(project.id)}
                className={`group relative bg-zinc-900 rounded-xl border overflow-hidden cursor-pointer transition-all ${
                  isActive
                    ? 'border-banana-500 ring-1 ring-banana-500/30'
                    : 'border-zinc-700 hover:border-zinc-500'
                }`}
              >
                {/* Thumbnail */}
                <div className="h-[120px] bg-zinc-950 relative overflow-hidden">
                  {thumbnail ? (
                    <img
                      src={thumbnail}
                      alt={project.title}
                      className="absolute inset-0 w-full h-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Icon name="image" className="text-3xl text-zinc-800" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-medium text-zinc-200 truncate">{project.title}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm('确定要删除此项目吗？所有记录和图片将无法恢复。')) {
                          onDeleteProject(project.id, e);
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400 transition-all"
                      title="删除项目"
                    >
                      <Icon name="trash-alt" className="text-[10px]" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-zinc-500">
                      <Icon name="image" className="mr-0.5" />{imageCount} 张
                    </span>
                    <span className="text-[10px] text-zinc-600">{formatTimeAgo(project.updatedAt)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Empty state: search no results */}
        {filteredProjects.length === 0 && searchQuery && (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
            <Icon name="search" className="text-3xl mb-3 opacity-30" />
            <p className="text-sm">没有找到匹配的项目</p>
            <button
              onClick={() => setSearchQuery('')}
              className="mt-3 px-3 py-1.5 rounded-lg text-[11px] border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
              清除搜索
            </button>
          </div>
        )}

        {/* Empty state: no projects at all */}
        {projects.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
            <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center mb-4">
              <Icon name="th-large" className="text-2xl opacity-30" />
            </div>
            <p className="text-sm mb-1">
              {currentTeamId ? '该团队还没有项目' : '还没有项目'}
            </p>
            <p className="text-[11px] text-zinc-600 mb-4">
              {currentTeamId ? '在团队空间创建第一个项目' : '开始创建你的第一个项目吧'}
            </p>
            <button
              onClick={onCreateProject}
              className="px-4 py-2 rounded-lg bg-banana-500 text-dark-900 text-[12px] font-semibold hover:bg-banana-400 transition-colors"
            >
              <Icon name="plus" className="mr-1.5 text-[10px]" />
              创建第一个项目
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
