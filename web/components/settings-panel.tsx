"use client";

import { useEffect, useRef, useState, FormEvent, useCallback } from "react";
import { Check, Copy, Key, Plus, Server, Trash2, Shield } from "lucide-react";
import { useTranslations } from "next-intl";

import { clientApiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { Button } from "@/src/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/src/components/ui/table";
import { Badge } from "@/src/components/ui/badge";

interface ProviderPreset { id: string; label: string; baseUrl: string; defaultModel: string; }

const LLM_PROVIDERS: ProviderPreset[] = [
  { id: "openai", label: "OpenAI", baseUrl: "", defaultModel: "gpt-4.1-mini" },
  { id: "anthropic", label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", defaultModel: "claude-sonnet-4-20250514" },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat" },
  { id: "siliconflow", label: "SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1", defaultModel: "Qwen/Qwen2.5-72B-Instruct" },
  { id: "custom", label: "Custom", baseUrl: "", defaultModel: "" },
];

const EMBEDDING_PROVIDERS: ProviderPreset[] = [
  { id: "openai", label: "OpenAI", baseUrl: "", defaultModel: "text-embedding-3-small" },
  { id: "siliconflow", label: "SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1", defaultModel: "BAAI/bge-m3" },
  { id: "custom", label: "Custom", baseUrl: "", defaultModel: "" },
];

function ProviderSelect({ value, options, onChange }: { value: string; options: ProviderPreset[]; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value) ?? options[options.length - 1];
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="relative max-w-xs" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between h-9 w-full rounded-lg border border-slate-200 bg-white pl-3.5 pr-3 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-all"
      >
        <span>{selected.label}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg py-1 animate-in fade-in-0 zoom-in-95">
          {options.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onChange(p.id); setOpen(false); }}
              className={`flex items-center w-full px-3.5 py-2 text-sm transition-colors ${
                p.id === value
                  ? "bg-blue-50 text-blue-700 font-medium"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              {p.id === value && (
                <Check size={14} className="mr-2 text-blue-600" />
              )}
              <span className={p.id === value ? "" : "ml-[22px]"}>{p.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface Workspace { id: string; name: string; slug: string; role: string; }
interface CompilerRules { max_entities: number; min_confidence: number; text_truncation_limit: number; custom_instructions: string; }
interface SearchRules { default_limit: number; graph_boost_weight: number; min_score: number; enable_semantic: boolean; }
interface WorkspaceSettings {
  llm_provider: string;
  llm_model: string;
  llm_api_key_masked: string | null;
  llm_api_key_key_version: string | null;
  llm_base_url: string;
  embedding_provider: string;
  embedding_model: string;
  embedding_api_key_masked: string | null;
  embedding_api_key_key_version: string | null;
  embedding_base_url: string;
  compiler_rules: CompilerRules;
  search_rules: SearchRules;
}

const DEFAULT_COMPILER_RULES: CompilerRules = { max_entities: 20, min_confidence: 0.5, text_truncation_limit: 12000, custom_instructions: "" };
const DEFAULT_SEARCH_RULES: SearchRules = { default_limit: 20, graph_boost_weight: 0.15, min_score: 0, enable_semantic: true };
interface AgentToken { id: string; name: string; token_prefix: string; scope: string; last_used_at: string | null; created_at: string; }

const scopeColors: Record<string, string> = {
  read: "bg-slate-100 text-slate-700",
  write: "bg-blue-50 text-blue-700",
  admin: "bg-amber-50 text-amber-700",
};

export function SettingsPanel({ workspaces }: { workspaces: Workspace[] }) {
  const [activeWsId, setActiveWsId] = useState(workspaces[0]?.id ?? "");
  const activeWs = workspaces.find((w) => w.id === activeWsId);

  const t = useTranslations("settings");
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [tokens, setTokens] = useState<AgentToken[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [llmApiKeyInput, setLlmApiKeyInput] = useState("");
  const [embeddingApiKeyInput, setEmbeddingApiKeyInput] = useState("");

  const [newTokenName, setNewTokenName] = useState("");
  const [newTokenScope, setNewTokenScope] = useState("write");
  const [creatingToken, setCreatingToken] = useState(false);
  const [newTokenValue, setNewTokenValue] = useState("");
  const [copied, setCopied] = useState(false);

  const loadData = useCallback(async () => {
    if (!activeWsId) return;
    const [s, t] = await Promise.all([
      clientApiFetch<{ data: WorkspaceSettings }>(`/v1/workspaces/${activeWsId}/settings`).catch(() => ({ data: null })),
      clientApiFetch<{ data: AgentToken[] }>(`/v1/workspaces/${activeWsId}/agent-tokens`).catch(() => ({ data: [] })),
    ]);
    if (s.data) {
      s.data.compiler_rules = { ...DEFAULT_COMPILER_RULES, ...(s.data.compiler_rules || {}) };
      s.data.search_rules = { ...DEFAULT_SEARCH_RULES, ...(s.data.search_rules || {}) };
      setSettings(s.data);
      setLlmApiKeyInput("");
      setEmbeddingApiKeyInput("");
    }
    setTokens(t.data);
  }, [activeWsId]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleSaveSettings(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!settings || !activeWsId) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const payload = {
        ...settings,
        llm_api_key: llmApiKeyInput.trim() || null,
        embedding_api_key: embeddingApiKeyInput.trim() || null,
      };
      await clientApiFetch(`/v1/workspaces/${activeWsId}/settings`, { method: "PUT", body: JSON.stringify(payload) });
      setSaveMsg("Settings saved.");
      setLlmApiKeyInput("");
      setEmbeddingApiKeyInput("");
      await loadData();
    } catch (err: unknown) {
      setSaveMsg(err instanceof Error ? err.message : "Save failed");
    }
    setSaving(false);
    setTimeout(() => setSaveMsg(""), 3000);
  }

  async function handleCreateToken() {
    if (!newTokenName.trim() || !activeWsId) return;
    setCreatingToken(true);
    try {
      const res = await clientApiFetch<{ data: { token: string } }>(`/v1/workspaces/${activeWsId}/agent-tokens`, {
        method: "POST",
        body: JSON.stringify({ name: newTokenName.trim(), scope: newTokenScope }),
      });
      setNewTokenValue(res.data.token);
      setNewTokenName("");
      await loadData();
    } catch {}
    setCreatingToken(false);
  }

  async function handleRevoke(tokenId: string) {
    if (!activeWsId) return;
    await clientApiFetch(`/v1/workspaces/${activeWsId}/agent-tokens/${tokenId}`, { method: "DELETE" }).catch(() => {});
    await loadData();
  }

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const mcpUrl = typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:8080/mcp`
    : "http://localhost:8080/mcp";

  return (
    <div className="space-y-6">
      {/* Workspace Selector */}
      {workspaces.length > 1 && (
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-slate-700">Workspace</label>
          <select
            value={activeWsId}
            onChange={(e) => { setActiveWsId(e.target.value); setNewTokenValue(""); }}
            className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-sm"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Compiler Settings Form */}
      <Card className="shadow-sm ring-slate-200/80">
        <CardHeader>
          <CardTitle>{t("compiler")}</CardTitle>
          <CardDescription>{t("compilerDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {settings ? (
            <form className="space-y-5" onSubmit={handleSaveSettings}>
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{t("llmConfig")}</p>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">{t("provider")}</label>
                    <ProviderSelect
                      value={settings.llm_provider}
                      options={LLM_PROVIDERS}
                      onChange={(p) => {
                        const preset = LLM_PROVIDERS.find((x) => x.id === p);
                        setSettings({ ...settings, llm_provider: p, llm_base_url: preset?.baseUrl ?? settings.llm_base_url, llm_model: preset?.defaultModel ?? settings.llm_model });
                      }}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-slate-700">{t("model")}</label>
                      <Input value={settings.llm_model} onChange={(e) => setSettings({ ...settings, llm_model: e.target.value })} placeholder="gpt-4.1-mini" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-slate-700">{t("apiKey")}</label>
                      <Input
                        type="password"
                        value={llmApiKeyInput}
                        onChange={(e) => setLlmApiKeyInput(e.target.value)}
                        placeholder={settings.llm_api_key_masked ?? "Set a new API key"}
                      />
                      <p className="text-xs text-slate-400">
                        {settings.llm_api_key_key_version ? `Stored with key version ${settings.llm_api_key_key_version}` : "No API key stored"}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">{t("baseUrl")}</label>
                    <Input value={settings.llm_base_url} onChange={(e) => setSettings({ ...settings, llm_base_url: e.target.value })} placeholder={t("baseUrl")} />
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-5">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{t("embeddingConfig")}</p>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">{t("provider")}</label>
                    <ProviderSelect
                      value={settings.embedding_provider}
                      options={EMBEDDING_PROVIDERS}
                      onChange={(p) => {
                        const preset = EMBEDDING_PROVIDERS.find((x) => x.id === p);
                        setSettings({ ...settings, embedding_provider: p, embedding_base_url: preset?.baseUrl ?? settings.embedding_base_url, embedding_model: preset?.defaultModel ?? settings.embedding_model });
                      }}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-slate-700">{t("model")}</label>
                      <Input value={settings.embedding_model} onChange={(e) => setSettings({ ...settings, embedding_model: e.target.value })} placeholder="text-embedding-3-small" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-slate-700">{t("apiKey")}</label>
                      <Input
                        type="password"
                        value={embeddingApiKeyInput}
                        onChange={(e) => setEmbeddingApiKeyInput(e.target.value)}
                        placeholder={settings.embedding_api_key_masked ?? "Set a new API key"}
                      />
                      <p className="text-xs text-slate-400">
                        {settings.embedding_api_key_key_version ? `Stored with key version ${settings.embedding_api_key_key_version}` : "No API key stored"}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">{t("baseUrl")}</label>
                    <Input value={settings.embedding_base_url} onChange={(e) => setSettings({ ...settings, embedding_base_url: e.target.value })} placeholder={t("baseUrl")} />
                  </div>
                </div>
              </div>
              <div className="border-t border-slate-100 pt-5">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{t("compilerRules")}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">{t("maxEntities")}</label>
                    <Input type="number" min={5} max={50} value={settings.compiler_rules.max_entities} onChange={(e) => setSettings({ ...settings, compiler_rules: { ...settings.compiler_rules, max_entities: parseInt(e.target.value) || 20 } })} />
                    <p className="text-xs text-slate-400">{t("maxEntitiesDesc")}</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">{t("minConfidence")}</label>
                    <Input type="number" min={0} max={1} step={0.05} value={settings.compiler_rules.min_confidence} onChange={(e) => setSettings({ ...settings, compiler_rules: { ...settings.compiler_rules, min_confidence: parseFloat(e.target.value) || 0.5 } })} />
                    <p className="text-xs text-slate-400">{t("minConfidenceDesc")}</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">{t("textTruncation")}</label>
                    <Input type="number" min={4000} max={30000} step={1000} value={settings.compiler_rules.text_truncation_limit} onChange={(e) => setSettings({ ...settings, compiler_rules: { ...settings.compiler_rules, text_truncation_limit: parseInt(e.target.value) || 12000 } })} />
                    <p className="text-xs text-slate-400">{t("textTruncationDesc")}</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">{t("customInstructions")}</label>
                    <Input value={settings.compiler_rules.custom_instructions} onChange={(e) => setSettings({ ...settings, compiler_rules: { ...settings.compiler_rules, custom_instructions: e.target.value } })} placeholder={t("customInstructions")} />
                    <p className="text-xs text-slate-400">{t("customInstructionsDesc")}</p>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-5">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{t("searchRules")}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">{t("defaultLimit")}</label>
                    <Input type="number" min={5} max={50} value={settings.search_rules.default_limit} onChange={(e) => setSettings({ ...settings, search_rules: { ...settings.search_rules, default_limit: parseInt(e.target.value) || 20 } })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">{t("graphBoost")}</label>
                    <Input type="number" min={0} max={1} step={0.05} value={settings.search_rules.graph_boost_weight} onChange={(e) => setSettings({ ...settings, search_rules: { ...settings.search_rules, graph_boost_weight: parseFloat(e.target.value) || 0.15 } })} />
                    <p className="text-xs text-slate-400">{t("graphBoostDesc")}</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">{t("minScore")}</label>
                    <Input type="number" min={0} max={1} step={0.05} value={settings.search_rules.min_score} onChange={(e) => setSettings({ ...settings, search_rules: { ...settings.search_rules, min_score: parseFloat(e.target.value) || 0 } })} />
                    <p className="text-xs text-slate-400">{t("minScoreDesc")}</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">{t("enableSemantic")}</label>
                    <div className="flex items-center gap-2 h-8">
                      <button type="button" onClick={() => setSettings({ ...settings, search_rules: { ...settings.search_rules, enable_semantic: !settings.search_rules.enable_semantic } })}
                        className={`relative w-10 h-5 rounded-full transition-colors ${settings.search_rules.enable_semantic ? "bg-blue-600" : "bg-slate-300"}`}>
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${settings.search_rules.enable_semantic ? "translate-x-5" : ""}`} />
                      </button>
                      <span className="text-sm text-slate-600">{settings.search_rules.enable_semantic ? t("enabled") : t("disabled")}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
                  {saving ? t("saving") : t("save")}
                </Button>
                {saveMsg && (
                  <span className={`text-sm font-medium ${saveMsg.includes("failed") ? "text-red-600" : "text-emerald-600"}`}>
                    {saveMsg}
                  </span>
                )}
              </div>
            </form>
          ) : (
            <p className="text-sm text-slate-400">Loading settings…</p>
          )}
        </CardContent>
      </Card>

      {/* Agent Tokens */}
      <Card className="shadow-sm ring-slate-200/80">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Key size={15} /> Agent Tokens</CardTitle>
          <CardDescription>{t("agentTokensDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Create Token */}
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <label className="text-sm font-medium text-slate-700">{t("tokenName")}</label>
              <Input value={newTokenName} onChange={(e) => setNewTokenName(e.target.value)} placeholder={t("tokenName")} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">{t("scope")}</label>
              <div className="flex rounded-lg border border-slate-200 overflow-hidden h-8">
                {(["read", "write", "admin"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setNewTokenScope(s)}
                    className={`px-3 text-xs font-medium transition-colors border-r last:border-r-0 border-slate-200 ${
                      newTokenScope === s
                        ? "bg-blue-600 text-white"
                        : "bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <Button onClick={handleCreateToken} disabled={creatingToken || !newTokenName.trim()} className="bg-blue-600 hover:bg-blue-700 text-white">
              <Plus size={14} /> {t("create")}
            </Button>
          </div>

          {/* New Token Display */}
          {newTokenValue && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-2">
              <p className="text-sm font-semibold text-emerald-800">Token created! Copy it now — it won&apos;t be shown again.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-white px-3 py-2 text-xs font-mono text-slate-800 border border-emerald-200 break-all">
                  {newTokenValue}
                </code>
                <Button variant="outline" size="sm" onClick={() => handleCopy(newTokenValue)}>
                  {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                </Button>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setNewTokenValue("")} className="text-xs text-slate-500">
                Dismiss
              </Button>
            </div>
          )}

          {/* Token List */}
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("name")}</TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("prefix")}</TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("scope")}</TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("lastUsed")}</TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-20">
                    <div className="flex flex-col items-center justify-center gap-1.5 text-slate-400">
                      <Key size={22} strokeWidth={1.5} />
                      <p className="text-sm">{t("noTokens")}</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                tokens.map((tk) => (
                  <TableRow key={tk.id}>
                    <TableCell className="font-medium text-slate-700">{tk.name}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-500">{tk.token_prefix}…</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${scopeColors[tk.scope] ?? "bg-slate-100 text-slate-600"}`}>
                        {tk.scope}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{tk.last_used_at ? new Date(tk.last_used_at).toLocaleDateString() : t("never")}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon-xs" onClick={() => handleRevoke(tk.id)} title="Revoke token">
                        <Trash2 size={14} className="text-red-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* MCP Usage Guide */}
      <Card className="shadow-sm ring-slate-200/80">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Server size={15} /> {t("mcpConfig")}</CardTitle>
          <CardDescription>{t("mcpDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Endpoint</p>
              <code className="block rounded-lg bg-slate-900 text-slate-100 px-3 py-2 text-sm font-mono">{mcpUrl}</code>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Workspace ID</p>
              <code className="block rounded-lg bg-slate-900 text-slate-100 px-3 py-2 text-sm font-mono break-all">{activeWsId}</code>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Auth Header</p>
              <code className="block rounded-lg bg-slate-900 text-slate-100 px-3 py-2 text-sm font-mono">Bearer lwa_…</code>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
            <p className="text-sm font-semibold text-slate-700 flex items-center gap-2"><Shield size={14} /> {t("tokenScopes")}</p>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="space-y-0.5">
                <Badge variant="secondary">read</Badge>
                <p className="text-xs text-slate-500 mt-1">search, read, guide</p>
              </div>
              <div className="space-y-0.5">
                <Badge variant="secondary">write</Badge>
                <p className="text-xs text-slate-500 mt-1">read + create, replace, append, delete</p>
              </div>
              <div className="space-y-0.5">
                <Badge variant="secondary">admin</Badge>
                <p className="text-xs text-slate-500 mt-1">write + lint, settings</p>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-slate-700">{t("availableTools")}</p>
            <div className="flex flex-wrap gap-2">
              {["search", "read", "create", "replace", "append", "delete", "lint", "guide"].map((tool) => (
                <Badge key={tool} variant="outline">{tool}</Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
