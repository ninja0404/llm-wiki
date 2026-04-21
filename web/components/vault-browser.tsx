"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card, CardContent } from "@/src/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/src/components/ui/table";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";

interface VaultDocumentSummary {
  id: string;
  path: string;
  kind: string;
  title: string;
  status: string;
}

const kindVariant: Record<string, "secondary" | "outline"> = {
  source: "outline",
  wiki: "secondary",
  system: "secondary",
  asset: "outline",
};

const statusStyle: Record<string, string> = {
  ready: "bg-emerald-50 text-emerald-700 border-emerald-200",
  queued: "bg-amber-50 text-amber-700 border-amber-200",
  processing: "bg-blue-50 text-blue-700 border-blue-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  draft: "bg-slate-50 text-slate-600 border-slate-200",
};

function matchesQuery(document: VaultDocumentSummary, query: string) {
  if (!query) return true;
  const normalizedQuery = query.toLowerCase();
  return [document.path, document.title, document.kind, document.status]
    .some((value) => value.toLowerCase().includes(normalizedQuery));
}

export function VaultBrowser({
  documents,
}: {
  documents: VaultDocumentSummary[];
}) {
  const t = useTranslations("vault");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());

  const filteredDocuments = useMemo(
    () => documents.filter((document) => matchesQuery(document, deferredQuery)),
    [documents, deferredQuery],
  );

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="relative max-w-sm flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <Search size={14} className="text-slate-400" />
          </span>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search")}
            className="w-full h-9 rounded-lg border border-slate-200 bg-white pr-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            style={{ paddingLeft: "2.25rem" }}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => setQuery("")}
          disabled={!query}
        >
          {query ? t("clearFilter") : t("filter")}
        </Button>
      </div>
      <Card className="shadow-sm ring-slate-200/80">
        <CardContent className="pt-0 -mt-2">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("path")}</TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("kind")}</TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("title_col")}</TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-32">
                    <div className="flex flex-col items-center justify-center gap-1.5 text-slate-400">
                      <Search size={24} strokeWidth={1.5} />
                      <p className="text-sm">{t("noDocuments")}</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filteredDocuments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-32">
                    <div className="flex flex-col items-center justify-center gap-1.5 text-slate-400">
                      <Search size={24} strokeWidth={1.5} />
                      <p className="text-sm">{t("noMatches")}</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filteredDocuments.map((doc) => (
                <TableRow key={doc.id} className="hover:bg-muted/50 cursor-pointer">
                  <TableCell>
                    <Link href={`/vault/${doc.id}`} className="text-blue-600 hover:underline font-medium text-sm">
                      {doc.path}
                    </Link>
                  </TableCell>
                  <TableCell><Badge variant={kindVariant[doc.kind] ?? "outline"}>{doc.kind}</Badge></TableCell>
                  <TableCell className="text-slate-600">{doc.title}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${statusStyle[doc.status] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
                      {doc.status}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
