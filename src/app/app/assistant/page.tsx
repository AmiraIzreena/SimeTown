'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedButton, LocalizedInput } from '@/components/ui/localized-elements';

import { Bot, Send, ShieldAlert, UserRound, Volume2 } from 'lucide-react';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { useRef, useState, type FormEvent } from 'react';
import { PreviewBadge } from '@/components/features/preview';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { speak, translate, useLang } from '@/lib/i18n';
import type { BanjirOverview } from '@/lib/types';
import { formatPoints, formatRM } from '@/shared/domain';

interface Message {
  id: number;
  from: 'me' | 'bot';
  text: string;
  link?: { href: string; label: string };
  confirm?: { label: string; run: () => Promise<string> };
}

const SUGGESTIONS = ['Is my area flooding?', 'How many points do I have?', 'Make a visitor pass for Ali tomorrow', 'When is recycling collection?', 'Any shop offers today?', 'Bila kutipan sampah?'];

/** The day after today at 9am Malaysia time, and twelve hours later. */
function tomorrowWindow(): [Date, Date] {
  const now = new Date();
  const kl = new Date(now.getTime() + 8 * 3_600_000);
  const start = new Date(Date.UTC(kl.getUTCFullYear(), kl.getUTCMonth(), kl.getUTCDate() + 1, 1, 0));
  return [start, new Date(start.getTime() + 12 * 3_600_000)];
}

/** Fixed answers from the resident's own SimeTown data. No model: every rule is readable here. */
async function answer(question: string): Promise<Omit<Message, 'id'>> {
  const q = question.toLowerCase();
  if (/flood|banjir|water level|paras air|hujan|rain/.test(q)) {
    const b = await api.get<BanjirOverview>('/banjir');
    const z = b.zones.find((zone) => zone.id === b.myZoneId);
    if (!z) return { from: 'bot', text: 'I could not find your flood zone. The official status page has every zone.', link: { href: '/status', label: 'Open the status page' } };
    const text =
      z.status === 'NORMAL'
        ? `${z.name} is normal: the water is at ${z.level_pct}%. I only repeat the official status; I never raise or cancel an alert.`
        : `${z.name} is under a ${z.status.toLowerCase()} alert: water at ${z.level_pct}%. ${z.todo ?? `Safe route: ${z.safe_route}`}`;
    return { from: 'bot', text, link: { href: '/app/banjir', label: 'Open Banjir' } };
  }
  if (/point|mata|balance|baki|saved|jimat berapa/.test(q)) {
    const w = await api.get<{ points: number; offerPoints: number; totalPoints: number; saved: { totalSen: number } }>('/wallet');
    return {
      from: 'bot',
      text: `You have ${formatPoints(w.totalPoints)} points, worth ${formatRM(w.totalPoints)}: ${formatPoints(w.points)} cash-backed and ${formatPoints(w.offerPoints)} offer-backed. You have saved ${formatRM(w.saved.totalSen)} so far.`,
      link: { href: '/app/wallet', label: 'Open Points & XP' },
    };
  }
  if (/pass|visitor|pelawat|tamu|tetamu/.test(q)) {
    const name = /(?:for|untuk)\s+([a-z][a-z .'-]{1,40}?)(?:\s+(?:tomorrow|today|esok|hari ini|at|pada)\b|[.?!]?$)/i.exec(question)?.[1]?.trim();
    if (!name) return { from: 'bot', text: 'Who is the pass for? Try “Make a visitor pass for Ali tomorrow”.' };
    const tomorrow = /tomorrow|esok/.test(q);
    const [from, until] = tomorrow ? tomorrowWindow() : [new Date(), new Date(Date.now() + 12 * 3_600_000)];
    return {
      from: 'bot',
      text: `Make a one-visit pass for ${name}, ${tomorrow ? 'tomorrow from 9am' : 'from now'} for 12 hours?`,
      confirm: {
        label: 'Yes, make the pass',
        run: async () => {
          const pass = await api.post<{ code: string; token: string }>('/tamu/passes', { type: 'ONE_VISIT', visitorName: name, validFrom: from, validUntil: until });
          return `Done. Pass code ${pass.code}. Send ${name} this link: ${window.location.origin}/pass/${pass.token}`;
        },
      },
    };
  }
  if (/collect|kutip|sampah|rubbish|garbage|recycl|kitar/.test(q)) {
    return { from: 'bot', text: 'Recycling is collected on Tuesday and Friday mornings: bins out before 8am. The smart machines at Lakeside and Central are open all day and give you XP.', link: { href: '/app/kitar', label: 'Open Kitar' } };
  }
  if (/offer|tawaran|discount|diskaun|promo/.test(q)) {
    const o = await api.get<{ offers: { merchantName: string; title: string; usable: boolean }[]; balance: number }>('/offers');
    const live = o.offers.filter((x) => x.usable);
    return {
      from: 'bot',
      text: live.length ? `Available now: ${live.map((x) => `${x.merchantName}: ${x.title}`).join('; ')}. You have ${formatPoints(o.balance)} offer points.` : 'No Shop Offers are available right now. Some only run at set hours.',
      link: { href: '/app/wallet', label: 'See all offers' },
    };
  }
  if (/report|lapor|pothole|lubang|lampu|light|drain|longkang/.test(q)) {
    return { from: 'bot', text: 'I can take you to Lapor. Add a photo and the place, and you will see who fixes it and by when.', link: { href: '/app/lapor', label: 'Report a problem' } };
  }
  if (/\b(bill|bil|electric|elektrik|electricity)\b/.test(q)) {
    const j = await api.get<{ readings: { month: string; electricity_kwh: number | null; water_litres: number | null }[] }>('/jimat');
    const last = j.readings[j.readings.length - 1];
    return {
      from: 'bot',
      text: last ? `Your last reading (${last.month.slice(0, 7)}): ${last.electricity_kwh ?? '–'} kWh of electricity and ${last.water_litres ? (last.water_litres / 1000).toFixed(1) : '–'} m³ of water.` : 'No readings yet. Upload a bill in Jimat and it reads itself.',
      link: { href: '/app/jimat', label: 'Open Jimat' },
    };
  }
  return { from: 'bot', text: 'I am not sure about that one. In the pilot I hand questions like this to the township office. For now, try one of the suggestions.' };
}

/**
 * SimeTown Assistant, as a preview (proposal section 5: "Later"). Answers come from
 * fixed rules over the resident's own SimeTown data, in English or Bahasa
 * Malaysia. It does a task only after the resident confirms, and it never
 * decides a safety alert: flood answers quote the official status only.
 */
export default function AssistantPage() {
  const lang = useLang();
  const [messages, setMessages] = useState<Message[]>([
    { id: 0, from: 'bot', text: 'Hello! I can answer questions about the township and do small tasks after you confirm. Try one of the suggestions below.' },
  ]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const nextId = useRef(1);
  const add = (m: Omit<Message, 'id'>) => setMessages((list) => [...list, { ...m, id: nextId.current++ }]);


  const ask = async (question: string) => {
    if (!question.trim() || thinking) return;
    add({ from: 'me', text: question });
    setInput('');
    setThinking(true);
    try {
      add(await answer(question));
    } catch (error) {
      add({ from: 'bot', text: error instanceof ApiError ? error.message : 'Something went wrong. Please try again.' });
    } finally {
      setThinking(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(input);
  };

  return (
    <>
      <PageHeader title="SimeTown Assistant" description="Ask about the township in English or Bahasa Malaysia. It does small tasks after you confirm, and hands over to staff when unsure." action={<PreviewBadge><Text>Preview: rule-based</Text></PreviewBadge>} />
      <Card className="flex min-h-[32rem] flex-col">
        <ol className="flex-1 space-y-3 overflow-y-auto p-5" aria-live="polite">
          {messages.map((m) => (
            <li key={m.id} className={cn('flex gap-2.5', m.from === 'me' && 'flex-row-reverse')}>
              <span className={cn('grid size-8 shrink-0 place-items-center rounded-full', m.from === 'me' ? 'bg-brand-700 text-white' : 'bg-brand-50 text-brand-700')}>
                {m.from === 'me' ? <UserRound className="size-4" aria-hidden /> : <Bot className="size-4" aria-hidden />}
              </span>
              <div className={cn('max-w-[80%] rounded-2xl px-4 py-2.5 text-[15px]', m.from === 'me' ? 'rounded-tr-sm bg-brand-700 text-white' : 'rounded-tl-sm bg-ink-100 text-ink-900')}>
                <p className="whitespace-pre-wrap break-words">{m.from === 'bot' ? <Text>{m.text}</Text> : m.text}</p>
                {m.link && (
                  <Link href={m.link.href} className="mt-1.5 inline-block text-sm font-semibold text-brand-700 underline underline-offset-2">
                    <Text>{m.link.label}</Text>
                  </Link>
                )}
                {m.confirm && (
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      onClick={async () => {
                        const confirm = m.confirm!;
                        setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, confirm: undefined } : x)));
                        try {
                          add({ from: 'bot', text: await confirm.run(), link: { href: '/app/tamu', label: 'Open Tamu' } });
                        } catch (error) {
                          add({ from: 'bot', text: error instanceof ApiError ? error.message : 'That did not work. Please try in Tamu.' });
                        }
                      }}
                    >
                      <Text>{m.confirm.label}</Text>
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, confirm: undefined, text: `${x.text} (cancelled)` } : x)))}><Text>No</Text></Button>
                  </div>
                )}
                {m.from === 'bot' && (
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
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => void ask(translate(lang, s))} className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-700 hover:border-brand-500 hover:text-brand-800">
                <Text>{s}</Text>
              </button>
            ))}
          </div>
          <form method="post" onSubmit={submit} className="flex gap-2">
            <label htmlFor="ask" className="sr-only"><Text>Your question</Text></label>
            <LocalizedInput id="ask" value={input} onChange={(event) => setInput(event.target.value)} maxLength={200} placeholder="Ask about the township…" className="control flex-1" autoComplete="off" />
            <Button type="submit" disabled={!input.trim() || thinking}>
              <Send className="size-4" aria-hidden /><Text>Ask</Text></Button>
          </form>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-500">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /><Text>A preview with fixed answers from your own SimeTown data. The AI assistant, and voice input, come in the pilot. It never decides a safety alert.</Text></p>
        </div>
      </Card>
    </>
  );
}
