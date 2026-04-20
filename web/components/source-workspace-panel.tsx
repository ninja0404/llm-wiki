"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FileText, FolderOpen } from "lucide-react";
import { useTranslations } from "next-intl";

import { clientApiFetch } from "@/lib/api";
import { RunStatusList } from "@/components/run-status-list";
import { SourceUploadForm } from "@/components/source-upload-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/src/components/ui/table";

interface SourceDocumentSummary {
  id: string;
  path: string;
  title: string;
  status: string;
}

interface RunSummary {
  id: string;
  run_type: string;
  status: string;
  actor_type: string;
  created_at: string;
}

const statusColor: Record<string, string> = {
  ready: "bg-emerald-50 text-emerald-700",
  queued: "bg-amber-50 text-amber-700",
  processing: "bg-blue-50 text-blue-700",
  failed: "bg-red-50 text-red-700",
  draft: "bg-slate-100 text-slate-600",
};

export function SourceWorkspacePanel({
  workspaceId,
  workspaceName,
  initialDocuments,
  initialRuns,
}: {
  workspaceId: string;
  workspaceName: string;
  initialDocuments: SourceDocumentSummary[];
  initialRuns: RunSummary[];
}) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [runs, setRuns] = useState(initialRuns);

  const hasActiveWork = useMemo(
    () =>
      documents.some((d) => ["queued", "processing"].includes(d.status)) ||
      runs.some((r) => ["queued", "running"].includes(r.status)),
    [documents, runs],
  );

  useEffect(() => {
    let disposed = false;
    async function refreshWorkspaceData() {
      const [docsRes, runsRes] = await Promise.all([
        clientApiFetch<{ data: SourceDocumentSummary[] }>(`/v1/workspaces/${workspaceId}/documents?kind=source`).catch(() => ({ data: [] })),
        clientApiFetch<{ data: RunSummary[] }>(`/v1/workspaces/${workspaceId}/runs`).catch(() => ({ data: [] })),
      ]);
      if (disposed) return;
      if (!disposed) setDocuments(docsRes.data ?? []);
      if (!disposed) setRuns(runsRes.data ?? []);
    }
    if (!hasActiveWork) return () => { disposed = true; };
    const timer = window.setInterval(refreshWorkspaceData, 2500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [hasActiveWork, workspaceId]);

  const t = useTranslations("sources");

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card size="sm" className="shadow-sm ring-slate-200/80">
          <CardContent className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-50 text-blue-600">
              <FolderOpen size={18} />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{t("workspace")}</p>
              <p className="text-lg font-bold text-slate-900">{workspaceName}</p>
            </div>
          </CardContent>
        </Card>
        <Card size="sm" className="shadow-sm ring-slate-200/80">
          <CardContent className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600">
              <FileText size={18} />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{t("sourceCount")}</p>
              <p className="text-lg font-bold text-slate-900">{documents.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Upload */}
      <SourceUploadForm workspaceId={workspaceId} />

      {/* Recent Runs */}
      <RunStatusList workspaceId={workspaceId} initialRuns={runs} />

      {/* Source Documents */}
      <Card className="shadow-sm ring-slate-200/80">
        <CardHeader>
          <CardTitle>Source Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Path</TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Title</TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="h-24">
                    <div className="flex flex-col items-center justify-center gap-1.5 text-slate-400">
                      <FileText size={24} strokeWidth={1.5} />
                      <p className="text-sm">{t("noDocs")}</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell>
                      <Link href={`/vault/${doc.id}`} className="text-blue-600 hover:underline font-medium text-sm">
                        {doc.path}
                      </Link>
                    </TableCell>
                    <TableCell className="text-slate-600">{doc.title}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${statusColor[doc.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {doc.status}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
