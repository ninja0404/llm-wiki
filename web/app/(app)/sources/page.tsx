import { Settings } from "lucide-react";

import { SourceWorkspacePanel } from "@/components/source-workspace-panel";
import { apiFetch } from "@/lib/api";

export default async function SourcesPage() {
  const workspaces = await apiFetch<{ data: { id: string; name: string }[] }>("/v1/workspaces").catch(() => ({ data: [] }));
  const firstWorkspace = workspaces.data[0];
  const documents = firstWorkspace
    ? await apiFetch<{ data: { id: string; path: string; title: string; status: string }[] }>(`/v1/workspaces/${firstWorkspace.id}/documents?kind=source`).catch(() => ({ data: [] }))
    : { data: [] };
  const runs = firstWorkspace
    ? await apiFetch<{ data: { id: string; run_type: string; status: string; actor_type: string; created_at: string }[] }>(`/v1/workspaces/${firstWorkspace.id}/runs`).catch(() => ({ data: [] }))
    : { data: [] };

  return (
    <section className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Sources</h1>
          <p className="text-sm text-slate-500 mt-1">
            Uploaded source documents that feed the compiler pipeline and agent citations.
          </p>
        </div>
        <a href="/settings" className="inline-flex items-center gap-2 h-9 px-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-all">
          <Settings size={15} />
          <span>Configure Workspace</span>
        </a>
      </header>

      <div className="border-b border-slate-200" />

      {firstWorkspace ? (
        <SourceWorkspacePanel
          workspaceId={firstWorkspace.id}
          workspaceName={firstWorkspace.name}
          initialDocuments={documents.data}
          initialRuns={runs.data}
        />
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-2">
          <p className="text-sm">No workspace found. Create one in Settings.</p>
        </div>
      )}
    </section>
  );
}
