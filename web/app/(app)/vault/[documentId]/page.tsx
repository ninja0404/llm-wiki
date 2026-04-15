import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { VaultDocumentInspector } from "@/components/vault-document-inspector";
import { apiFetch } from "@/lib/api";

export default async function VaultDocumentPage({ params }: { params: Promise<{ documentId: string }> }) {
  const t = await getTranslations("vault");
  const { documentId } = await params;
  const [document, pages, blocks, revisions, references, citations] = await Promise.all([
    apiFetch<{ data: { id: string; path: string; title: string; kind: string; status: string; content_md: string | null } }>(`/v1/documents/${documentId}`).catch(() => ({ data: null })),
    apiFetch<{ data: { id: string; page_no: number; text_md: string }[] }>(`/v1/documents/${documentId}/pages`).catch(() => ({ data: [] })),
    apiFetch<{ data: { id: string; page_no: number; block_type: string; text: string }[] }>(`/v1/documents/${documentId}/blocks`).catch(() => ({ data: [] })),
    apiFetch<{ data: { id: string; actor_type: string; reason: string; created_at: string }[] }>(`/v1/documents/${documentId}/revisions`).catch(() => ({ data: [] })),
    apiFetch<{ data: { id: string; ref_type: string; target_path: string; target_title: string }[] }>(`/v1/documents/${documentId}/references`).catch(() => ({ data: [] })),
    apiFetch<{ data: { id: string; page_no: number | null; canonical_text: string | null; quote_text: string }[] }>(`/v1/documents/${documentId}/citations`).catch(() => ({ data: [] })),
  ]);

  if (!document.data) {
    return (
      <section className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
        <Link href="/vault" className="inline-flex items-center gap-1.5 -ml-2 px-2.5 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all"><ArrowLeft size={16} />{t("backToVault")}</Link>
        <h1 className="text-2xl font-bold text-slate-900">{t("notFound")}</h1>
        <p className="text-sm text-slate-500">{t("notFoundDesc")}</p>
      </section>
    );
  }

  return (
    <section className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <Link href="/vault" className="inline-flex items-center gap-1.5 -ml-2 px-2.5 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all"><ArrowLeft size={16} />{t("backToVault")}</Link>
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{document.data.title}</h1>
        <p className="text-sm text-slate-500 mt-1 font-mono">{document.data.path}</p>
      </div>
      <div className="border-b border-slate-200" />
      <VaultDocumentInspector documentId={documentId} initialDocument={document.data} initialPages={pages.data} initialBlocks={blocks.data} initialRevisions={revisions.data} initialReferences={references.data} initialCitations={citations.data} />
    </section>
  );
}
