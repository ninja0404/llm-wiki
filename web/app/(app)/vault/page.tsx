import { getTranslations } from "next-intl/server";

import { apiFetch } from "@/lib/api";
import { VaultBrowser } from "@/components/vault-browser";

export default async function VaultPage() {
  const t = await getTranslations("vault");
  const workspaces = await apiFetch<{ data: { id: string; name: string }[] }>("/v1/workspaces").catch(() => ({ data: [] }));
  const firstWorkspace = workspaces.data[0];
  const documents = firstWorkspace
    ? await apiFetch<{ data: { id: string; path: string; kind: string; title: string; status: string }[] }>(`/v1/workspaces/${firstWorkspace.id}/documents`).catch(() => ({ data: [] }))
    : { data: [] };

  return (
    <section className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t("title")}</h1>
        <p className="text-sm text-slate-500 mt-1">{t("desc")}</p>
      </div>
      <div className="border-b border-slate-200" />
      <VaultBrowser documents={documents.data} />
    </section>
  );
}
