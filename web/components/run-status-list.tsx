"use client";

import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { useTranslations } from "next-intl";

import { getApiUrl } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/src/components/ui/table";

interface RunSummary {
  id: string;
  run_type: string;
  status: string;
  actor_type: string;
  error_message?: string | null;
  created_at: string;
}

const statusColor: Record<string, string> = {
  queued: "bg-amber-50 text-amber-700",
  running: "bg-blue-50 text-blue-700",
  succeeded: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
};

export function RunStatusList({ workspaceId, initialRuns }: { workspaceId: string; initialRuns: RunSummary[] }) {
  const [runs, setRuns] = useState(initialRuns);

  useEffect(() => {
    let disposed = false;
    async function loadRuns() {
      const response = await fetch(`${getApiUrl()}/v1/workspaces/${workspaceId}/runs`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok || disposed) return;
      const payload = await response.json().catch(() => ({ data: [] }));
      if (!disposed) setRuns(payload.data ?? []);
    }
    const timer = window.setInterval(loadRuns, 3000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [workspaceId]);

  const t = useTranslations("runs");

  return (
    <Card className="shadow-sm ring-slate-200/80">
      <CardHeader>
        <CardTitle>{t("recentRuns")}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/80">
              <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("run")}</TableHead>
              <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("type")}</TableHead>
              <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("status")}</TableHead>
              <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("actor")}</TableHead>
              <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("time")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32">
                  <div className="flex flex-col items-center justify-center gap-2 text-slate-400">
                    <Bot size={28} strokeWidth={1.5} />
                    <p className="text-sm">{t("noRecentRuns")}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="font-mono text-xs text-slate-500">{run.id.slice(0, 8)}…</TableCell>
                  <TableCell className="text-slate-600">{run.run_type}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${statusColor[run.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {run.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-slate-600">{run.actor_type}</TableCell>
                  <TableCell className="text-xs text-slate-400">
                    {new Date(run.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
