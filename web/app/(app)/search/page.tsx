import { Search as SearchIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { apiFetch } from "@/lib/api";
import { Card, CardContent } from "@/src/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/src/components/ui/table";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";

const typeVariant: Record<string, "default" | "secondary" | "outline"> = { block: "outline", semantic_block: "outline", document: "secondary", entity: "default" };

function HighlightSnippet({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <span>{text}</span>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return <span>{parts.map((part, i) => part.toLowerCase() === query.toLowerCase() ? <mark key={i} className="bg-yellow-100 text-yellow-900 font-medium rounded px-0.5">{part}</mark> : part)}</span>;
}

export default async function SearchPage({ searchParams }: { searchParams?: Promise<{ q?: string }> }) {
  const t = await getTranslations("search");
  const params = (await searchParams) ?? {};
  const query = params.q?.trim() ?? "";
  const workspaces = await apiFetch<{ data: { id: string; name: string }[] }>("/v1/workspaces").catch(() => ({ data: [] }));
  const firstWorkspace = workspaces.data[0];
  const results = query && firstWorkspace
    ? await apiFetch<{ data: { id: string; result_type: string; path: string; page_no?: number | null; snippet: string; score: number }[] }>(`/v1/workspaces/${firstWorkspace.id}/search?q=${encodeURIComponent(query)}`).catch(() => ({ data: [] }))
    : { data: [] };

  return (
    <section className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t("title")}</h1>
        <p className="text-sm text-slate-500 mt-1">{t("desc")}</p>
      </div>
      <div className="border-b border-slate-200" />
      <form method="get" className="flex items-center gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"><SearchIcon size={15} className="text-slate-400" /></span>
          <input name="q" type="text" defaultValue={query} placeholder={t("placeholder")} className="w-full h-9 rounded-lg border border-slate-200 bg-white pr-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" style={{ paddingLeft: "2.25rem" }} />
        </div>
        <Button type="submit">{t("btn")}</Button>
      </form>
      {query ? (
        results.data.length > 0 ? (
          <Card className="shadow-sm ring-slate-200/80">
            <CardContent className="pt-0 -mt-2">
              <Table>
                <TableHeader><TableRow className="bg-slate-50/80">
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider w-[100px]">{t("type")}</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider w-[250px]">{t("path")}</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("snippet")}</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {results.data.map((r, i) => (
                    <TableRow key={`${r.id}-${r.result_type}-${i}`} className="hover:bg-muted/50">
                      <TableCell><Badge variant={typeVariant[r.result_type] ?? "outline"}>{r.result_type.replace("_", " ")}</Badge></TableCell>
                      <TableCell className="font-mono text-xs text-slate-500 break-all">{r.path}{r.page_no ? <span className="text-slate-400 ml-1">p.{r.page_no}</span> : null}</TableCell>
                      <TableCell className="text-sm text-slate-600 max-w-md"><div className="line-clamp-3"><HighlightSnippet text={r.snippet} query={query} /></div></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : (
          <Card className="shadow-sm"><CardContent className="flex flex-col items-center justify-center py-16 gap-2"><SearchIcon size={28} strokeWidth={1.5} className="text-slate-300" /><p className="text-sm text-slate-500">{t("noResults")} &ldquo;{query}&rdquo;</p></CardContent></Card>
        )
      ) : (
        <p className="text-sm text-slate-400 text-center py-8">{t("hint")}</p>
      )}
    </section>
  );
}
