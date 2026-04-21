import Link from "next/link";

import { MarkdownContent } from "@/components/markdown-content";
import { PageFrame } from "@/components/page-frame";
import { apiFetch } from "@/lib/api";

export default async function RevisionDetailPage({
  params
}: {
  params: Promise<{ revisionId: string }>;
}) {
  const { revisionId } = await params;
  const revision = await apiFetch<{
    data: {
      id: string;
      path: string;
      title: string;
      actor_type: string;
      actor_id: string | null;
      run_id: string | null;
      reason: string;
      content_md: string;
      previous_revision_id: string | null;
      previous_content_md: string | null;
      diff_summary: Record<string, unknown>;
    } | null;
  }>(`/v1/revisions/${revisionId}`).catch(() => ({ data: null }));
  const diff = await apiFetch<{
    data: {
      stats: { added: number; removed: number; before_lines: number; after_lines: number };
      lines: { type: "context" | "added" | "removed"; text: string }[];
    };
  }>(`/v1/revisions/${revisionId}/diff`).catch(() => ({
    data: {
      stats: { added: 0, removed: 0, before_lines: 0, after_lines: 0 },
      lines: []
    }
  }));

  if (!revision.data) {
    return (
      <PageFrame title="Revision Not Found" description="The requested revision does not exist or is not accessible.">
        <div className="panel">
          <Link href="/activity">Back to Activity</Link>
        </div>
      </PageFrame>
    );
  }

  return (
    <PageFrame title={`Revision ${revisionId}`} description={revision.data.path}>
      <div className="card-grid">
        <div className="panel">
          <h2>Metadata</h2>
          <div className="code-block">
            {JSON.stringify(
              {
                title: revision.data.title,
                actor_type: revision.data.actor_type,
                actor_id: revision.data.actor_id,
                run_id: revision.data.run_id,
                reason: revision.data.reason,
                previous_revision_id: revision.data.previous_revision_id,
                diff_summary: revision.data.diff_summary
              },
              null,
              2
            )}
          </div>
        </div>
        <div className="panel">
          <h2>Links</h2>
          <div className="stack">
            <Link href="/activity">Back to Activity</Link>
            {revision.data.run_id ? <Link href={`/runs/${revision.data.run_id}`}>Open Run</Link> : null}
          </div>
        </div>
      </div>
      <div className="panel">
        <h2>Line Diff</h2>
        <div className="flex gap-3 mb-3">
          <span className="badge badge-success">+{diff.data.stats.added}</span>
          <span className="badge badge-error">-{diff.data.stats.removed}</span>
          <span className="badge badge-default">{diff.data.stats.before_lines} → {diff.data.stats.after_lines} lines</span>
        </div>
        <div className="rounded-md border border-border overflow-auto max-h-96 text-xs font-mono">
          {diff.data.lines.map((line, index) => (
            <div
              key={`${line.type}-${index}`}
              className={
                line.type === "added" ? "bg-green-50 text-green-800 px-3 py-0.5" :
                line.type === "removed" ? "bg-red-50 text-red-800 px-3 py-0.5" :
                "px-3 py-0.5 text-slate-600"
              }
            >
              {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "} {line.text}
            </div>
          ))}
        </div>
      </div>
      <div className="card-grid">
        <div className="panel">
          <h2>Current Content</h2>
          <MarkdownContent content={revision.data.content_md} className="max-h-96 overflow-auto rounded-lg border border-slate-200 bg-white p-4" />
        </div>
        <div className="panel">
          <h2>Previous Content</h2>
          <MarkdownContent content={revision.data.previous_content_md ?? "(no previous revision)"} className="max-h-96 overflow-auto rounded-lg border border-slate-200 bg-white p-4" />
        </div>
      </div>
    </PageFrame>
  );
}
