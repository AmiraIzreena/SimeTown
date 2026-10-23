'use client';

import { Text } from '@/components/ui/localized-text';
import { BookOpen, Bot, Building2, CalendarDays, DoorOpen, History, Languages, ListChecks, MessageCircleQuestion, ShieldAlert, ShieldCheck, Trash2, UserRound, Volume2 } from 'lucide-react';
import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import { ScreenButton, ScreenCard, ScreenRow, ScreenTitle, Walkthrough, type WalkStep } from './walkthrough';

/**
 * How the SimeTown Assistant works, for residents: asking in English or Malay, answers from your own data and checked
 * facts, actions only after Yes, handing over to the township office, and saved chats. Pictures only: the questions are
 * the page's own suggestions, and every rule shown is the one the Assistant applies.
 */

/** One chat bubble, as on the page: yours on the right, the Assistant's or the office's on the left. */
function Bubble({ from, text, i = 0 }: { from: 'me' | 'bot' | 'staff'; text: string; i?: number }) {
  const Icon = from === 'me' ? UserRound : from === 'staff' ? Building2 : Bot;
  return (
    <div className={cn('hiw-row flex items-end gap-2', from === 'me' && 'flex-row-reverse')} style={{ '--i': i } as CSSProperties}>
      <span className={cn('grid size-7 shrink-0 place-items-center rounded-full', from === 'me' ? 'bg-brand-600 text-white' : from === 'staff' ? 'bg-gold-100 text-gold-700' : 'bg-white/90 text-brand-700')}>
        <Icon className="size-3.5" aria-hidden />
      </span>
      <span className={cn('max-w-[80%] rounded-2xl px-3 py-2 text-[13px] leading-snug shadow-lg', from === 'me' ? 'rounded-br-sm bg-brand-600 text-white' : from === 'staff' ? 'rounded-bl-sm border border-gold-300 bg-gold-50 text-ink-900' : 'rounded-bl-sm bg-white text-ink-900')}>
        {from === 'staff' && <span className="mb-0.5 block text-[10px] font-semibold text-gold-700"><Text>Township office</Text></span>}
        <Text>{text}</Text>
      </span>
    </div>
  );
}

/** Three dots while the Assistant thinks. */
function Thinking({ i = 0 }: { i?: number }) {
  return (
    <div className="hiw-row flex items-center gap-2" style={{ '--i': i } as CSSProperties}>
      <span className="grid size-7 place-items-center rounded-full bg-white/90 text-brand-700"><Bot className="size-3.5" aria-hidden /></span>
      <span aria-hidden className="thinking-dots rounded-2xl bg-white/15 px-3 py-2.5 text-white/80"><i /><i /><i /></span>
    </div>
  );
}

const RESIDENT: WalkStep[] = [
  {
    key: 'ask', icon: Languages, who: 'You', title: 'Ask in English or Bahasa Malaysia',
    text: 'Type a question, or tap one of the suggestions. Ask about City of Elmina, Sime Darby Property, local services or your own SimeTown account.',
    screen: <div className="space-y-3"><ScreenTitle>SimeTown Assistant</ScreenTitle>
      <Bubble from="me" text="Is my area flooding?" i={0} />
      <Bubble from="me" text="Bila kutipan sampah?" i={1} />
      <Thinking i={2} />
    </div>,
  },
  {
    key: 'answer', icon: BookOpen, who: 'Assistant', title: 'Answers from your data and checked facts',
    text: 'It answers from your own SimeTown data, such as your points or your zone, and from checked facts about the township. Tap Sources to see where an answer came from.',
    screen: <div className="space-y-3"><ScreenTitle>SimeTown Assistant</ScreenTitle>
      <Bubble from="me" text="How many points do I have?" i={0} />
      <Bubble from="bot" text="You have 1,240 points, worth RM12.40." i={1} />
      <ScreenRow icon={BookOpen} label="Sources (checked)" i={2} tone="gold" />
    </div>,
  },
  {
    key: 'act', icon: ListChecks, who: 'You', title: 'It acts only after you say Yes',
    text: 'Ask it to make a visitor pass and it fills one in for you to check. Nothing happens until you tap Yes. You can change the details first, or say no.',
    screen: <div className="space-y-3"><ScreenTitle>Visitor pass</ScreenTitle>
      <ScreenCard icon={DoorOpen} title="Visitor pass for Ali" note="Tomorrow · Main gate" i={0} tone="brand" />
      <ScreenRow icon={CalendarDays} label="Check the name and day" i={1} tick />
      <ScreenButton i={2}>Yes, make the pass</ScreenButton>
    </div>,
  },
  {
    key: 'office', icon: Building2, who: 'Township office', title: 'Not sure? It asks the township office',
    text: 'When it cannot answer, it offers to pass your question to the township office. Tap Yes, send it. Their reply comes back in the same chat, and you are notified.',
    screen: <div className="space-y-3"><ScreenTitle>SimeTown Assistant</ScreenTitle>
      <ScreenButton i={0}>Yes, send it</ScreenButton>
      <Bubble from="staff" text="The playground reopens on Monday." i={1} />
    </div>,
  },
  {
    key: 'safe', icon: ShieldAlert, who: 'SimeTown', title: 'Never decides a safety alert',
    text: 'Flood alerts come from the Banjir rules, never from the Assistant. In danger, call 999. Answers can be wrong, so check anything important.',
    screen: <div className="space-y-3"><ScreenTitle>Safety</ScreenTitle>
      <ScreenRow icon={ShieldCheck} label="Flood alerts come from the Banjir rules" i={0} tick />
      <ScreenRow icon={ShieldAlert} label="In danger, call 999" i={1} tone="alert" />
    </div>,
  },
  {
    key: 'chats', icon: History, who: 'You', title: 'Your chats, kept private',
    text: 'Past chats are saved to your account for 90 days after your last message, and only you can see them. Tap Read aloud to hear an answer. Delete a chat, or all of them, at any time.',
    screen: <div className="space-y-3"><ScreenTitle>Past chats</ScreenTitle>
      <ScreenRow icon={MessageCircleQuestion} label="When is rubbish collected?" value="2 d ago" i={0} />
      <ScreenRow icon={Volume2} label="Read aloud" i={1} />
      <ScreenRow icon={Trash2} label="Delete all chats" i={2} />
    </div>,
  },
];

export function ResidentAssistantWalkthrough() {
  return <Walkthrough title="How the Assistant works" description="What it can answer, what it can do for you, and what it never does." steps={RESIDENT} />;
}
