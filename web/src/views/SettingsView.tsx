import { useState, useEffect, type FormEvent } from 'react';
import { Settings, Save, Loader2, Key, Bot } from 'lucide-react';
import { useWorkspaceStore } from '@/store/workspace';
import { useAuthStore } from '@/store/auth';

export function SettingsView() {
  const { currentWorkspace } = useWorkspaceStore();
  const { user } = useAuthStore();
  const [systemPrompt, setSystemPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!currentWorkspace) return;
    fetch(`/api/workspaces/${currentWorkspace.id}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        setSystemPrompt(d.data.systemPrompt || '');
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
          <p className="mb-4 text-sm text-zinc-500">
            Configure the LLM provider and system prompt for this workspace.
            Set your OpenAI API key in the server .env file.
          </p>

          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">System Prompt (optional)</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Custom instructions for the LLM when generating wiki content..."
                className="min-h-[120px] w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-primary-500 dark:border-zinc-700 dark:bg-zinc-800"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saved ? 'Saved!' : 'Save'}
            </button>
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
