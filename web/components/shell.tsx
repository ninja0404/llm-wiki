"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, Bot, Database, FileText, FolderTree, Globe, LogOut, Network, Search, Settings, LucideIcon } from "lucide-react";
import { ReactNode, useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { t, getLocale, setLocale, initLocale, Locale } from "@/lib/i18n";

interface NavItem {
  href: string;
  titleKey: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { href: "/sources", titleKey: "nav.sources", icon: FileText },
  { href: "/vault", titleKey: "nav.vault", icon: FolderTree },
  { href: "/search", titleKey: "nav.search", icon: Search },
  { href: "/graph", titleKey: "nav.graph", icon: Network },
  { href: "/runs", titleKey: "nav.runs", icon: Bot },
  { href: "/activity", titleKey: "nav.activity", icon: Activity },
  { href: "/settings", titleKey: "nav.settings", icon: Settings },
];

function SidebarNav() {
  const pathname = usePathname();
  const [, forceUpdate] = useState(0);

  useEffect(() => { initLocale(); forceUpdate((n) => n + 1); }, []);

  return (
    <nav className="flex flex-col gap-0.5 px-3 mt-1">
      {navItems.map(({ href, titleKey, icon: Icon }) => {
        const isActive = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all",
              isActive ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50",
            )}
          >
            <Icon size={16} className={cn(isActive ? "text-slate-700" : "text-slate-400")} />
            <span>{t(titleKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function LanguageToggle() {
  const [locale, setCurrentLocale] = useState<Locale>("en");
  const [, forceUpdate] = useState(0);

  useEffect(() => { setCurrentLocale(initLocale()); }, []);

  function toggle() {
    const next: Locale = locale === "en" ? "zh" : "en";
    setLocale(next);
    setCurrentLocale(next);
    forceUpdate((n) => n + 1);
    window.location.reload();
  }

  return (
    <button onClick={toggle} className="flex items-center gap-2 w-full px-6 py-2 text-xs font-medium text-slate-400 hover:text-slate-600 transition-all">
      <Globe size={13} />
      <span>{locale === "en" ? "中文" : "English"}</span>
    </button>
  );
}

function LogoutButton() {
  const router = useRouter();

  function handleLogout() {
    document.cookie = "llm_wiki_session=; path=/; max-age=0";
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className="flex items-center gap-2.5 w-full px-6 py-2.5 text-sm font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 transition-all"
    >
      <LogOut size={15} />
      <span>{t("nav.signout")}</span>
    </button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r border-slate-200 bg-white flex flex-col shrink-0">
        <div className="flex items-center gap-2 px-5 py-5 text-sm font-bold text-slate-900 tracking-tight">
          <Database size={18} />
          <span>LLM Wiki</span>
        </div>
        <SidebarNav />
        <div className="mt-auto border-t border-slate-100">
          <LanguageToggle />
          <LogoutButton />
          <div className="px-4 py-2 text-xs text-slate-400">
            {t("nav.tagline")}
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-auto bg-slate-50">{children}</main>
    </div>
  );
}
