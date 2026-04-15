import Link from "next/link";
import { Bot, Terminal, User } from "lucide-react";

import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/src/components/ui/table";
import { Badge } from "@/src/components/ui/badge";

const statusVariant: Record<string, "default" | "secondary" | "destructive"> = {
  succeeded: "default",
  failed: "destructive",
  queued: "secondary",
  running: "secondary",
};

const statusLabel: Record<string, string> = {
  succeeded: "Succeeded",
  failed: "Failed",
  queued: "Queued",
  running: "Running",
};

const actorIcon: Record<string, typeof User> = {
  human: User,
  agent: Bot,
  system: Terminal,
};

export default async function RunsPage() {
  const workspaces = await apiFetch<{ data: { id: string; name: string }[] }>("/v1/workspaces").catch(() => ({ data: [] }));
  const firstWorkspace = workspaces.data[0];
  const runs = firstWorkspace
    ? await apiFetch<{ data: { id: string; run_type: string; status: string; actor_type: string; error_message?: string | null; created_at: string }[] }>(
        `/v1/workspaces/${firstWorkspace.id}/runs`
      ).catch(() => ({ data: [] }))
    : { data: [] };

  return (
    <section className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Runs</h1>
        <p className="text-sm text-slate-500 mt-1">
          Compiler, ingest, lint, query, and agent-edit runs are fully traceable.
        </p>
      </div>
      <div className="border-b border-slate-200" />

      <Card className="shadow-sm ring-slate-200/80">
        <CardContent className="pt-0 -mt-2">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider w-28">Run</TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider w-28">Type</TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider w-28">Status</TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider w-24">Actor</TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider w-36">Created</TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24">
                    <div className="flex flex-col items-center justify-center gap-1.5 text-slate-400">
                      <Terminal size={24} strokeWidth={1.5} />
                      <p className="text-sm">No runs recorded yet</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                runs.data.map((run) => {
                  const ActorIcon = actorIcon[run.actor_type] ?? Terminal;
                  return (
                    <TableRow key={run.id} className="hover:bg-muted/50">
                      <TableCell>
                        <Link href={`/runs/${run.id}`} className="font-mono text-xs text-blue-600 hover:underline">
                          {run.id.slice(0, 8)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-slate-500">{run.run_type}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant[run.status] ?? "secondary"}>
                          {statusLabel[run.status] ?? run.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-slate-600 text-sm">
                          <ActorIcon size={13} className="text-slate-400" />
                          {run.actor_type.charAt(0).toUpperCase() + run.actor_type.slice(1)}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-slate-400">
                        {new Date(run.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </TableCell>
                      <TableCell className="max-w-[300px] truncate text-xs text-slate-500">
                        {run.error_message ?? "-"}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  );
}
