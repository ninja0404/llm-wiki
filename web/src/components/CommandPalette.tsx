import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { useNavigate } from 'react-router';
import { Search, Book, Upload, MessageSquare, Network, Activity, Settings } from 'lucide-react';

const routes = [
  { path: '/', label: 'Dashboard', icon: Search },
  { path: '/sources', label: 'Sources', icon: Upload },
  { path: '/wiki', label: 'Wiki', icon: Book },
  { path: '/search', label: 'Search', icon: Search },
  { path: '/chat', label: 'Chat', icon: MessageSquare },
  { path: '/graph', label: 'Graph', icon: Network },
  { path: '/activity', label: 'Activity', icon: Activity },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      <div className="fixed inset-0 bg-black/30" onClick={() => setOpen(false)} />
      <Command
        className="relative w-full max-w-lg rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        label="Command palette"
      >
        <Command.Input
          placeholder="Search pages, commands..."
          className="w-full border-b border-zinc-200 bg-transparent px-4 py-3 text-sm outline-none dark:border-zinc-700"
        />
        <Command.List className="max-h-64 overflow-auto p-2">
          <Command.Empty className="px-4 py-6 text-center text-sm text-zinc-500">
            No results found.
          </Command.Empty>
          <Command.Group heading="Navigate">
            {routes.map(({ path, label, icon: Icon }) => (
              <Command.Item
                key={path}
                value={label}
                onSelect={() => {
                  navigate(path);
                  setOpen(false);
                }}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-700 aria-selected:bg-primary-50 aria-selected:text-primary-700 dark:text-zinc-300"
              >
                <Icon className="h-4 w-4" />
                {label}
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
