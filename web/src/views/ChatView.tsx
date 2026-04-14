import { useState, useEffect, useRef, type FormEvent } from 'react';
import { Send, MessageSquare, Plus, Loader2, BookPlus, Trash2, Copy, Check, Bot, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useWorkspaceStore } from '@/store/workspace';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Conversation {
  id: string;
  title: string | null;
  updatedAt: string;
}

interface Citation {
  wikiPageId: string;
  wikiPageTitle: string;
  excerpt: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[] | null;
  createdAt: string;
}

export function ChatView() {
  const { currentWorkspace } = useWorkspaceStore();
  const { user } = useAuthStore();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [streamCitations, setStreamCitations] = useState<Citation[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!currentWorkspace) return;
    fetch(`/api/workspaces/${currentWorkspace.id}/chat/conversations`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setConversations(d.data))
      .catch(() => {});
  }, [currentWorkspace?.id]);

  useEffect(() => {
    if (!currentConvId || !currentWorkspace) return;
    fetch(`/api/workspaces/${currentWorkspace.id}/chat/conversations/${currentConvId}/messages`, {
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((d) => setMessages(d.data))
      .catch(() => {});
  }, [currentConvId, currentWorkspace?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamContent]);

  async function createConversation() {
    if (!currentWorkspace) return;
    const res = await fetch(`/api/workspaces/${currentWorkspace.id}/chat/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ title: 'New conversation' }),
    });
    if (res.ok) {
      const { data } = await res.json();
      setConversations((prev) => [data, ...prev]);
      setCurrentConvId(data.id);
      setMessages([]);
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || !currentWorkspace || streaming) return;

    let convId = currentConvId;
    if (!convId) {
      const res = await fetch(`/api/workspaces/${currentWorkspace.id}/chat/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: input.slice(0, 50) }),
      });
      if (!res.ok) return;
      const { data } = await res.json();
      convId = data.id;
      setCurrentConvId(data.id);
      setConversations((prev) => [data, ...prev]);
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    const question = input;
    setInput('');
    setStreaming(true);
    setStreamContent('');

    try {
      const res = await fetch(
        `/api/workspaces/${currentWorkspace.id}/chat/conversations/${convId}/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ message: question }),
        },
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || errData.error || `Request failed (${res.status})`);
      }
      if (!res.body) throw new Error('No response stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.error) {
              throw new Error(parsed.error);
            }
            if (parsed.text) {
              accumulated += parsed.text;
              setStreamContent(accumulated);
            }
            if (parsed.citations) {
              setStreamCitations(parsed.citations);
            }
          } catch {
            // skip malformed
          }
        }
      }

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: accumulated,
        citations: streamCitations.length > 0 ? streamCitations : null,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setStreamContent('');
      setStreamCitations([]);
    } catch (err) {
      const errorMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `⚠️ Error: ${err instanceof Error ? err.message : 'Failed to get response'}. Please check your LLM API Key in Settings.`,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
      setStreamContent('');
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex h-full">
      <div className="flex w-56 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50">
        <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-3 dark:border-zinc-800">
          <span className="text-sm font-semibold">Chats</span>
          <button
            onClick={createConversation}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-2">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={cn(
                'group mb-1 flex items-center rounded-lg',
                currentConvId === conv.id
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-zinc-600 hover:bg-zinc-100',
              )}
            >
              <button
                onClick={() => setCurrentConvId(conv.id)}
                className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm"
              >
                {conv.title || 'Untitled'}
              </button>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  if (!currentWorkspace) return;
                  await fetch(`/api/workspaces/${currentWorkspace.id}/chat/conversations/${conv.id}`, {
                    method: 'DELETE',
                    credentials: 'include',
                  });
                  setConversations((prev) => prev.filter((c) => c.id !== conv.id));
                  if (currentConvId === conv.id) setCurrentConvId(null);
                }}
                className="hidden p-1 text-zinc-400 hover:text-red-500 group-hover:block"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col">
        <div className="flex-1 overflow-auto p-6">
          {messages.length === 0 && !streaming ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-zinc-400">
                <MessageSquare className="h-12 w-12" />
                <p className="text-sm">Start a conversation to query your wiki</p>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-2xl space-y-4">
              {messages.map((msg) => (
                <div key={msg.id} className={cn('group flex gap-3', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
                  <div className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                    msg.role === 'user' ? 'bg-primary-600 text-white' : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300',
                  )}>
                    {msg.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                  </div>
                  <div className="max-w-[80%]">
                    <div className={cn('mb-1 flex items-center gap-2 text-[10px] text-zinc-400', msg.role === 'user' ? 'justify-end' : '')}>
                      <span>{msg.role === 'user' ? (user?.name || 'You') : 'AI Assistant'}</span>
                      <span>{new Date(msg.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <div
                      className={cn(
                        'relative rounded-2xl px-4 py-3 text-sm',
                        msg.role === 'user'
                          ? 'bg-primary-600 text-white'
                          : 'bg-zinc-100 dark:bg-zinc-800',
                      )}
                    >
                    {msg.role === 'assistant' ? (
                      <div>
                        <div className="prose prose-sm max-w-none dark:prose-invert">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                        {msg.citations && msg.citations.length > 0 && (
                          <div className="mt-2 space-y-1 border-t border-zinc-200 pt-2 dark:border-zinc-700">
                            <div className="text-[10px] font-medium text-zinc-400">Sources:</div>
                            {msg.citations.map((c, i) => (
                              <a
                                key={i}
                                href={`/wiki/${c.wikiPageId}`}
                                className="block rounded border border-zinc-200 px-2 py-1 text-[11px] text-primary-600 hover:bg-primary-50 dark:border-zinc-700"
                              >
                                {c.wikiPageTitle}
                                {c.excerpt && <span className="ml-1 text-zinc-400">— {c.excerpt}</span>}
                              </a>
                            ))}
                          </div>
                        )}
                        <button
                          onClick={async () => {
                            if (!currentWorkspace) return;
                            const title = prompt('Enter page title:');
                            if (!title) return;
                            const res = await fetch(`/api/workspaces/${currentWorkspace.id}/wiki`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              credentials: 'include',
                              body: JSON.stringify({ title, content: msg.content }),
                            });
                            if (res.ok) alert('Saved as wiki page!');
                            else alert('Failed to save');
                          }}
                          className="mt-2 flex items-center gap-1 text-[11px] text-zinc-400 hover:text-primary-600"
                        >
                          <BookPlus className="h-3 w-3" /> Save as Wiki page
                        </button>
                      </div>
                    ) : (
                      msg.content
                    )}
                    </div>
                    {msg.role === 'assistant' && (
                      <div className="mt-1 flex justify-end">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(msg.content);
                            setCopiedId(msg.id);
                            setTimeout(() => setCopiedId(null), 2000);
                          }}
                          className="hidden items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-600 group-hover:flex"
                        >
                          {copiedId === msg.id ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {streaming && streamContent && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-2xl bg-zinc-100 px-4 py-3 text-sm dark:bg-zinc-800">
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                      <ReactMarkdown>{streamContent}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              )}
              {streaming && !streamContent && (
                <div className="flex justify-start">
                  <div className="rounded-2xl bg-zinc-100 px-4 py-3 dark:bg-zinc-800">
                    <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <form onSubmit={handleSend} className="border-t border-zinc-200 p-4 dark:border-zinc-800">
          <div className="relative mx-auto max-w-2xl">
            <textarea
              placeholder="Ask a question..."
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                const el = e.target;
                el.style.height = 'auto';
                el.style.height = Math.min(el.scrollHeight, 150) + 'px';
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (input.trim() && !streaming) handleSend(e as unknown as FormEvent);
                }
              }}
              disabled={streaming}
              rows={1}
              className="w-full resize-none rounded-xl border border-zinc-300 py-3 pl-4 pr-12 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800"
              style={{ maxHeight: '150px' }}
            />
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-primary-600 hover:bg-primary-50 disabled:opacity-30"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
