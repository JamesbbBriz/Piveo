import React, { useState, useEffect, useCallback } from 'react';
import { Icon } from './Icon';
import { syncService } from '@/services/sync';

type AdminTab = 'users' | 'teams' | 'projects' | 'providers' | 'templates';

interface AdminPanelProps {
  onClose: () => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ onClose }) => {
  const [tab, setTab] = useState<AdminTab>('users');
  const [users, setUsers] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [defaultTemplates, setDefaultTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const loadData = useCallback(async (targetTab: AdminTab) => {
    setLoading(true);
    try {
      switch (targetTab) {
        case 'users': {
          const data = await syncService.fetchAllUsers();
          setUsers(data);
          break;
        }
        case 'teams': {
          const data = await syncService.fetchAllTeams();
          setTeams(data);
          break;
        }
        case 'projects': {
          const data = await syncService.fetchAllProjects();
          setProjects(data);
          break;
        }
        case 'providers': {
          const data = await syncService.fetchProviders();
          setProviders(data);
          break;
        }
        case 'templates': {
          const data = await syncService.fetchAdminDefaultTemplates();
          setDefaultTemplates(data);
          break;
        }
      }
    } catch (e) {
      console.error('[Admin] 加载数据失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData(tab);
  }, [tab, loadData]);

  const handleTabChange = (newTab: AdminTab) => {
    setTab(newTab);
    setSearch('');
  };

  const formatDate = (ts: number | null) => {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const tabs: { key: AdminTab; label: string; icon: string }[] = [
    { key: 'users', label: '用户管理', icon: 'users' },
    { key: 'teams', label: '团队管理', icon: 'people-group' },
    { key: 'projects', label: '项目管理', icon: 'th-large' },
    { key: 'providers', label: '供应商管理', icon: 'server' },
    { key: 'templates', label: '模板管理', icon: 'file-lines' },
  ];

  const filteredUsers = users.filter(
    (u) =>
      !search ||
      u.username?.toLowerCase().includes(search.toLowerCase()) ||
      u.displayName?.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredTeams = teams.filter(
    (t) =>
      !search ||
      t.name?.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredProjects = projects.filter(
    (p) =>
      !search ||
      p.title?.toLowerCase().includes(search.toLowerCase()) ||
      p.owner_username?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex-1 flex flex-col h-full bg-dark-900">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-dark-700 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon name="shield-halved" className="text-banana-400 text-lg" />
          <h1 className="text-lg font-semibold text-gray-100">系统管理</h1>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-200 transition-colors p-1"
        >
          <Icon name="xmark" className="text-lg" />
        </button>
      </div>

      {/* Tabs + Search */}
      <div className="shrink-0 px-6 py-3 border-b border-dark-700 flex items-center gap-4 flex-wrap">
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => handleTabChange(t.key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                tab === t.key
                  ? 'bg-banana-500/20 text-banana-400'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-dark-700/60'
              }`}
            >
              <Icon name={t.icon} className="text-xs" />
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <div className="relative">
          <Icon
            name="search"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索..."
            className="w-48 pl-8 pr-3 py-1.5 rounded-md bg-dark-700 border border-dark-600 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-banana-500/50"
          />
        </div>

        <button
          onClick={() => loadData(tab)}
          disabled={loading}
          className="px-3 py-1.5 rounded-md text-sm text-gray-400 hover:text-gray-200 hover:bg-dark-700/60 transition-colors flex items-center gap-1.5 disabled:opacity-50"
        >
          <Icon name="arrows-rotate" className={`text-xs ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-500">
            <Icon name="spinner" className="animate-spin text-2xl mr-3" />
            加载中...
          </div>
        ) : (
          <>
            {tab === 'users' && (
              <UsersTable users={filteredUsers} formatDate={formatDate} onRefresh={() => loadData('users')} />
            )}
            {tab === 'teams' && (
              <TeamsTable teams={filteredTeams} formatDate={formatDate} onRefresh={() => loadData('teams')} />
            )}
            {tab === 'projects' && (
              <ProjectsTable projects={filteredProjects} formatDate={formatDate} onRefresh={() => loadData('projects')} />
            )}
            {tab === 'providers' && (
              <ProvidersTable providers={providers} formatDate={formatDate} onRefresh={() => loadData('providers')} />
            )}
            {tab === 'templates' && (
              <DefaultTemplatesTable templates={defaultTemplates} formatDate={formatDate} onRefresh={() => loadData('templates')} />
            )}
          </>
        )}
      </div>
    </div>
  );
};

/* ── Table Components ── */

const TableHeader: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
    {children}
  </th>
);

const TableCell: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <td className={`px-4 py-3 text-sm text-gray-300 ${className ?? ''}`}>{children}</td>
);

const EmptyState: React.FC<{ text: string }> = ({ text }) => (
  <div className="text-center text-gray-600 py-16 text-sm">{text}</div>
);

/* ── Create User Form ── */

const CreateUserForm: React.FC<{ onCreated: () => void }> = ({ onCreated }) => {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await syncService.createUser(username, password, displayName || undefined);
      setUsername('');
      setPassword('');
      setDisplayName('');
      setOpen(false);
      onCreated();
    } catch (err: any) {
      setError(err?.message || '创建失败');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-4 px-3 py-1.5 rounded-md text-sm bg-banana-500/20 text-banana-400 hover:bg-banana-500/30 transition-colors flex items-center gap-1.5"
      >
        <Icon name="plus" className="text-xs" />
        创建用户
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 p-4 rounded-lg border border-dark-600 bg-dark-800/50 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-200">创建用户</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-300 transition-colors">
          <Icon name="xmark" className="text-xs" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-[11px] text-gray-500 mb-1 block">用户名 *</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="2-32 位字母数字"
            required
            pattern="[a-zA-Z0-9_-]{2,32}"
            className="w-full px-2.5 py-1.5 rounded-md bg-dark-900 border border-dark-600 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-banana-500/50"
          />
        </div>
        <div>
          <label className="text-[11px] text-gray-500 mb-1 block">密码 *</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 6 位"
            required
            minLength={6}
            className="w-full px-2.5 py-1.5 rounded-md bg-dark-900 border border-dark-600 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-banana-500/50"
          />
        </div>
        <div>
          <label className="text-[11px] text-gray-500 mb-1 block">显示名</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="可选"
            className="w-full px-2.5 py-1.5 rounded-md bg-dark-900 border border-dark-600 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-banana-500/50"
          />
        </div>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="px-3 py-1.5 rounded-md text-sm bg-banana-500/20 text-banana-400 hover:bg-banana-500/30 transition-colors disabled:opacity-50"
        >
          {saving ? '创建中...' : '创建'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-3 py-1.5 rounded-md text-sm bg-dark-700 text-gray-400 hover:bg-dark-600 transition-colors"
        >
          取消
        </button>
      </div>
    </form>
  );
};

/* ── Quota Inline Editor ── */

const QuotaEditor: React.FC<{
  userId: string;
  monthlyLimit: number;
  dailyLimit: number;
  onSaved: () => void;
  onCancel: () => void;
}> = ({ userId, monthlyLimit, dailyLimit, onSaved, onCancel }) => {
  const [ml, setMl] = useState(monthlyLimit);
  const [dl, setDl] = useState(dailyLimit);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await syncService.updateUserQuota(userId, ml, dl);
      onSaved();
    } catch (e) {
      console.error('[Admin] 配额保存失败:', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr className="bg-dark-800/80">
      <td colSpan={10} className="px-4 py-3">
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-500">月配额:</span>
          <input
            type="number"
            value={ml}
            onChange={(e) => setMl(Number(e.target.value))}
            className="w-24 px-2 py-1 rounded bg-dark-900 border border-dark-600 text-sm text-gray-200 focus:outline-none focus:border-banana-500/50"
          />
          <span className="text-xs text-gray-500">日配额:</span>
          <input
            type="number"
            value={dl}
            onChange={(e) => setDl(Number(e.target.value))}
            className="w-24 px-2 py-1 rounded bg-dark-900 border border-dark-600 text-sm text-gray-200 focus:outline-none focus:border-banana-500/50"
          />
          <span className="text-[10px] text-gray-600">-1 = 不限</span>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-2.5 py-1 rounded text-xs bg-banana-500/20 text-banana-400 hover:bg-banana-500/30 transition-colors disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            onClick={onCancel}
            className="px-2.5 py-1 rounded text-xs bg-dark-700 text-gray-400 hover:bg-dark-600 transition-colors"
          >
            取消
          </button>
        </div>
      </td>
    </tr>
  );
};

/* ── Users Table ── */

const UsersTable: React.FC<{
  users: any[];
  formatDate: (ts: number | null) => string;
  onRefresh: () => void;
}> = ({ users, formatDate, onRefresh }) => {
  const [editingQuotaId, setEditingQuotaId] = useState<string | null>(null);

  const formatLimit = (v: number) => (v === -1 ? '不限' : String(v));

  return (
    <>
      <CreateUserForm onCreated={onRefresh} />
      {users.length === 0 ? (
        <EmptyState text="暂无用户数据" />
      ) : (
        <table className="w-full">
          <thead className="border-b border-dark-700">
            <tr>
              <TableHeader>用户名</TableHeader>
              <TableHeader>显示名</TableHeader>
              <TableHeader>今日</TableHeader>
              <TableHeader>本月</TableHeader>
              <TableHeader>月配额</TableHeader>
              <TableHeader>日配额</TableHeader>
              <TableHeader>团队</TableHeader>
              <TableHeader>项目</TableHeader>
              <TableHeader>注册时间</TableHeader>
              <TableHeader>操作</TableHeader>
            </tr>
          </thead>
          <tbody className="divide-y divide-dark-700/50">
            {users.map((u) => (
              <React.Fragment key={u.id}>
                <tr className="hover:bg-dark-800/50 transition-colors">
                  <TableCell>
                    <span className="font-medium text-gray-200">{u.username}</span>
                  </TableCell>
                  <TableCell>{u.displayName || '—'}</TableCell>
                  <TableCell>{u.today ?? 0}</TableCell>
                  <TableCell>{u.thisMonth ?? 0}</TableCell>
                  <TableCell>{formatLimit(u.monthlyLimit ?? -1)}</TableCell>
                  <TableCell>{formatLimit(u.dailyLimit ?? -1)}</TableCell>
                  <TableCell>{u.teamCount}</TableCell>
                  <TableCell>{u.projectCount}</TableCell>
                  <TableCell className="text-gray-500">{formatDate(u.createdAt)}</TableCell>
                  <TableCell>
                    <button
                      onClick={() => setEditingQuotaId(editingQuotaId === u.id ? null : u.id)}
                      className="text-xs text-banana-400 hover:text-banana-300 transition-colors"
                    >
                      配额
                    </button>
                  </TableCell>
                </tr>
                {editingQuotaId === u.id && (
                  <QuotaEditor
                    userId={u.id}
                    monthlyLimit={u.monthlyLimit ?? -1}
                    dailyLimit={u.dailyLimit ?? -1}
                    onSaved={() => {
                      setEditingQuotaId(null);
                      onRefresh();
                    }}
                    onCancel={() => setEditingQuotaId(null)}
                  />
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
};

/* ── Add Member Inline ── */

const AddMemberInline: React.FC<{
  teamId: string;
  onAdded: () => void;
  onCancel: () => void;
}> = ({ teamId, onAdded, onCancel }) => {
  const [username, setUsername] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleAdd = async () => {
    if (!username.trim()) return;
    setError('');
    setSaving(true);
    try {
      await syncService.addTeamMember(teamId, username.trim());
      setUsername('');
      onAdded();
    } catch (err: any) {
      setError(err?.message || '添加失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr className="bg-dark-800/80">
      <td colSpan={5} className="px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">用户名:</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="输入要添加的用户名"
            className="w-48 px-2 py-1 rounded bg-dark-900 border border-dark-600 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-banana-500/50"
          />
          <button
            onClick={handleAdd}
            disabled={saving || !username.trim()}
            className="px-2.5 py-1 rounded text-xs bg-banana-500/20 text-banana-400 hover:bg-banana-500/30 transition-colors disabled:opacity-50"
          >
            {saving ? '添加中...' : '添加'}
          </button>
          <button
            onClick={onCancel}
            className="px-2.5 py-1 rounded text-xs bg-dark-700 text-gray-400 hover:bg-dark-600 transition-colors"
          >
            取消
          </button>
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      </td>
    </tr>
  );
};

/* ── Teams Table ── */

const TeamsTable: React.FC<{
  teams: any[];
  formatDate: (ts: number | null) => string;
  onRefresh: () => void;
}> = ({ teams, formatDate, onRefresh }) => {
  const [addingMemberTeamId, setAddingMemberTeamId] = useState<string | null>(null);
  const [removingMember, setRemovingMember] = useState<string | null>(null);

  const handleRemoveMember = async (teamId: string, userId: string) => {
    const key = `${teamId}:${userId}`;
    setRemovingMember(key);
    try {
      await syncService.removeTeamMember(teamId, userId);
      onRefresh();
    } catch (e: any) {
      console.error('[Admin] 移除成员失败:', e);
    } finally {
      setRemovingMember(null);
    }
  };

  const handleDeleteTeam = async (teamId: string) => {
    try {
      await syncService.deleteTeam(teamId);
      onRefresh();
    } catch (e: any) {
      console.error('[Admin] 删除团队失败:', e);
    }
  };

  if (teams.length === 0) return <EmptyState text="暂无团队数据" />;
  return (
    <table className="w-full">
      <thead className="border-b border-dark-700">
        <tr>
          <TableHeader>团队名称</TableHeader>
          <TableHeader>成员</TableHeader>
          <TableHeader>创建时间</TableHeader>
          <TableHeader>操作</TableHeader>
        </tr>
      </thead>
      <tbody className="divide-y divide-dark-700/50">
        {teams.map((t) => (
          <React.Fragment key={t.id}>
            <tr className="hover:bg-dark-800/50 transition-colors">
              <TableCell>
                <span className="font-medium text-gray-200">{t.name}</span>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1.5">
                  {t.members?.map((m: any) => (
                    <span key={m.userId} className="inline-flex items-center gap-1 text-xs bg-dark-700 rounded px-1.5 py-0.5 text-gray-300">
                      {m.username}
                      <button
                        onClick={() => handleRemoveMember(t.id, m.userId)}
                        disabled={removingMember === `${t.id}:${m.userId}`}
                        className="text-gray-500 hover:text-red-400 transition-colors disabled:opacity-50"
                        title="移除成员"
                      >
                        <Icon name="xmark" className="text-[9px]" />
                      </button>
                    </span>
                  )) || <span className="text-xs text-gray-600">无成员</span>}
                </div>
              </TableCell>
              <TableCell className="text-gray-500">{formatDate(t.created_at)}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAddingMemberTeamId(addingMemberTeamId === t.id ? null : t.id)}
                    className="text-xs text-banana-400 hover:text-banana-300 transition-colors"
                  >
                    添加成员
                  </button>
                  <button
                    onClick={() => handleDeleteTeam(t.id)}
                    className="text-xs text-red-400/60 hover:text-red-400 transition-colors"
                  >
                    删除
                  </button>
                </div>
              </TableCell>
            </tr>
            {addingMemberTeamId === t.id && (
              <AddMemberInline
                teamId={t.id}
                onAdded={() => {
                  setAddingMemberTeamId(null);
                  onRefresh();
                }}
                onCancel={() => setAddingMemberTeamId(null)}
              />
            )}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  );
};

/* ── Projects Table ── */

const ProjectsTable: React.FC<{
  projects: any[];
  formatDate: (ts: number | null) => string;
  onRefresh: () => void;
}> = ({ projects, formatDate, onRefresh }) => {
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = async (projectId: string) => {
    setDeleting(projectId);
    try {
      await syncService.deleteProject(projectId);
      onRefresh();
    } catch (e: any) {
      console.error('[Admin] 删除项目失败:', e);
    } finally {
      setDeleting(null);
    }
  };

  if (projects.length === 0) return <EmptyState text="暂无项目数据" />;
  return (
    <table className="w-full">
      <thead className="border-b border-dark-700">
        <tr>
          <TableHeader>项目标题</TableHeader>
          <TableHeader>所有者</TableHeader>
          <TableHeader>创建时间</TableHeader>
          <TableHeader>更新时间</TableHeader>
          <TableHeader>操作</TableHeader>
        </tr>
      </thead>
      <tbody className="divide-y divide-dark-700/50">
        {projects.map((p) => (
          <tr key={p.id} className="hover:bg-dark-800/50 transition-colors">
            <TableCell>
              <span className="font-medium text-gray-200">
                {p.title || '未命名项目'}
              </span>
            </TableCell>
            <TableCell>{p.owner_username || '—'}</TableCell>
            <TableCell className="text-gray-500">{formatDate(p.created_at)}</TableCell>
            <TableCell className="text-gray-500">{formatDate(p.updated_at)}</TableCell>
            <TableCell>
              <button
                onClick={() => handleDelete(p.id)}
                disabled={deleting === p.id}
                className="text-xs text-red-400/60 hover:text-red-400 transition-colors disabled:opacity-50"
              >
                {deleting === p.id ? '删除中...' : '删除'}
              </button>
            </TableCell>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

/* ── Providers Table ── */

const ProvidersTable: React.FC<{
  providers: any[];
  formatDate: (ts: number | null) => string;
  onRefresh: () => void;
}> = ({ providers, onRefresh }) => {
  const [activating, setActivating] = useState<string | null>(null);
  const [fetchingModels, setFetchingModels] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleActivate = async (id: string) => {
    if (!confirm('确定要激活此供应商？切换后所有用户的请求将路由到新线路。')) return;
    setActivating(id);
    try {
      await syncService.activateProvider(id);
      onRefresh();
    } catch (e: any) {
      console.error('[Admin] 激活供应商失败:', e);
    } finally {
      setActivating(null);
    }
  };

  const handleFetchModels = async (id: string) => {
    setFetchingModels(id);
    try {
      await syncService.fetchProviderModels(id);
      setExpandedId(id);
      onRefresh();
    } catch (e: any) {
      alert(e?.message || '获取模型列表失败');
    } finally {
      setFetchingModels(null);
    }
  };

  if (providers.length === 0) {
    return (
      <div className="text-center py-16 space-y-3">
        <EmptyState text="未配置供应商" />
        <p className="text-xs text-gray-600">
          在 .env.local 中配置 UPSTREAM_API_BASE_URL / UPSTREAM_AUTHORIZATION 环境变量后重启服务
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="text-xs text-gray-600 mb-4">
        供应商配置来自环境变量，如需修改 URL 或 API Key 请更新 .env.local 后重启服务。
      </p>
      <table className="w-full">
        <thead className="border-b border-dark-700">
          <tr>
            <TableHeader>名称</TableHeader>
            <TableHeader>URL</TableHeader>
            <TableHeader>API Key</TableHeader>
            <TableHeader>模型数</TableHeader>
            <TableHeader>状态</TableHeader>
            <TableHeader>操作</TableHeader>
          </tr>
        </thead>
        <tbody className="divide-y divide-dark-700/50">
          {providers.map((p) => (
            <React.Fragment key={p.id}>
              <tr className={`hover:bg-dark-800/50 transition-colors ${p.isActive ? 'bg-banana-500/5' : ''}`}>
                <TableCell>
                  <span className="font-medium text-gray-200">{p.name}</span>
                </TableCell>
                <TableCell>
                  <span className="text-xs text-gray-400 font-mono truncate max-w-[200px] inline-block">{p.baseUrl}</span>
                </TableCell>
                <TableCell>
                  <span className="text-xs text-gray-500 font-mono">{p.apiKey}</span>
                </TableCell>
                <TableCell>
                  <button
                    onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                    className="text-xs text-gray-300 hover:text-banana-400 transition-colors"
                  >
                    {p.modelsCache ? p.modelsCache.length : '—'}
                  </button>
                </TableCell>
                <TableCell>
                  {p.isActive ? (
                    <span className="inline-flex items-center gap-1 text-xs bg-banana-500/20 text-banana-400 rounded-full px-2 py-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-banana-400" />
                      使用中
                    </span>
                  ) : (
                    <span className="text-xs text-gray-600">未激活</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2 flex-wrap">
                    {!p.isActive && (
                      <button
                        onClick={() => handleActivate(p.id)}
                        disabled={activating === p.id}
                        className="text-xs text-green-400/70 hover:text-green-400 transition-colors disabled:opacity-50"
                      >
                        {activating === p.id ? '切换中...' : '激活'}
                      </button>
                    )}
                    <button
                      onClick={() => handleFetchModels(p.id)}
                      disabled={fetchingModels === p.id}
                      className="text-xs text-blue-400/70 hover:text-blue-400 transition-colors disabled:opacity-50"
                    >
                      {fetchingModels === p.id ? (
                        <><Icon name="spinner" className="animate-spin text-[10px] mr-0.5" />刷新中</>
                      ) : '刷新模型'}
                    </button>
                  </div>
                </TableCell>
              </tr>
              {expandedId === p.id && p.modelsCache && p.modelsCache.length > 0 && (
                <tr className="bg-dark-800/30">
                  <td colSpan={6} className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {p.modelsCache.map((m: string) => (
                        <span
                          key={m}
                          className="inline-block text-[10px] bg-dark-700 text-gray-400 rounded px-1.5 py-0.5 font-mono"
                        >
                          {m}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </>
  );
};

/* ── Default Templates Table ── */

const DefaultTemplatesTable: React.FC<{
  templates: any[];
  formatDate: (ts: number | null) => string;
  onRefresh: () => void;
}> = ({ templates, formatDate, onRefresh }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editSortOrder, setEditSortOrder] = useState(0);
  const [editFeatured, setEditFeatured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newFeatured, setNewFeatured] = useState(false);

  const startEdit = (t: any) => {
    setEditingId(t.id);
    setEditName(t.name);
    setEditContent(t.content);
    setEditSortOrder(t.sort_order ?? 0);
    setEditFeatured(Boolean(t.is_featured));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditContent('');
    setEditSortOrder(0);
    setEditFeatured(false);
  };

  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      const updated = templates.map((t) =>
        t.id === editingId
          ? { ...t, name: editName, content: editContent, sort_order: editSortOrder, is_featured: editFeatured ? 1 : 0 }
          : t
      );
      await syncService.saveAdminDefaultTemplates(updated);
      cancelEdit();
      onRefresh();
    } catch (e) {
      console.error('[Admin] 保存模板失败:', e);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await syncService.deleteAdminDefaultTemplate(id);
      onRefresh();
    } catch (e) {
      console.error('[Admin] 删除模板失败:', e);
    } finally {
      setDeleting(null);
    }
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await syncService.addAdminDefaultTemplate(newName.trim(), newContent, newFeatured);
      setNewName('');
      setNewContent('');
      setNewFeatured(false);
      setAdding(false);
      onRefresh();
    } catch (e) {
      console.error('[Admin] 添加模板失败:', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <p className="text-xs text-gray-600 mb-4">
        管理所有用户默认可见的风格模板。新用户无个人模板时，将自动使用这些默认模板。
      </p>

      {!adding ? (
        <button
          onClick={() => setAdding(true)}
          className="mb-4 px-3 py-1.5 rounded-md text-sm bg-banana-500/20 text-banana-400 hover:bg-banana-500/30 transition-colors flex items-center gap-1.5"
        >
          <Icon name="plus" className="text-xs" />
          添加模板
        </button>
      ) : (
        <div className="mb-4 p-4 rounded-lg border border-dark-600 bg-dark-800/50 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-200">添加默认模板</h3>
            <button type="button" onClick={() => setAdding(false)} className="text-gray-500 hover:text-gray-300 transition-colors">
              <Icon name="xmark" className="text-xs" />
            </button>
          </div>
          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">模板名称 *</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="例如：超写实电商"
              className="w-full px-2.5 py-1.5 rounded-md bg-dark-900 border border-dark-600 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-banana-500/50"
            />
          </div>
          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">模板内容</label>
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              rows={4}
              placeholder="系统提示词内容..."
              className="w-full px-2.5 py-1.5 rounded-md bg-dark-900 border border-dark-600 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-banana-500/50 resize-y"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={newFeatured}
              onChange={(e) => setNewFeatured(e.target.checked)}
              className="h-4 w-4 accent-amber-500"
            />
            <span className="text-sm text-gray-300">精品模板</span>
            <span className="text-[10px] text-gray-600">（用户不可查看提示词内容）</span>
          </label>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={saving || !newName.trim()}
              className="px-3 py-1.5 rounded-md text-sm bg-banana-500/20 text-banana-400 hover:bg-banana-500/30 transition-colors disabled:opacity-50"
            >
              {saving ? '添加中...' : '添加'}
            </button>
            <button
              onClick={() => setAdding(false)}
              className="px-3 py-1.5 rounded-md text-sm bg-dark-700 text-gray-400 hover:bg-dark-600 transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {templates.length === 0 ? (
        <EmptyState text="暂无默认模板" />
      ) : (
        <table className="w-full">
          <thead className="border-b border-dark-700">
            <tr>
              <TableHeader>排序</TableHeader>
              <TableHeader>名称</TableHeader>
              <TableHeader>精品</TableHeader>
              <TableHeader>内容预览</TableHeader>
              <TableHeader>更新时间</TableHeader>
              <TableHeader>操作</TableHeader>
            </tr>
          </thead>
          <tbody className="divide-y divide-dark-700/50">
            {templates.map((t) => (
              <React.Fragment key={t.id}>
                <tr className="hover:bg-dark-800/50 transition-colors">
                  <TableCell className="text-gray-500 w-16">{t.sort_order}</TableCell>
                  <TableCell>
                    <span className="font-medium text-gray-200">{t.name}</span>
                  </TableCell>
                  <TableCell>
                    {t.is_featured ? (
                      <span className="inline-flex items-center text-[10px] bg-amber-500/20 text-amber-400 rounded-full px-1.5 py-0.5">⭐ 精品</span>
                    ) : (
                      <span className="text-xs text-gray-600">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-gray-400 text-xs line-clamp-2 max-w-md">
                      {t.content?.substring(0, 100)}{t.content?.length > 100 ? '...' : ''}
                    </span>
                  </TableCell>
                  <TableCell className="text-gray-500">{formatDate(t.updated_at)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => startEdit(t)}
                        className="text-xs text-banana-400 hover:text-banana-300 transition-colors"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => handleDelete(t.id)}
                        disabled={deleting === t.id}
                        className="text-xs text-red-400/60 hover:text-red-400 transition-colors disabled:opacity-50"
                      >
                        {deleting === t.id ? '删除中...' : '删除'}
                      </button>
                    </div>
                  </TableCell>
                </tr>
                {editingId === t.id && (
                  <tr className="bg-dark-800/80">
                    <td colSpan={6} className="px-4 py-3">
                      <div className="space-y-3">
                        <div className="flex gap-3">
                          <div className="flex-1">
                            <label className="text-[11px] text-gray-500 mb-1 block">名称</label>
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-md bg-dark-900 border border-dark-600 text-sm text-gray-200 focus:outline-none focus:border-banana-500/50"
                            />
                          </div>
                          <div className="w-24">
                            <label className="text-[11px] text-gray-500 mb-1 block">排序</label>
                            <input
                              type="number"
                              value={editSortOrder}
                              onChange={(e) => setEditSortOrder(Number(e.target.value))}
                              className="w-full px-2.5 py-1.5 rounded-md bg-dark-900 border border-dark-600 text-sm text-gray-200 focus:outline-none focus:border-banana-500/50"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-500 mb-1 block">内容</label>
                          <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            rows={6}
                            className="w-full px-2.5 py-1.5 rounded-md bg-dark-900 border border-dark-600 text-sm text-gray-200 focus:outline-none focus:border-banana-500/50 resize-y"
                          />
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editFeatured}
                            onChange={(e) => setEditFeatured(e.target.checked)}
                            className="h-4 w-4 accent-amber-500"
                          />
                          <span className="text-sm text-gray-300">精品模板</span>
                          <span className="text-[10px] text-gray-600">（用户不可查看提示词内容）</span>
                        </label>
                        <div className="flex gap-2">
                          <button
                            onClick={handleSaveEdit}
                            disabled={saving}
                            className="px-3 py-1.5 rounded-md text-sm bg-banana-500/20 text-banana-400 hover:bg-banana-500/30 transition-colors disabled:opacity-50"
                          >
                            {saving ? '保存中...' : '保存'}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="px-3 py-1.5 rounded-md text-sm bg-dark-700 text-gray-400 hover:bg-dark-600 transition-colors"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
};
