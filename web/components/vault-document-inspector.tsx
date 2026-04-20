"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FileText, GitBranch, Link2, MessageSquareQuote } from "lucide-react";
import { useTranslations } from "next-intl";

import { clientApiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/src/components/ui/table";
import { Badge } from "@/src/components/ui/badge";

interface DocumentDetail { id: string; path: string; title: string; kind: string; status: string; content_md: string | null; }
interface PageItem { id: string; page_no: number; text_md: string; }
interface BlockItem { id: string; page_no: number; block_type: string; text: string; }
interface RevisionItem { id: string; actor_type: string; reason: string; created_at: string; }
interface ReferenceItem { id: string; ref_type: string; target_path: string; target_title: string; }
interface CitationItem { id: string; page_no: number | null; canonical_text: string | null; quote_text: string; }

const statusStyle: Record<string, string> = {
  ready: "bg-emerald-50 text-emerald-700",
  queued: "bg-amber-50 text-amber-700",
  processing: "bg-blue-50 text-blue-700",
  failed: "bg-red-50 text-red-700",
};

function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="h-20">
        <p className="text-center text-sm text-slate-400">{message}</p>
      </TableCell>
    </TableRow>
  );
}

export function VaultDocumentInspector({
  documentId,
  initialDocument,
  initialPages,
  initialBlocks,
  initialRevisions,
  initialReferences,
  initialCitations,
}: {
  documentId: string;
  initialDocument: DocumentDetail;
  initialPages: PageItem[];
  initialBlocks: BlockItem[];
  initialRevisions: RevisionItem[];
  initialReferences: ReferenceItem[];
  initialCitations: CitationItem[];
}) {
  const [document, setDocument] = useState(initialDocument);
  const [pages, setPages] = useState(initialPages);
  const [blocks, setBlocks] = useState(initialBlocks);
  const [revisions, setRevisions] = useState(initialRevisions);
  const [references, setReferences] = useState(initialReferences);
  const [citations, setCitations] = useState(initialCitations);

  const t = useTranslations("doc");

  const shouldPoll = useMemo(
    () => document.kind === "source" && ["queued", "processing"].includes(document.status),
    [document.kind, document.status],
  );

  useEffect(() => {
    let disposed = false;
    async function refreshDetail() {
      const results = await Promise.all([
        clientApiFetch<{ data: DocumentDetail | null }>(`/v1/documents/${documentId}`).catch(() => ({ data: null })),
        clientApiFetch<{ data: PageItem[] }>(`/v1/documents/${documentId}/pages`).catch(() => ({ data: [] })),
        clientApiFetch<{ data: BlockItem[] }>(`/v1/documents/${documentId}/blocks`).catch(() => ({ data: [] })),
        clientApiFetch<{ data: RevisionItem[] }>(`/v1/documents/${documentId}/revisions`).catch(() => ({ data: [] })),
        clientApiFetch<{ data: ReferenceItem[] }>(`/v1/documents/${documentId}/references`).catch(() => ({ data: [] })),
        clientApiFetch<{ data: CitationItem[] }>(`/v1/documents/${documentId}/citations`).catch(() => ({ data: [] })),
      ]);
      if (disposed) return;
      if (results[0].data) setDocument(results[0].data);
      setPages(results[1].data ?? []);
      setBlocks(results[2].data ?? []);
      setRevisions(results[3].data ?? []);
      setReferences(results[4].data ?? []);
      setCitations(results[5].data ?? []);
    }
    if (!shouldPoll) return () => { disposed = true; };
    const timer = window.setInterval(refreshDetail, 2500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [documentId, shouldPoll]);

  return (
    <div className="space-y-6">
      {/* Metadata + Content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-sm ring-slate-200/80">
          <CardHeader>
            <CardTitle>{t("metadata")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">Kind</span>
              <Badge variant="secondary">{document.kind}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">Status</span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${statusStyle[document.status] ?? "bg-slate-100 text-slate-600"}`}>
                {document.status}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">Path</span>
              <span className="font-mono text-xs text-slate-700">{document.path}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm ring-slate-200/80">
          <CardHeader>
            <CardTitle>{t("latestContent")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-slate-900 text-slate-100 rounded-lg p-4 font-mono text-sm leading-relaxed overflow-auto max-h-64 whitespace-pre-wrap">
              {document.content_md || "(empty)"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pages + Blocks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-sm ring-slate-200/80">
          <CardHeader><CardTitle className="flex items-center gap-2"><FileText size={15} /> {t("pages")}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Page</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Excerpt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pages.length === 0 ? <EmptyRow colSpan={2} message={t("noPages")} /> : pages.map((page) => (
                  <TableRow key={page.id}>
                    <TableCell className="font-mono text-xs">{page.page_no}</TableCell>
                    <TableCell className="text-slate-600 text-xs">{page.text_md.slice(0, 160)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="shadow-sm ring-slate-200/80">
          <CardHeader><CardTitle className="flex items-center gap-2"><FileText size={15} /> {t("blocks")}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Page</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Text</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {blocks.length === 0 ? <EmptyRow colSpan={3} message={t("noBlocks")} /> : blocks.slice(0, 20).map((block) => (
                  <TableRow key={block.id}>
                    <TableCell className="font-mono text-xs">{block.page_no}</TableCell>
                    <TableCell><Badge variant="outline">{block.block_type}</Badge></TableCell>
                    <TableCell className="text-slate-600 text-xs">{block.text.slice(0, 120)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Revisions + References */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-sm ring-slate-200/80">
          <CardHeader><CardTitle className="flex items-center gap-2"><GitBranch size={15} /> {t("revisions")}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Actor</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {revisions.length === 0 ? <EmptyRow colSpan={2} message={t("noRevisions")} /> : revisions.map((rev) => (
                  <TableRow key={rev.id}>
                    <TableCell><Badge variant="secondary">{rev.actor_type}</Badge></TableCell>
                    <TableCell><Link href={`/revisions/${rev.id}`} className="text-blue-600 hover:underline text-sm">{rev.reason}</Link></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="shadow-sm ring-slate-200/80">
          <CardHeader><CardTitle className="flex items-center gap-2"><Link2 size={15} /> {t("references")}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Target</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {references.length === 0 ? <EmptyRow colSpan={2} message={t("noReferences")} /> : references.map((ref) => (
                  <TableRow key={ref.id}>
                    <TableCell><Badge variant="outline">{ref.ref_type}</Badge></TableCell>
                    <TableCell className="text-slate-600 text-sm">{ref.target_path ?? ref.target_title}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Citations */}
      {citations.length > 0 && (
        <Card className="shadow-sm ring-slate-200/80">
          <CardHeader><CardTitle className="flex items-center gap-2"><MessageSquareQuote size={15} /> {t("citations")}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Page</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Claim</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Quote</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {citations.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.page_no ?? "-"}</TableCell>
                    <TableCell className="text-slate-600 text-sm">{c.canonical_text ?? "-"}</TableCell>
                    <TableCell className="text-slate-600 text-xs">{c.quote_text.slice(0, 120)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
