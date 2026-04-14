import { useState, useEffect, type FormEvent } from 'react';
import { Settings, Save, Loader2, Key, Bot } from 'lucide-react';
import { useWorkspaceStore } from '@/store/workspace';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export function SettingsView() {
  const { currentWorkspace } = useWorkspaceStore();
  const { user } = useAuthStore();
  const [systemPrompt, setSystemPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState('gpt-4o-mini');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [llmSaving, setLlmSaving] = useState(false);
  const [llmSaved, setLlmSaved] = useState(false);

  useEffect(() => {
    if (!currentWorkspace) return;
    fetch(`/api/workspaces/${currentWorkspace.id}/settings/llm-config`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d.data?.primary) {
          setProvider(d.data.primary.provider || 'openai');
          setModel(d.data.primary.model || 'gpt-4o-mini');
          setBaseUrl(d.data.primary.baseUrl || '');
          setHasApiKey(d.data.primary.hasApiKey || false);
        }
      })
      .catch(() => {});
  }, [currentWorkspace?.id]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!currentWorkspace) return;
    setSaving(true);
    setSaved(false);

    // TODO: PUT /api/workspaces/:id endpoint for updating workspace settings
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold">Settings</h1>

      <div className="mx-auto max-w-2xl space-y-6">
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <Settings className="h-5 w-5" />
            Workspace
          </h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">Name</span>
              <span className="font-medium">{currentWorkspace?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">ID</span>
              <span className="font-mono text-xs text-zinc-400">{currentWorkspace?.id}</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <Bot className="h-5 w-5" />
            LLM Configuration
          </h2>

          <form onSubmit={async (e) => {
            e.preventDefault();
            if (!currentWorkspace) return;
            setLlmSaving(true);
            try {
              await fetch(`/api/workspaces/${currentWorkspace.id}/settings/llm-config`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                  provider,
                  model,
                  ...(apiKey ? { apiKey } : {}),
                  baseUrl: baseUrl || undefined,
                }),
              });
              setLlmSaved(true);
              setApiKey('');
              setHasApiKey(true);
              setTimeout(() => setLlmSaved(false), 2000);
            } catch { /* ignore */ }
            setLlmSaving(false);
          }} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Provider</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-primary-500 dark:border-zinc-700 dark:bg-zinc-800"
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="custom">Custom (OpenAI-compatible)</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Model</label>
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={provider === 'openai' ? 'gpt-4o-mini' : provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'model-name'}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
                API Key {hasApiKey && <span className="text-xs text-green-600">(configured)</span>}
              </label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasApiKey ? '••••••••••••••••' : 'sk-...'}
              />
              <p className="mt-1 text-xs text-zinc-500">API key is encrypted before storage. Leave empty to keep existing key.</p>
            </div>

            {provider === 'custom' && (
              <div>
                <label className="mb-1 block text-sm font-medium">Base URL</label>
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.example.com/v1"
                />
              </div>
            )}

            <Button type="submit" disabled={llmSaving}>
              {llmSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {llmSaved ? 'Saved!' : 'Save LLM Config'}
            </Button>
          </form>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <Bot className="h-5 w-5" />
            System Prompt
          </h2>
          <form onSubmit={handleSave} className="space-y-4">
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Custom instructions for the LLM when generating wiki content..."
              className="min-h-[120px]"
            />
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saved ? 'Saved!' : 'Save Prompt'}
            </Button>
          </form>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <Key className="h-5 w-5" />
            Account
          </h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">Name</span>
              <span className="font-medium">{user?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Email</span>
              <span>{user?.email}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
