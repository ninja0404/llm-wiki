import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router';
import ReactMarkdown from 'react-markdown';
import { Book, ArrowLeft, ExternalLink, Tag, History, Clock, GitCompare, MessageCircle, Send } from 'lucide-react';
import { diffLines, type Change } from 'diff';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useWorkspaceStore } from '@/store/workspace';
import { useWs } from '@/lib/useWs';
import { cn } from '@/lib/cn';
import type { WsMessage } from '@llm-wiki/shared';

interface WikiPageSummary {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  pageType: string;
  status: string;
  tags: string[];
  updatedAt: string;
}

interface WikiPageDetail extends WikiPageSummary {
  content: string;
  sources: { id: string; title: string }[];
  links: { id: string; title: string; slug: string }[];
  backlinks: { id: string; title: string; slug: string }[];
}

export function WikiView() {
  const { slug } = useParams();
  const { currentWorkspace } = useWorkspaceStore();

  if (slug) {
    return <WikiPageDetail slug={slug} workspaceId={currentWorkspace?.id} />;
  }
  return <WikiIndex workspaceId={currentWorkspace?.id} />;
}

function WikiIndex({ workspaceId }: { workspaceId?: string }) {
  const [pages, setPages] = useState<WikiPageSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPages = useCallback(() => {
    if (!workspaceId) return;
    fetch(`/api/workspaces/${workspaceId}/wiki`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setPages(d.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [workspaceId]);

  const handleWsMessage = useCallback((msg: WsMessage) => {
    if (msg.type === 'wiki:page:created' || msg.type === 'wiki:page:updated') {
      loadPages();
    }
  }, [loadPages]);

  useWs({ workspaceId: workspaceId ?? null, onMessage: handleWsMessage });

  useEffect(() => {
    loadPages();
  }, [loadPages]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold">Wiki Browser</h1>
      {pages.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-col items-center gap-3 py-12 text-zinc-400">
            <Book className="h-12 w-12" />
            <p className="text-sm">No wiki pages yet. Upload sources to build your knowledge base.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {pages.map((page) => (
            <Link
              key={page.id}
              to={`/wiki/${page.slug}`}
              className="block rounded-xl border border-zinc-200 bg-white px-5 py-4 transition-colors hover:border-primary-300 hover:bg-primary-50/30 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{page.title}</span>
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800">
                  {page.pageType}
                </span>
              </div>
              {page.summary && (
                <p className="mt-1 text-sm text-zinc-500">{page.summary}</p>
              )}
              {page.tags && page.tags.length > 0 && (
                <div className="mt-2 flex gap-1">
                  {page.tags.map((tag) => (
                    <span key={tag} className="rounded bg-primary-50 px-1.5 py-0.5 text-[10px] text-primary-600">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

interface VersionEntry {
  id: string;
  changeType: string;
  changedBy: string | null;
  promptVersion: string | null;
  contentSnapshot: string;
  createdAt: string;
}

function WikiPageDetail({ slug, workspaceId }: { slug: string; workspaceId?: string }) {
  const [page, setPage] = useState<WikiPageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activeTab, setActiveTab] = useState<'content' | 'versions' | 'comments'>('content');
  const [comments, setComments] = useState<{ id: string; userId: string; content: string; resolved: boolean; createdAt: string }[]>([]);
  const [newComment, setNewComment] = useState('');
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [versionsLoaded, setVersionsLoaded] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    fetch(`/api/workspaces/${workspaceId}/wiki/by-slug/${slug}`, { credentials: 'include' })
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.json();
      })
      .then((d) => { if (d) setPage(d.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [workspaceId, slug]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  if (notFound || !page) {
    return (
      <div className="p-6">
        <Link to="/wiki" className="mb-4 flex items-center gap-1 text-sm text-primary-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to Wiki
        </Link>
        <p className="text-zinc-500">Page not found.</p>
      </div>
    );
  }

  const loadVersions = useCallback(() => {
    if (!workspaceId || versionsLoaded) return;
    fetch(`/api/workspaces/${workspaceId}/wiki/by-slug/${slug}/versions`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { setVersions(d.data || []); setVersionsLoaded(true); })
      .catch(() => {});
  }, [workspaceId, slug, versionsLoaded]);

  // Extract headings from content for TOC
  const headings = (page.content.match(/^#{1,3}\s+.+$/gm) || []).map((h) => {
    const level = h.match(/^(#+)/)?.[1].length || 1;
    const text = h.replace(/^#+\s+/, '');
    const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return { level, text, id };
  });

  return (
    <div className="flex gap-6 p-6">
      <div className="min-w-0 flex-1">
        {/* Breadcrumb */}
        <nav className="mb-4 flex items-center gap-1 text-sm text-zinc-400">
          <Link to="/wiki" className="hover:text-primary-600">Wiki</Link>
          <span>/</span>
          <span className="text-zinc-700 dark:text-zinc-300">{page.title}</span>
        </nav>

        <article className="mx-auto max-w-3xl">
        <div className="mb-4">
          <h1 className="text-3xl font-bold">{page.title}</h1>
          <div className="mt-2 flex items-center gap-2 text-sm text-zinc-500">
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">{page.pageType}</span>
            <span>Updated {new Date(page.updatedAt).toLocaleDateString()}</span>
          </div>
          {page.tags && page.tags.length > 0 && (
            <div className="mt-2 flex items-center gap-1">
              <Tag className="h-3 w-3 text-zinc-400" />
              {page.tags.map((tag) => (
                <span key={tag} className="rounded bg-primary-50 px-1.5 py-0.5 text-xs text-primary-600">
                  {tag}
                </span>
              ))}
            </div>
          )}
          {page.sources && page.sources.length > 0 && (
            <div className="mt-2 text-xs text-zinc-400">
              Based on: {page.sources.map((s) => s.title).join(', ')}
            </div>
          )}
        </div>

        <div className="mb-6 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
          <button
            onClick={() => setActiveTab('content')}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === 'content'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-zinc-500 hover:text-zinc-700',
            )}
          >
            Content
          </button>
          <button
            onClick={() => { setActiveTab('versions'); loadVersions(); }}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === 'versions'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-zinc-500 hover:text-zinc-700',
            )}
          >
            <History className="h-3.5 w-3.5" />
            History
          </button>
          <button
            onClick={() => {
              setActiveTab('comments');
              if (page && workspaceId) {
                fetch(`/api/workspaces/${workspaceId}/pages/${page.id}/comments`, { credentials: 'include' })
                  .then((r) => r.json())
                  .then((d) => setComments(d.data || []))
                  .catch(() => {});
              }
            }}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === 'comments'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-zinc-500 hover:text-zinc-700',
            )}
          >
            <MessageCircle className="h-3.5 w-3.5" />
            Comments
          </button>
        </div>

        {activeTab === 'comments' ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment... Use @username to mention"
                className="min-h-[80px]"
              />
              <Button
                size="icon"
                disabled={!newComment.trim()}
                onClick={async () => {
                  if (!page || !workspaceId || !newComment.trim()) return;
                  const mentions = [...newComment.matchAll(/@(\w+)/g)].map((m) => m[1]);
                  await fetch(`/api/workspaces/${workspaceId}/pages/${page.id}/comments`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ content: newComment, mentions }),
                  });
                  setNewComment('');
                  const res = await fetch(`/api/workspaces/${workspaceId}/pages/${page.id}/comments`, { credentials: 'include' });
                  const d = await res.json();
                  setComments(d.data || []);
                }}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            {comments.length === 0 ? (
              <p className="py-4 text-center text-sm text-zinc-500">No comments yet.</p>
            ) : (
              comments.map((comment) => (
                <div key={comment.id} className={cn('rounded-lg border p-3', comment.resolved ? 'border-zinc-200 opacity-60' : 'border-zinc-300')}>
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span>{comment.userId}</span>
                    <span>{new Date(comment.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-sm">{comment.content}</p>
                </div>
              ))
            )}
          </div>
        ) : activeTab === 'versions' ? (
          <div className="space-y-3">
            {!versionsLoaded ? (
              <div className="flex justify-center py-8">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
              </div>
            ) : versions.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500">No version history yet.</p>
            ) : (
              versions.map((v, idx) => {
                const nextVersion = idx < versions.length - 1 ? versions[idx + 1] : null;
                return (
                <div key={v.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-zinc-400" />
                      <span className="text-sm font-medium">
                        {v.changeType === 'llm_ingest' ? 'LLM Ingest' : v.changeType === 'llm_lint' ? 'LLM Lint' : 'Manual Edit'}
                      </span>
                      {v.promptVersion && (
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">
                          {v.promptVersion}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-zinc-400">{new Date(v.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <details>
                      <summary className="cursor-pointer text-xs text-zinc-500 hover:text-primary-600">
                        View snapshot ({v.contentSnapshot.length} chars)
                      </summary>
                      <pre className="mt-2 max-h-64 overflow-auto rounded bg-zinc-50 p-3 text-xs dark:bg-zinc-900">
                        {v.contentSnapshot}
                      </pre>
                    </details>
                    {nextVersion && (
                      <details>
                        <summary className="cursor-pointer text-xs text-zinc-500 hover:text-primary-600 flex items-center gap-1">
                          <GitCompare className="h-3 w-3" /> Diff
                        </summary>
                        <div className="mt-2 max-h-64 overflow-auto rounded bg-zinc-50 p-3 text-xs font-mono dark:bg-zinc-900">
                          {diffLines(nextVersion.contentSnapshot, v.contentSnapshot).map((part: Change, i: number) => (
                            <div
                              key={i}
                              className={
                                part.added ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' :
                                part.removed ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' :
                                'text-zinc-600 dark:text-zinc-400'
                              }
                            >
                              {part.value.split('\n').filter(Boolean).map((line: string, j: number) => (
                                <div key={j}>{part.added ? '+' : part.removed ? '-' : ' '} {line}</div>
                              ))}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
                );
              })
            )}
          </div>
        ) : (
        <div className="prose prose-zinc max-w-none dark:prose-invert">
          <ReactMarkdown
            components={{
              a: ({ href, children }) => {
                if (href?.startsWith('[[') && href.endsWith(']]')) {
                  const targetSlug = href.slice(2, -2);
                  return (
                    <Link to={`/wiki/${targetSlug}`} className="text-primary-600 hover:underline">
                      {children}
                    </Link>
                  );
                }
                return (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1">
                    {children} <ExternalLink className="h-3 w-3" />
                  </a>
                );
              },
            }}
          >
            {page.content.replace(/\[\[([^\]]+)\]\]/g, '[$1](/wiki/$1)')}
          </ReactMarkdown>
        </div>

        {(page.links.length > 0 || page.backlinks.length > 0) && (
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {page.links.length > 0 && (
              <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                <h3 className="mb-2 text-sm font-semibold text-zinc-500">Links to</h3>
                <div className="space-y-1">
                  {page.links.map((l) => (
                    <Link key={l.id} to={`/wiki/${l.slug}`} className="block text-sm text-primary-600 hover:underline">
                      {l.title}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {page.backlinks.length > 0 && (
              <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                <h3 className="mb-2 text-sm font-semibold text-zinc-500">Referenced by</h3>
                <div className="space-y-1">
                  {page.backlinks.map((l) => (
                    <Link key={l.id} to={`/wiki/${l.slug}`} className="block text-sm text-primary-600 hover:underline">
                      {l.title}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        )}
      </article>
      </div>

      {/* Side TOC */}
      {headings.length > 2 && (
        <aside className="hidden w-48 shrink-0 lg:block">
          <div className="sticky top-6">
            <h4 className="mb-2 text-xs font-semibold uppercase text-zinc-400">On this page</h4>
            <nav className="space-y-1">
              {headings.map((h) => (
                <a
                  key={h.id}
                  href={`#${h.id}`}
                  className="block truncate text-xs text-zinc-500 hover:text-primary-600"
                  style={{ paddingLeft: `${(h.level - 1) * 12}px` }}
                >
                  {h.text}
                </a>
              ))}
            </nav>
          </div>
        </aside>
      )}
    </div>
  );
}
