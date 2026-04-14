import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Upload,
  FileText,
  Link as LinkIcon,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
} from 'lucide-react';
import { useWorkspaceStore } from '@/store/workspace';
import { useWs } from '@/lib/useWs';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { WsMessage } from '@llm-wiki/shared';

interface Source {
  id: string;
  title: string;
  sourceType: 'text' | 'url' | 'file';
  status: string;
  ingestState: { totalBatches: number; completedBatches: number; failedBatches: number[] } | null;
  createdAt: string;
}

const statusConfig: Record<string, { icon: typeof Clock; color: string; label: string }> = {
  pending: { icon: Clock, color: 'text-zinc-400', label: 'Pending' },
  processing: { icon: RefreshCw, color: 'text-blue-500', label: 'Processing' },
  completed: { icon: CheckCircle2, color: 'text-green-500', label: 'Completed' },
  partial_failure: { icon: AlertCircle, color: 'text-amber-500', label: 'Partial' },
  failed: { icon: AlertCircle, color: 'text-red-500', label: 'Failed' },
};

export function SourcesView() {
  const { currentWorkspace } = useWorkspaceStore();
  const [sources, setSources] = useState<Source[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [sourceType, setSourceType] = useState<'text' | 'url'>('text');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleWsMessage = useCallback((msg: WsMessage) => {
    if (msg.type === 'ingest:progress') {
      loadSources();
    }
  }, []);

  useWs({ workspaceId: currentWorkspace?.id ?? null, onMessage: handleWsMessage });

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0 || !currentWorkspace) return;
    const file = acceptedFiles[0];
    const isTextFile = /\.(txt|md)$/i.test(file.name);

    if (isTextFile) {
      const reader = new FileReader();
      reader.onload = () => {
        setTitle(file.name.replace(/\.[^.]+$/, ''));
        setContent(reader.result as string);
        setSourceType('text');
        setShowForm(true);
      };
      reader.readAsText(file);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', file.name.replace(/\.[^.]+$/, ''));

      const res = await fetch(`/api/workspaces/${currentWorkspace.id}/sources/file`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (res.status === 409) {
        setError('This file has already been uploaded.');
      } else if (res.status === 422) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || 'Unsupported file type');
      } else if (!res.ok) {
        setError('Failed to upload file');
      } else {
        await loadSources();
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [currentWorkspace]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/plain': ['.txt', '.md'],
      'text/markdown': ['.md'],
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'text/html': ['.html', '.htm'],
    },
    multiple: false,
    noClick: true,
  });

  useEffect(() => {
    if (!currentWorkspace) return;
    loadSources();

    // Polling fallback for ingest progress
    const interval = setInterval(() => {
      loadSources();
    }, 5000);
    return () => clearInterval(interval);
  }, [currentWorkspace?.id]);

  async function loadSources() {
    if (!currentWorkspace) return;
    try {
      const res = await fetch(`/api/workspaces/${currentWorkspace.id}/sources`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setSources(data.data);
      }
    } catch {
      // ignore
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentWorkspace) return;
    setLoading(true);
    setError('');

    const endpoint = sourceType === 'text' ? 'text' : 'url';
    const body =
      sourceType === 'text'
        ? { title, content }
        : { title, url: content };

    try {
      const res = await fetch(`/api/workspaces/${currentWorkspace.id}/sources/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (res.status === 409) {
        setError('This content has already been uploaded.');
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || 'Failed to create source');
        return;
      }

      setTitle('');
      setContent('');
      setShowForm(false);
      await loadSources();
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6" {...getRootProps()}>
      <input {...getInputProps()} />
      {isDragActive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary-600/10 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-primary-400 bg-white px-12 py-8 text-center shadow-lg">
            <Upload className="mx-auto mb-2 h-10 w-10 text-primary-500" />
            <p className="text-lg font-medium text-primary-700">Drop file to upload</p>
          </div>
        </div>
      )}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Sources</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={loadSources}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={() => setShowForm(true)}>
            <Upload className="h-4 w-4" />
            Add Source
          </Button>
        </div>
      </div>

      {showForm && (
        <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-4 flex gap-2">
            <button
              onClick={() => setSourceType('text')}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
                sourceType === 'text' ? 'bg-primary-50 text-primary-700' : 'text-zinc-600 hover:bg-zinc-100',
              )}
            >
              <FileText className="h-4 w-4" /> Text
            </button>
            <button
              onClick={() => setSourceType('url')}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
                sourceType === 'url' ? 'bg-primary-50 text-primary-700' : 'text-zinc-600 hover:bg-zinc-100',
              )}
            >
              <LinkIcon className="h-4 w-4" /> URL
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="text"
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-primary-500 dark:border-zinc-700 dark:bg-zinc-800"
              required
            />
            {sourceType === 'text' ? (
              <textarea
                placeholder="Paste your content here..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="min-h-[200px] w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-primary-500 dark:border-zinc-700 dark:bg-zinc-800"
                required
              />
            ) : (
              <input
                type="url"
                placeholder="https://..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-primary-500 dark:border-zinc-700 dark:bg-zinc-800"
                required
              />
            )}

            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="flex gap-2">
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Submit
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => { setShowForm(false); setError(''); }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-2">
        {sources.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-500">No sources yet. Click "Add Source" to upload your first document.</p>
          </div>
        ) : (
          sources.map((source) => {
            const cfg = statusConfig[source.status] || statusConfig.pending;
            const StatusIcon = cfg.icon;
            return (
              <div
                key={source.id}
                className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {source.sourceType === 'url' ? (
                      <LinkIcon className="h-4 w-4 text-zinc-400" />
                    ) : (
                      <FileText className="h-4 w-4 text-zinc-400" />
                    )}
                    <span className="truncate font-medium">{source.title}</span>
                  </div>
                  <div className="mt-1 text-xs text-zinc-400">
                    {new Date(source.createdAt).toLocaleString()}
                    {source.ingestState && (source.status === 'processing' || source.status === 'partial_failure') && (
                      <span className="ml-2">
                        ({source.ingestState.completedBatches}/{source.ingestState.totalBatches} batches
                        {source.ingestState.failedBatches.length > 0 && (
                          <span className="text-red-500"> · {source.ingestState.failedBatches.length} failed</span>
                        )}
                        )
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(source.status === 'partial_failure' || source.status === 'failed') && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        if (!currentWorkspace) return;
                        await fetch(`/api/workspaces/${currentWorkspace.id}/sources/${source.id}/retry`, {
                          method: 'POST',
                          credentials: 'include',
                        });
                        loadSources();
                      }}
                      className="text-amber-600 border-amber-300 hover:bg-amber-50"
                    >
                      Retry
                    </Button>
                  )}
                  <div className={cn('flex items-center gap-1.5 text-xs font-medium', cfg.color)}>
                    <StatusIcon className={cn('h-4 w-4', source.status === 'processing' && 'animate-spin')} />
                    {cfg.label}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
