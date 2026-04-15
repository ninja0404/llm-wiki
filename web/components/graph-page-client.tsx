"use client";

import { useState } from "react";
import { GraphPanel } from "@/components/graph-panel";

interface Workspace { id: string; name: string; }

export function GraphPageClient({ workspaces }: { workspaces: Workspace[] }) {
  const [activeWsId, setActiveWsId] = useState(workspaces[0]?.id ?? "");
  const activeWs = workspaces.find((w) => w.id === activeWsId);

  return (
    <div className="space-y-4">
      {workspaces.length > 1 && (
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-slate-700">Workspace</label>
          <select
            value={activeWsId}
            onChange={(e) => setActiveWsId(e.target.value)}
            className="h-9 max-w-xs appearance-none rounded-lg border border-slate-200 bg-white pl-3.5 pr-8 text-sm font-medium text-slate-700"
            style={{ paddingRight: "2rem" }}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
      )}
      {activeWs && (
        <GraphPanel key={activeWsId} workspaceId={activeWsId} workspaceName={activeWs.name} />
      )}
    </div>
  );
}
