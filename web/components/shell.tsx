"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, Bot, Database, FileText, FolderTree, LogOut, Network, Search, Settings, LucideIcon } from "lucide-react";
import { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  title: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { href: "/sources", title: "Sources", icon: FileText },
  { href: "/vault", title: "Vault Explorer", icon: FolderTree },
  { href: "/search", title: "Search", icon: Search },
  { href: "/graph", title: "Graph", icon: Network },
  { href: "/runs", title: "Runs", icon: Bot },
  { href: "/activity", title: "Activity", icon: Activity },
  { href: "/settings", title: "Settings", icon: Settings },
];

function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5 px-3 mt-1">
      {navItems.map(({ href, title, icon: Icon }) => {
        const isActive = pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all",
              isActive
                ? "bg-slate-100 text-slate-900"
                : "text-slate-500 hover:text-slate-900 hover:bg-slate-50",
            )}
          >
            <Icon size={16} className={cn(isActive ? "text-slate-700" : "text-slate-400")} />
            <span>{title}</span>
          </Link>
        );
      })}
    </nav>
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
      <span>Sign Out</span>
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
          <LogoutButton />
          <div className="px-4 py-2 text-xs text-slate-400">
            Agent-Native Knowledge Vault
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-auto bg-slate-50">{children}</main>
    </div>
  );
}
