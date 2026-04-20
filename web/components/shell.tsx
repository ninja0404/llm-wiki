"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, Bot, Database, FileText, FolderTree, Globe, LogOut, Network, Search, Settings, User, LucideIcon } from "lucide-react";
import { ReactNode, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { clientApiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  titleKey: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { href: "/sources", titleKey: "sources", icon: FileText },
  { href: "/vault", titleKey: "vault", icon: FolderTree },
  { href: "/search", titleKey: "search", icon: Search },
  { href: "/graph", titleKey: "graph", icon: Network },
  { href: "/runs", titleKey: "runs", icon: Bot },
  { href: "/activity", titleKey: "activity", icon: Activity },
  { href: "/settings", titleKey: "settings", icon: Settings },
];

function SidebarNav() {
  const pathname = usePathname();
  const t = useTranslations("nav");

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
  const t = useTranslations("common");
  const router = useRouter();

  function toggle() {
    const current = document.cookie.match(/llm-wiki-locale=(\w+)/)?.[1] ?? "en";
    const next = current === "en" ? "zh" : "en";
    document.cookie = `llm-wiki-locale=${next}; path=/; max-age=${60 * 60 * 24 * 365}`;
    router.refresh();
  }

  return (
    <button onClick={toggle} className="flex items-center gap-2 w-full px-6 py-2 text-xs font-medium text-slate-400 hover:text-slate-600 transition-all">
      <Globe size={13} />
      <span>{t("language")}</span>
    </button>
  );
}

function UserInfo() {
  const [email, setEmail] = useState("");

  useEffect(() => {
    clientApiFetch<{ data: { email: string } }>("/v1/auth/me")
      .then((d) => { if (d?.data?.email) setEmail(d.data.email); })
      .catch(() => null);
  }, []);

  if (!email) return null;

  return (
    <div className="flex items-center gap-2 px-6 py-2">
      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-slate-500 shrink-0">
        <User size={13} />
      </div>
      <span className="text-xs text-slate-500 truncate">{email}</span>
    </div>
  );
}

function LogoutButton() {
  const router = useRouter();
  const t = useTranslations("nav");

  function handleLogout() {
    document.cookie = "llm_wiki_session=; path=/; max-age=0";
    router.push("/login");
    router.refresh();
  }

  return (
    <button onClick={handleLogout} className="flex items-center gap-2.5 w-full px-6 py-2.5 text-sm font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 transition-all">
      <LogOut size={15} />
      <span>{t("signout")}</span>
    </button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations("nav");

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r border-slate-200 bg-white flex flex-col shrink-0 h-screen sticky top-0">
        <div className="flex items-center gap-2 px-5 py-5 text-sm font-bold text-slate-900 tracking-tight">
          <Database size={18} />
          <span>LLM Wiki</span>
        </div>
        <SidebarNav />
        <div className="mt-auto border-t border-slate-100">
          <UserInfo />
          <LanguageToggle />
          <LogoutButton />
          <div className="px-4 py-2 text-xs text-slate-400">{t("tagline")}</div>
        </div>
      </aside>
      <main className="flex-1 overflow-auto bg-slate-50">{children}</main>
    </div>
  );
}
