"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Database } from "lucide-react";
import { useTranslations } from "next-intl";

import { clientApiFetch } from "@/lib/api";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await clientApiFetch(`/v1/auth/${mode === "login" ? "login" : "register"}`, {
        method: "POST",
        body: JSON.stringify(
          mode === "login"
            ? { email, password }
            : { email, password, display_name: displayName }
        ),
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Authentication failed");
      setSubmitting(false);
      return;
    }
    router.push("/sources");
    router.refresh();
  }

  const t = useTranslations("login");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2.5 mb-2">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600 text-white">
          <Database size={18} />
        </div>
        <span className="text-lg font-bold text-slate-900 tracking-tight">{t("title")}</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          {mode === "login" ? t("welcome") : t("register")}
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">
          {t("subtitle")}
        </p>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        {mode === "register" && (
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700" htmlFor="displayName">
              {t("displayName")}
            </label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              required
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            />
          </div>
        )}

        <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700" htmlFor="email">
            {t("email")}
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            required
            className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-slate-700" htmlFor="password">
              {t("password")}
            </label>
            {mode === "login" && (
              <button type="button" className="text-xs font-medium text-blue-600 hover:text-blue-700">
                {t("forgot")}
              </button>
            )}
          </div>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            minLength={8}
            required
            className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
          />
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3.5 py-2.5 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          {submitting ? t("signing") : mode === "login" ? t("signin") : t("createAccount")}
        </button>
      </form>

      {mode === "login" && (
        <>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-3 text-slate-500">{t("or")}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              className="flex items-center justify-center gap-2 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-all"
            >
              <GoogleIcon />
              Google
            </button>
            <button
              type="button"
              className="flex items-center justify-center gap-2 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-all"
            >
              <GitHubIcon />
              GitHub
            </button>
          </div>
        </>
      )}

      <p className="text-center text-sm text-slate-500">
        {mode === "login" ? (
          <>
            {t("noAccount")}{" "}
            <button type="button" onClick={() => setMode("register")} className="font-semibold text-blue-600 hover:text-blue-700">
              {t("signup")}
            </button>
          </>
        ) : (
          <>
            {t("hasAccount")}{" "}
            <button type="button" onClick={() => setMode("login")} className="font-semibold text-blue-600 hover:text-blue-700">
              {t("signinLink")}
            </button>
          </>
        )}
      </p>
    </div>
  );
}
