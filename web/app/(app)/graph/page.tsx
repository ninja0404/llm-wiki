import { getTranslations } from "next-intl/server";
import { apiFetch } from "@/lib/api";
import { GraphPageClient } from "@/components/graph-page-client";

export default async function GraphPage() {
  const t = await getTranslations("graph");
  const workspaces = await apiFetch<{ data: { id: string; name: string }[] }>("/v1/workspaces").catch(() => ({ data: [] }));

  return (
    <section className="p-6 lg:p-8 max-w-[1400px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t("title")}</h1>
        <p className="text-sm text-slate-500 mt-1">{t("desc")}</p>
      </div>
      <div className="border-b border-slate-200" />
      {workspaces.data.length > 0 ? (
        <GraphPageClient workspaces={workspaces.data} />
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-2">
          <p className="text-sm">{t("noData")}</p>
        </div>
      )}
    </section>
  );
}
