'use client';

import { Text } from '@/components/ui/localized-text';
import { CalendarClock, Coins, Flag, Repeat, Route, Sparkles, Trophy } from 'lucide-react';
import Image from 'next/image';
import { useState, type CSSProperties } from 'react';
import { ACTIVITY_MEDIA, FALLBACK_MEDIA } from '@/components/features/showcase-content';
import { Async, EmptyState } from '@/components/ui/feedback';
import { LocalizedLink as Link, LocalizedNav } from '@/components/ui/localized-elements';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { formatRM } from '@/shared/domain';
import { GERAK_CHALLENGE_RULES, gerakChallengeKind } from '@/shared/gerak-challenges';

interface Challenge {
  id: string;
  title: string;
  description: string;
  activity: string;
  activity_label: string;
  goal_metric: 'COUNT' | 'QUANTITY';
  goal_target: number;
  quantity_unit: string | null;
  reward_points: number;
  per_person_cap: number;
  ends_at: string;
  funder: string;
  township: string;
}
interface Everyday {
  activity: string;
  label: string;
  xp: number;
  quantity_unit: string | null;
  daily_cap_person: number;
  offer_points: number;
}

const media = (activity: string) => ACTIVITY_MEDIA[activity] ?? FALLBACK_MEDIA;
const SDP = 'Sime Darby Property';
type Filter = 'ALL' | 'SDP' | 'SPONSOR';

function goalText(c: Challenge, t: ReturnType<typeof useT>) {
  if (c.goal_metric === 'QUANTITY') {
    if (c.quantity_unit === 'm') return t('Goal: {n} km', { n: (c.goal_target / 1000).toLocaleString('en-MY') });
    if (c.quantity_unit === 'g') return t('Goal: {n} kg', { n: (c.goal_target / 1000).toLocaleString('en-MY') });
  }
  return c.goal_target === 1 ? t('Goal: do it once') : t('Goal: {n} times', { n: c.goal_target });
}

/** Live challenges from the API, and the everyday actions that always earn Impact XP. */
export function ChallengesView() {
  const t = useT();
  const data = useApi<{ challenges: Challenge[]; everyday: Everyday[] }>('/public/challenges');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [now] = useState(() => Date.now());

  return (
    <Async state={data}>
      {({ challenges, everyday }) => {
        const shown = challenges.filter((c) => filter === 'ALL' || (filter === 'SDP' ? c.funder === SDP : c.funder !== SDP));
        return (
          <>
            {/* Live challenges */}
            <section id="live" className="offer-anchor mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
              <div className="flex flex-wrap items-end justify-between gap-5">
                <div>
                  <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-brand-700">
                    <span className="live-dot" aria-hidden /><Text>Live now</Text>
                  </p>
                  <h2 className="mt-3 max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl"><Text>Challenges you can join today</Text></h2>
                </div>
                <LocalizedNav aria-label="Filter challenges" className="flex flex-wrap gap-2">
                  {([['ALL', 'All'], ['SDP', 'By Sime Darby Property'], ['SPONSOR', 'By sponsors']] as const).map(([key, label]) => (
                    <button key={key} type="button" onClick={() => setFilter(key)} className="offer-tab border border-ink-200 bg-white" aria-current={filter === key ? 'true' : undefined}><Text>{label}</Text></button>
                  ))}
                </LocalizedNav>
              </div>

              {shown.length === 0 ? (
                <div className="mt-10"><EmptyState icon={Trophy} title="No live challenges here right now"><Text>New challenges open every month. The everyday actions below always earn Impact XP.</Text></EmptyState></div>
              ) : (
                <div key={filter} className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {shown.map((c, i) => {
                    const m = media(c.activity);
                    const days = Math.max(0, Math.ceil((new Date(c.ends_at).getTime() - now) / 86_400_000));
                    return (
                      <article key={c.id} className="shop-card challenge-card group flex flex-col overflow-hidden rounded-3xl border border-white/80 bg-white shadow-sm" style={{ '--i': i } as CSSProperties}>
                        <div className="relative aspect-[16/10] overflow-hidden">
                          <Image src={m.image} alt="" fill sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw" className="object-cover transition-transform duration-700 ease-soft group-hover:scale-105" />
                          <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-brand-950/85 via-brand-950/20 to-transparent" />
                          <span className={cn('absolute left-4 top-4 rounded-full px-3 py-1 text-[11px] font-bold backdrop-blur-md', c.funder === SDP ? 'bg-brand-600 text-white' : 'bg-gold-300 text-brand-950')}>
                            {c.funder === SDP ? <Text>By Sime Darby Property</Text> : <Text>Sponsored</Text>}
                          </span>
                          <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-3 text-white">
                            <div>
                              <p className="font-display text-3xl font-bold leading-none">+{c.reward_points.toLocaleString('en-MY')}</p>
                              <p className="mt-1 text-xs text-white/80">{t('points, worth {rm}', { rm: formatRM(c.reward_points) })}</p>
                            </div>
                            <span className="grid size-11 place-items-center rounded-2xl bg-white/15 backdrop-blur-md"><m.icon className="size-5" aria-hidden /></span>
                          </div>
                        </div>
                        <div className="flex flex-1 flex-col p-6">
                          <p className="text-xs font-semibold text-ink-500">{c.funder === SDP ? <Text>Funded by Sime Darby Property</Text> : t('Funded by {name}', { name: c.funder })}</p>
                          <h3 className="mt-1.5 text-xl font-semibold leading-snug">{c.title}</h3>
                          <p className="mt-2 flex-1 text-[15px] leading-relaxed text-ink-600">{c.description}</p>
                          <ul className="mt-5 grid grid-cols-2 gap-2 text-xs text-ink-700">
                            <li className="flex items-center gap-1.5 rounded-lg bg-ink-50 px-2.5 py-2"><Flag className="size-3.5 text-brand-600" aria-hidden />{goalText(c, t)}</li>
                            <li className="flex items-center gap-1.5 rounded-lg bg-ink-50 px-2.5 py-2"><CalendarClock className="size-3.5 text-brand-600" aria-hidden />{days <= 1 ? <Text>Ends today</Text> : t('Ends in {n} days', { n: days })}</li>
                            <li className="col-span-2 flex items-center gap-1.5 rounded-lg bg-ink-50 px-2.5 py-2"><Repeat className="size-3.5 text-brand-600" aria-hidden />{c.per_person_cap === 1 ? <Text>One reward per resident</Text> : t('Up to {n} rewards per resident', { n: c.per_person_cap })}</li>
                            {/* Gerak: whether a loop must be finished, in the same words as the resident's Gerak page. */}
                            {(() => {
                              const kind = gerakChallengeKind(c.activity, c.goal_metric);
                              return kind ? (
                                <li className="col-span-2 flex items-start gap-1.5 rounded-lg bg-brand-50 px-2.5 py-2 text-brand-900"><Route className="mt-px size-3.5 shrink-0 text-brand-600" aria-hidden /><Text>{GERAK_CHALLENGE_RULES[kind].rule}</Text></li>
                              ) : null;
                            })()}
                          </ul>
                          <Link href={m.href} className="group/cta mt-5 inline-flex items-center justify-between rounded-2xl bg-brand-950 px-4 py-3 text-sm font-semibold text-white transition-colors duration-200 hover:bg-brand-800">
                            {t('Take part in {module}', { module: m.module })}
                            <Sparkles className="size-4 text-gold-300 transition-transform duration-300 group-hover/cta:rotate-12 group-hover/cta:scale-110" aria-hidden />
                          </Link>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Everyday XP */}
            <section id="everyday" className="offer-anchor border-y border-white/80 bg-white/40 py-20 sm:py-24">
              <div className="mx-auto max-w-6xl px-5 sm:px-8">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700"><Text>Every day</Text></p>
                <h2 className="mt-3 max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl"><Text>Actions that always earn Impact XP</Text></h2>
                <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-600"><Text>No challenge needed. XP builds your level, your badges and your street’s place in the monthly league.</Text></p>
                <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {everyday.map((a, i) => {
                    const m = media(a.activity);
                    return (
                      <article key={a.activity} className="glass-surface offer-card shop-card flex items-start gap-4 rounded-2xl border p-5 shadow-sm" style={{ '--i': i } as CSSProperties}>
                        <span className="offer-icon grid size-12 shrink-0 place-items-center rounded-xl bg-brand-100/80 text-brand-800"><m.icon className="size-5" aria-hidden /></span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="font-semibold leading-snug"><Text>{a.label}</Text></h3>
                            <span className="shrink-0 rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-2.5 py-0.5 text-xs font-bold text-white">+{a.xp} XP</span>
                          </div>
                          <p className="mt-1 text-sm text-ink-500">{t('{module} · up to {n} a day', { module: m.module, n: a.daily_cap_person })}</p>
                          {a.offer_points > 0 && (
                            <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-gold-50 px-2.5 py-0.5 text-xs font-semibold text-gold-700"><Coins className="size-3" aria-hidden /><Text>Also earns offer-backed points</Text></p>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </section>
          </>
        );
      }}
    </Async>
  );
}
