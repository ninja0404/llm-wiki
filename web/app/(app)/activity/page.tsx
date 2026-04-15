import Link from "next/link";

import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/src/components/ui/table";
import { Badge } from "@/src/components/ui/badge";

function eventVariant(type: string): "default" | "secondary" | "outline" | "destructive" {
  if (type.includes("succeeded")) return "default";
  if (type.includes("failed")) return "destructive";
  if (type.includes("started")) return "secondary";
  return "outline";
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default async function ActivityPage() {
  const workspaces = await apiFetch<{ data: { id: string; name: string }[] }>("/v1/workspaces").catch(() => ({ data: [] }));
  const firstWorkspace = workspaces.data[0];
  const [activity, revisions] = firstWorkspace
    ? await Promise.all([
        apiFetch<{ data: { id: string; event_type: string; actor_type: string; actor_id: string | null; document_id?: string | null; document_path: string | null; run_id?: string | null; created_at: string }[] }>(
          `/v1/workspaces/${firstWorkspace.id}/activity`
        ).catch(() => ({ data: [] })),
        apiFetch<{ data: { id: string; path: string; reason: string; actor_type: string; created_at: string }[] }>(
          `/v1/workspaces/${firstWorkspace.id}/revisions`
        ).catch(() => ({ data: [] })),
      ])
    : [{ data: [] }, { data: [] }];

  return (
    <section className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Activity / Revisions</h1>
        <p className="text-sm text-slate-500 mt-1">
          Every wiki mutation is revisioned and attributable to human, agent, or system actors.
        </p>
      </div>
      <div className="border-b border-slate-200" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Activity Events */}
        <Card className="shadow-sm ring-slate-200/80">
          <CardHeader>
            <CardTitle>Activity Events</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider w-[140px]">Event</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider w-[60px]">Actor</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Path</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider w-[80px] text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activity.data.map((item) => (
                  <TableRow key={item.id} className="hover:bg-muted/50">
                    <TableCell>
                      <Badge variant={eventVariant(item.event_type)}>{item.event_type}</Badge>
                    </TableCell>
                    <TableCell className="text-slate-500 text-sm">
                      {item.actor_type.charAt(0).toUpperCase() + item.actor_type.slice(1)}
                    </TableCell>
                    <TableCell className="max-w-[150px] truncate font-mono text-xs text-blue-600">
                      {item.document_id && item.document_path ? (
                        <Link href={`/vault/${item.document_id}`}>{item.document_path}</Link>
                      ) : (
                        <span className="text-slate-400">{item.document_path ?? "-"}</span>
                      )}
                      {item.run_id ? (
                        <> · <Link href={`/runs/${item.run_id}`} className="text-slate-400 hover:text-blue-600">run</Link></>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs text-slate-400 text-right whitespace-nowrap">
                      {formatTime(item.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Recent Revisions */}
        <Card className="shadow-sm ring-slate-200/80">
          <CardHeader>
            <CardTitle>Recent Revisions</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider w-[200px]">Path</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Reason</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider w-[60px]">Actor</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider w-[80px] text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {revisions.data.map((revision) => (
                  <TableRow key={revision.id} className="hover:bg-muted/50">
                    <TableCell className="max-w-[200px] truncate font-mono text-xs">
                      <Link href={`/revisions/${revision.id}`} className="text-blue-600 hover:underline">{revision.path}</Link>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">{revision.reason}</TableCell>
                    <TableCell className="text-slate-500 text-sm">
                      {revision.actor_type.charAt(0).toUpperCase() + revision.actor_type.slice(1)}
                    </TableCell>
                    <TableCell className="text-xs text-slate-400 text-right whitespace-nowrap">
                      {formatTime(revision.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
