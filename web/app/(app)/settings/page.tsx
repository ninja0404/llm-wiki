import { getTranslations } from "next-intl/server";
import { apiFetch } from "@/lib/api";
import { SettingsPanel } from "@/components/settings-panel";

export default async function SettingsPage() {
  const t = await getTranslations("settings");
  const workspaces = await apiFetch<{ data: { id: string; name: string; slug: string; role: string }[] }>("/v1/workspaces").catch(() => ({ data: [] }));

  return (
    <section className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t("title")}</h1>
        <p className="text-sm text-slate-500 mt-1">{t("desc")}</p>
      </div>
      <div className="border-b border-slate-200" />
      <SettingsPanel workspaces={workspaces.data} />
    </section>
  );
}
