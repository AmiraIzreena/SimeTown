'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedButton, LocalizedInput } from '@/components/ui/localized-elements';

import { Bot, Building2, Copy, ExternalLink, History, Plus, Send, ShieldAlert, Trash2, UserRound, Volume2 } from 'lucide-react';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AssistantActionCard, type AssistantAction } from '@/components/features/assistant-action';
import { AksesPage, useAksesMode } from '@/components/features/akses-mode';
import { PreviewBadge } from '@/components/features/preview';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { speak, translate, useLang } from '@/lib/i18n';
import { DEMO_MODE } from '@/lib/demo';

type LinkTo = { href: string; label: string };
interface Source {
  title: string;
  url: string;
  checked: string;
}
type Action = AssistantAction;
interface Message {
  id: number;
  from: 'me' | 'bot' | 'staff';
  text: string;
  link?: LinkTo;
  sources?: Source[];
  action?: Action;
  /** A visitor pass's share link: shown once, never saved in the chat. */
  shareUrl?: string;
}
interface ConversationSummary {
  id: string;
  title: string;
  updated_at: string;
  messages: number;
}
interface SavedConversation {
  id: string;
  title: string;
  messages: { role: 'USER' | 'ASSISTANT' | 'STAFF'; text: string; link?: LinkTo; sources?: Source[]; action?: Action }[];
}
interface Status {
  mode: 'AI' | 'RULES';
  provider: string | null;
  dailyLimit: number | null;
  usedToday: number;
  retentionDays: number;
}
interface AskResult {
  conversationId: string;
  mode: 'AI' | 'RULES';
  limited: boolean;
  reply: { text: string; link?: LinkTo; sources: Source[]; action?: Action };
}

const GREETING: Message[] = [
  { id: 0, from: 'bot', text: 'Hello! Ask me about City of Elmina, Sime Darby Property, local services or your own SimeTown account. I can also make a visitor pass or pass your question to the township office, after you confirm.' },
];

const SUGGESTIONS = ['Is my area flooding?', 'How many points do I have?', 'Make a visitor pass for Ali tomorrow', 'When is rubbish collected?', 'What homes is Sime Darby selling in Elmina?', 'Any shop offers today?', 'Bila kutipan sampah?'];

/**
 * SimeTown Assistant. Each question goes to the server, where an AI agent
 * answers from the resident's own data and checked facts about City of
 * Elmina, or fixed rules answer when the AI is off or unavailable. It acts
 * only after the resident taps Yes, never decides a safety alert, and can
 * pass a question to the township office, whose reply comes back here.
 */
export default function AssistantPage() {
  const akses = useAksesMode();
  const lang = useLang();
  const [messages, setMessages] = useState<Message[]>(GREETING);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const nextId = useRef(1);
  const add = (m: Omit<Message, 'id'>) => setMessages((list) => [...list, { ...m, id: nextId.current++ }]);
  const patchAction = (id: string, status: Action['status']) =>
    setMessages((list) => list.map((m) => (m.action?.id === id ? { ...m, action: { ...m.action, status } } : m)));
  const replaceAction = (action: Action) => setMessages((list) => list.map((m) => (m.action?.id === action.id ? { ...m, action } : m)));

  const status = useApi<Status>('/assistant/status');
  const history = useApi<ConversationSummary[]>('/assistant/conversations');
  const conversationId = useRef<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [limited, setLimited] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const startNew = () => {
    conversationId.current = null;
    setCurrent(null);
    setMessages(GREETING);
    setShowHistory(false);
  };
  const open = useAction((id: string) => api.get<SavedConversation>(`/assistant/conversations/${id}`), {
    onSuccess: (c) => {
      conversationId.current = c.id;
      setCurrent(c.id);
      setMessages([
        ...GREETING,
        ...c.messages.map((m) => ({ id: nextId.current++, from: m.role === 'USER' ? ('me' as const) : m.role === 'STAFF' ? ('staff' as const) : ('bot' as const), text: m.text, link: m.link, sources: m.sources, action: m.action })),
      ]);
      setShowHistory(false);
    },
  });
  // A notification from the township office opens its chat: /app/assistant?c=<id>.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('c');
    if (id) void open.run(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  const remove = useAction(async (id: string) => {
    await api.post(`/assistant/conversations/${id}/delete`);
    return id;
  }, {
    onSuccess: (id) => {
      if (id === conversationId.current) startNew();
      void history.mutate();
    },
    success: 'Chat deleted.',
  });
  const clearAll = useAction(() => api.post<{ deleted: number }>('/assistant/conversations/delete-all'), {
    onSuccess: () => {
      startNew();
      setConfirmClear(false);
      void history.mutate();
    },
    success: 'All your chats are deleted.',
  });

  const ask = async (question: string) => {
    if (!question.trim() || thinking) return;
    add({ from: 'me', text: question });
    setInput('');
    setThinking(true);
    try {
      const r = await api.post<AskResult>('/assistant/ask', { conversationId: conversationId.current ?? undefined, message: question, lang });
      conversationId.current = r.conversationId;
      setCurrent(r.conversationId);
      setLimited(r.limited);
      // A new proposal replaces any earlier one still waiting, as on the server.
      if (r.reply.action) setMessages((list) => list.map((m) => (m.action?.status === 'PROPOSED' ? { ...m, action: { ...m.action, status: 'SUPERSEDED' } } : m)));
      add({ from: 'bot', text: r.reply.text, link: r.reply.link, sources: r.reply.sources, action: r.reply.action });
      void history.mutate();
      void status.mutate();
    } catch (error) {
      add({ from: 'bot', text: error instanceof ApiError ? error.message : 'Something went wrong. Please try again.' });
    } finally {
      setThinking(false);
    }
  };
  const decide = async (action: Action, yes: boolean) => {
    patchAction(action.id, yes ? 'DONE' : 'CANCELLED');
    try {
      const r = await api.post<{ message: { text: string; link?: LinkTo }; shareUrl?: string }>(`/assistant/actions/${action.id}/${yes ? 'confirm' : 'cancel'}`);
      add({ from: 'bot', text: r.message.text, link: r.message.link, shareUrl: r.shareUrl });
    } catch (error) {
      patchAction(action.id, error instanceof ApiError && error.code === 'ACTION_EXPIRED' ? 'EXPIRED' : error instanceof ApiError && error.code === 'ACTION_REPLACED' ? 'SUPERSEDED' : 'FAILED');
      add({ from: 'bot', text: error instanceof ApiError ? error.message : 'That did not work. Please try again.' });
    }
    void history.mutate();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(input);
  };

  const s = status.data;
  return (
    <AksesPage profile={akses.profile} simple={akses.simple} largeText={akses.largeText} largeTargets={akses.largeTargets}>
      <PageHeader
        title="SimeTown Assistant"
        description="Ask about City of Elmina, Sime Darby Property and your own SimeTown account, in English or Bahasa Malaysia. It acts only after you confirm, and hands over to the township office when unsure."
        action={DEMO_MODE && s ? <PreviewBadge><Text>{s.mode === 'AI' ? `AI · ${s.provider}` : 'Rule-based answers'}</Text></PreviewBadge> : undefined}
      />
      <div className="mb-3 flex items-center justify-between gap-2 lg:hidden">
        <Button variant="secondary" size="sm" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
          <History className="size-4" aria-hidden /><Text>Past chats</Text></Button>
        <Button variant="secondary" size="sm" onClick={startNew}>
          <Plus className="size-4" aria-hidden /><Text>New chat</Text></Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <Card className={cn('flex-col gap-2 p-3 lg:flex', showHistory ? 'flex' : 'hidden')}>
        <Button size="sm" onClick={startNew} className="hidden lg:inline-flex">
          <Plus className="size-4" aria-hidden /><Text>New chat</Text></Button>
        <p className="px-2 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Past chats</Text></p>
        {history.data && history.data.length > 0 ? (
          <ul className="max-h-96 space-y-1 overflow-y-auto lg:max-h-[28rem]">
            {history.data.map((c) => (
              <li key={c.id} className={cn('group flex items-center gap-1 rounded-md', c.id === current ? 'bg-brand-50' : 'hover:bg-ink-50')}>
                <button type="button" onClick={() => void open.run(c.id)} disabled={open.pending} className="min-w-0 flex-1 px-2 py-2 text-left">
                  <span className="block truncate text-sm font-medium text-ink-900">{c.title}</span>
                  <span className="block text-xs text-ink-500"><Text>{timeAgo(c.updated_at)}</Text></span>
                </button>
                <LocalizedButton type="button" onClick={() => void remove.run(c.id)} disabled={remove.pending} aria-label="Delete this chat" title="Delete this chat" className="grid size-9 shrink-0 place-items-center rounded-md text-ink-400 hover:bg-ink-100 hover:text-accent-700">
                  <Trash2 className="size-4" aria-hidden />
                </LocalizedButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-2 text-sm text-ink-500"><Text>{history.isLoading ? 'Loading…' : 'No saved chats yet.'}</Text></p>
        )}
        <p className="mt-auto px-2 pt-2 text-xs text-ink-500"><Text>Saved to your account for 90 days after your last message. Only you can see them.</Text></p>
        {history.data && history.data.length > 0 && (
          <button type="button" onClick={() => setConfirmClear(true)} className="px-2 text-left text-xs font-semibold text-accent-700 hover:underline">
            <Text>Delete all chats</Text>
          </button>
        )}
      </Card>
      <Card className="flex min-h-[32rem] flex-col">
        <ol className="flex-1 space-y-3 overflow-y-auto p-5" aria-live="polite">
          {messages.map((m) => (
            <li key={m.id} className={cn('flex gap-2.5', m.from === 'me' && 'flex-row-reverse')}>
              <span className={cn('grid size-8 shrink-0 place-items-center rounded-full', m.from === 'me' ? 'bg-brand-700 text-white' : m.from === 'staff' ? 'bg-gold-100 text-gold-700' : 'bg-brand-50 text-brand-700')}>
                {m.from === 'me' ? <UserRound className="size-4" aria-hidden /> : m.from === 'staff' ? <Building2 className="size-4" aria-hidden /> : <Bot className="size-4" aria-hidden />}
              </span>
              <div className={cn('max-w-[80%] rounded-2xl px-4 py-2.5 text-[15px]', m.from === 'me' ? 'rounded-tr-sm bg-brand-700 text-white' : m.from === 'staff' ? 'rounded-tl-sm border border-gold-300 bg-gold-50 text-ink-900' : 'rounded-tl-sm bg-ink-100 text-ink-900')}>
                {m.from === 'staff' && <p className="mb-1 text-xs font-semibold text-gold-700"><Text>Township office</Text></p>}
                <p className="whitespace-pre-wrap break-words">{m.from === 'me' ? m.text : <Text>{m.text}</Text>}</p>
                {m.link && (
                  <Link href={m.link.href} className="mt-1.5 inline-block text-sm font-semibold text-brand-700 underline underline-offset-2">
                    <Text>{m.link.label}</Text>
                  </Link>
                )}
                {m.shareUrl && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-white px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-700">{m.shareUrl}</span>
                    <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(m.shareUrl!)}>
                      <Copy className="size-3.5" aria-hidden /><Text>Copy link</Text></Button>
                  </div>
                )}
                {m.action && <AssistantActionCard key={m.action.id} action={m.action} onDecide={(yes) => void decide(m.action!, yes)} onChanged={replaceAction} />}
                {m.sources && m.sources.length > 0 && (
                  <details className="mt-2 text-xs text-ink-600">
                    <summary className="cursor-pointer select-none font-semibold"><Text>{`Sources (checked ${formatDate(m.sources[0]!.checked)})`}</Text></summary>
                    <ul className="mt-1 space-y-1">
                      {m.sources.map((src) => (
                        <li key={src.url}>
                          <a href={src.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 text-brand-700 underline underline-offset-2">
                            {src.title}<ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {m.from !== 'me' && (
                  <LocalizedButton type="button" onClick={() => speak(m.text, lang)} className="mt-1 flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800" aria-label="Read this aloud">
                    <Volume2 className="size-3.5" aria-hidden /><Text> Read aloud</Text></LocalizedButton>
                )}
              </div>
            </li>
          ))}
          {thinking && (
            <li role="status" className="assistant-thinking text-sm text-ink-500">
              <span className="sr-only"><Text>Thinking…</Text></span>
              <span aria-hidden className="thinking-dots"><i /><i /><i /></span>
            </li>
          )}
        </ol>
        <div className="border-t border-ink-100 p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((q) => (
              <button key={q} type="button" onClick={() => void ask(translate(lang, q))} className={cn('rounded-full border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-700 hover:border-brand-500 hover:text-brand-800', akses.guided && 'min-h-16 rounded-xl px-5 text-lg font-semibold')}>
                <Text>{q}</Text>
              </button>
            ))}
          </div>
          {akses.guided && <p className="mb-2 text-2xl font-semibold"><Text>What would you like to ask?</Text></p>}
          <form method="post" onSubmit={submit} className="flex gap-2">
            <label htmlFor="ask" className="sr-only"><Text>Your question</Text></label>
            <LocalizedInput id="ask" value={input} onChange={(event) => setInput(event.target.value)} maxLength={1000} placeholder="Ask about the township…" className={cn('control flex-1', akses.guided && 'min-h-20 text-2xl')} autoComplete="off" />
            <Button type="submit" size={akses.guided ? 'lg' : 'md'} disabled={!input.trim() || thinking}>
              <Send className="size-4" aria-hidden /><Text>Ask</Text></Button>
          </form>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-500">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <Text>
              {s?.mode === 'AI'
                ? `Answers are written by AI (${s.provider}) from your own SimeTown data and checked facts, and can be wrong: check anything important. Your question and the details needed to answer it are sent to ${s.provider}. In danger, call 999. It never decides a safety alert.`
                : 'Answers come from fixed rules over your own SimeTown data and checked facts. In danger, call 999. It never decides a safety alert.'}
            </Text>
          </p>
          {limited && <p className="mt-1 text-xs text-warning-700"><Text>You have reached today’s limit of AI answers, so answers come from the fixed rules until tomorrow.</Text></p>}
        </div>
      </Card>
      </div>
      <ConfirmDialog open={confirmClear} onClose={() => setConfirmClear(false)} onConfirm={() => void clearAll.run()} title="Delete all your chats?" confirmLabel="Delete all" destructive pending={clearAll.pending}>
        <Text>Every saved conversation is removed from your account. This cannot be undone.</Text>
      </ConfirmDialog>
    </AksesPage>
  );
}
