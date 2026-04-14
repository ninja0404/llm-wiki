import { useState, useEffect } from 'react';
import { Book, Upload, MessageSquare, Activity, AlertTriangle, Check, Archive, Trash2 } from 'lucide-react';
import { useWorkspaceStore } from '@/store/workspace';
import { Link } from 'react-router';

interface FlaggedPage {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  createdAt: string;
}

interface DashboardData {
  stats: { pages: number; sources: number; conversations: number; flagged: number };
  recentActivity: { id: string; action: string; entityType: string; createdAt: string; details: Record<string, unknown> | null }[];
}

const statCards = [
  { key: 'pages' as const, label: 'Wiki Pages', icon: Book, color: 'text-blue-600' },
  { key: 'sources' as const, label: 'Sources', icon: Upload, color: 'text-green-600' },
  { key: 'conversations' as const, label: 'Conversations', icon: MessageSquare, color: 'text-purple-600' },
  { key: 'flagged' as const, label: 'Flagged', icon: AlertTriangle, color: 'text-amber-600' },
];

export function DashboardView() {
  const { currentWorkspace } = useWorkspaceStore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [flaggedPages, setFlaggedPages] = useState<FlaggedPage[]>([]);

  useEffect(() => {
    if (!currentWorkspace) return;
    fetch(`/api/workspaces/${currentWorkspace.id}/dashboard`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setData(d.data))
      .catch(() => {});
    fetch(`/api/workspaces/${currentWorkspace.id}/flagged`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setFlaggedPages(d.data))
      .catch(() => {});
  }, [currentWorkspace?.id]);

  async function resolveFlagged(pageId: string, action: 'publish' | 'archive' | 'delete') {
    if (!currentWorkspace) return;
    await fetch(`/api/workspaces/${currentWorkspace.id}/flagged/${pageId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action }),
    });
    setFlaggedPages((prev) => prev.filter((p) => p.id !== pageId));
  }

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold">Dashboard</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map(({ key, label, icon: Icon, color }) => (
          <div
            key={key}
            className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-500">{label}</p>
                <p className="mt-1 text-2xl font-bold">{data?.stats[key] ?? 0}</p>
              </div>
              <Icon className={`h-8 w-8 ${color} opacity-80`} />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-lg font-semibold">Recent Activity</h2>
        {!data || data.recentActivity.length === 0 ? (
          <p className="text-sm text-zinc-500">No activity yet. Upload your first source to get started.</p>
        ) : (
          <div className="space-y-3">
            {data.recentActivity.map((log) => (
              <div key={log.id} className="flex items-start gap-3 text-sm">
                <Activity className="mt-0.5 h-4 w-4 text-zinc-400" />
                <div>
                  <span className="font-medium">{log.action}</span>
                  <span className="text-zinc-400"> on {log.entityType}</span>
                  <div className="text-xs text-zinc-400">{new Date(log.createdAt).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {flaggedPages.length > 0 && (
        <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-800 dark:bg-amber-900/20">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-5 w-5" />
            Flagged Pages ({flaggedPages.length})
          </h2>
          <div className="space-y-2">
            {flaggedPages.map((page) => (
              <div key={page.id} className="flex items-center justify-between rounded-lg bg-white px-4 py-3 dark:bg-zinc-900">
                <div>
                  <Link to={`/wiki/${page.slug}`} className="font-medium text-primary-600 hover:underline">
                    {page.title}
                  </Link>
                  {page.summary && <p className="mt-0.5 text-xs text-zinc-500">{page.summary}</p>}
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => resolveFlagged(page.id, 'publish')}
                    className="rounded p-1.5 text-green-600 hover:bg-green-50"
                    title="Publish"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => resolveFlagged(page.id, 'archive')}
                    className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100"
                    title="Archive"
                  >
                    <Archive className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => resolveFlagged(page.id, 'delete')}
                    className="rounded p-1.5 text-red-400 hover:bg-red-50"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
