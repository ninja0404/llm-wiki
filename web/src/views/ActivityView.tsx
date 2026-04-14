import { useState, useEffect } from 'react';
import { Activity, FileText, Book, MessageSquare, Wrench } from 'lucide-react';
import { useWorkspaceStore } from '@/store/workspace';

interface ActivityLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  details: Record<string, unknown> | null;
  traceId: string | null;
  userId: string | null;
  createdAt: string;
}

const entityIcons: Record<string, typeof Activity> = {
  source: FileText,
  wiki_page: Book,
  conversation: MessageSquare,
};

export function ActivityView() {
  const { currentWorkspace } = useWorkspaceStore();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');

  useEffect(() => {
    if (!currentWorkspace) return;
    setLoading(true);
    const params = new URLSearchParams({ limit: '50' });
    if (filterType) params.set('entityType', filterType);
    fetch(`/api/workspaces/${currentWorkspace.id}/activity?${params}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        setLogs(d.data);
        setTotal(d.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [currentWorkspace?.id, filterType]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Activity Log</h1>
        <div className="flex items-center gap-3">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs outline-none dark:border-zinc-700 dark:bg-zinc-800"
          >
            <option value="">All types</option>
            <option value="source">Source</option>
            <option value="wiki_page">Wiki Page</option>
            <option value="conversation">Conversation</option>
          </select>
          <span className="text-sm text-zinc-400">{total} total</span>
        </div>
      </div>

      {logs.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-col items-center gap-3 py-12 text-zinc-400">
            <Activity className="h-12 w-12" />
            <p className="text-sm">No activity recorded yet</p>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          {logs.map((log) => {
            const Icon = entityIcons[log.entityType] || Wrench;
            return (
              <div
                key={log.id}
                className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <Icon className="mt-0.5 h-4 w-4 text-zinc-400" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm">
                    <span className="font-medium">{log.action}</span>
                    <span className="text-zinc-400"> · {log.entityType}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-400">
                    {new Date(log.createdAt).toLocaleString()}
                    {log.traceId && <span className="ml-2 font-mono">{log.traceId.slice(0, 8)}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
