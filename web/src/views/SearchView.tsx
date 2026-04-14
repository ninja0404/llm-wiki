import { useState, type FormEvent } from 'react';
import { Search, Book } from 'lucide-react';
import { Link } from 'react-router';
import { useWorkspaceStore } from '@/store/workspace';

interface SearchHit {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  pageType: string;
}

export function SearchView() {
  const { currentWorkspace } = useWorkspaceStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [indexingInProgress, setIndexingInProgress] = useState(false);

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!query.trim() || !currentWorkspace) return;

    setLoading(true);
    try {
      const res = await fetch(
        `/api/workspaces/${currentWorkspace.id}/search?q=${encodeURIComponent(query)}`,
        { credentials: 'include' },
      );
      if (res.ok) {
        const data = await res.json();
        setResults(data.data.pages);
        setIndexingInProgress(data.data.indexingInProgress || false);
      }
    } catch {
      // ignore
    } finally {
      setSearched(true);
      setLoading(false);
    }
  }

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold">Search</h1>

      <form onSubmit={handleSearch} className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Search wiki pages..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl border border-zinc-300 py-3 pl-10 pr-4 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-zinc-700 dark:bg-zinc-800"
          />
        </div>
      </form>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
        </div>
      ) : searched && results.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500">No results found for "{query}"</p>
        </div>
      ) : results.length > 0 ? (
        <div className="space-y-2">
          {indexingInProgress && (
            <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Some pages are still being indexed. Results may be incomplete.
            </div>
          )}
          {results.map((hit) => (
            <Link
              key={hit.id}
              to={`/wiki/${hit.slug}`}
              className="block rounded-xl border border-zinc-200 bg-white px-5 py-4 transition-colors hover:border-primary-300 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center gap-2">
                <Book className="h-4 w-4 text-zinc-400" />
                <span className="font-medium">{hit.title}</span>
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">
                  {hit.pageType}
                </span>
              </div>
              {hit.summary && <p className="mt-1 text-sm text-zinc-500">{hit.summary}</p>}
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500">Type a query to search across your wiki.</p>
        </div>
      )}
    </div>
  );
}
