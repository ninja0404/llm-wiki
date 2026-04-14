import { Link, Outlet, useLocation } from 'react-router';
import { CommandPalette } from './CommandPalette';
import {
  Home,
  FileText,
  Book,
  Search,
  MessageSquare,
  Network,
  Activity,
  Settings,
  Upload,
  Layers,
  LogOut,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useWorkspaceStore } from '@/store/workspace';
import { useAuthStore } from '@/store/auth';

const navItems = [
  { path: '/', label: 'Dashboard', icon: Home },
  { path: '/sources', label: 'Sources', icon: Upload },
  { path: '/wiki', label: 'Wiki', icon: Book },
  { path: '/search', label: 'Search', icon: Search },
  { path: '/chat', label: 'Chat', icon: MessageSquare },
  { path: '/graph', label: 'Graph', icon: Network },
  { path: '/activity', label: 'Activity', icon: Activity },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export function Layout() {
  const location = useLocation();
  const { currentWorkspace, workspaces, setCurrentWorkspace } = useWorkspaceStore();
  const { user, setUser } = useAuthStore();

  async function handleLogout() {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
    setUser(null);
  }

  return (
    <div className="flex h-screen">
      <aside className="flex w-60 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex h-14 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
          <FileText className="h-6 w-6 text-primary-600" />
          <span className="text-lg font-semibold">LLM Wiki</span>
        </div>

        {workspaces.length > 0 && (
          <div className="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
              <Layers className="h-3 w-3" /> Workspace
            </label>
            {workspaces.length === 1 ? (
              <div className="truncate text-sm font-medium">{currentWorkspace?.name}</div>
            ) : (
              <select
                value={currentWorkspace?.id || ''}
                onChange={(e) => {
                  const ws = workspaces.find((w) => w.id === e.target.value);
                  if (ws) setCurrentWorkspace(ws);
                }}
                className="w-full rounded border border-zinc-200 bg-transparent px-2 py-1 text-sm outline-none dark:border-zinc-700"
              >
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <nav className="flex-1 space-y-1 p-3">
          {navItems.map(({ path, label, icon: Icon }) => {
            const isActive =
              path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);
            return (
              <Link
                key={path}
                to={path}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400'
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{user?.name}</div>
              <div className="truncate text-xs text-zinc-400">{user?.email}</div>
            </div>
            <button
              onClick={handleLogout}
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>

      <CommandPalette />
    </div>
  );
}
