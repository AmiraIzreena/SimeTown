'use client';

import { Text } from '@/components/ui/localized-text';

import { CalendarClock, ChevronDown, CircleCheckBig, LocateFixed, MapPin, Megaphone, Route, Trophy, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Badge, Card, Progress } from '@/components/ui/card';
import { formatDate, formatKm } from '@/lib/format';
import type { Campaign } from '@/lib/types';
import { formatPoints } from '@/shared/domain';
import { GERAK_CHALLENGE_RULES, gerakChallengeKind, type GerakChallengeKind } from '@/shared/gerak-challenges';
import { Reveal } from '@/components/ui/reveal';

/**
 * How each kind of Gerak challenge looks on its card: an icon, and the unit its progress is told in.
 * The tag and the one-sentence rule come from shared/gerak-challenges.ts, as on the console and the
 * public Challenges page, so it is always plain whether a loop must be finished.
 */
const KINDS: Record<GerakChallengeKind, { icon: LucideIcon; one: string; many: string }> = {
  WHOLE_LOOPS: { icon: CircleCheckBig, one: 'loop', many: 'loops' },
  LOOP_DISTANCE: { icon: Route, one: 'm', many: 'm' },
  ANY_TRIP: { icon: LocateFixed, one: 'trip', many: 'trips' },
  CHECKPOINTS: { icon: MapPin, one: 'checkpoint', many: 'checkpoints' },
};

/** How many challenges show before "Show all". */
const FIRST = 4;
const DAY_MS = 86_400_000;

/**
 * Gerak challenges as one section. Residents never join a challenge: every live one counts their
 * matching activity automatically, between its own start and end dates. The order is the server's
 * (ending soonest first). Each card says what it counts, how long is left and what is still to go.
 */
export function GerakChallenges({ campaigns }: { campaigns: Campaign[] }) {
  const [all, setAll] = useState(false);
  // Read the clock once, when the section first shows: "Ends in N days" needs no finer precision.
  const [now] = useState(() => Date.now());
  const shown = all ? campaigns : campaigns.slice(0, FIRST);
  return (
    <section aria-labelledby="challenges-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="challenges-title" className="text-lg font-semibold tracking-tight"><Text>Challenges</Text></h2>
          <p className="mt-0.5 text-sm text-ink-500"><Text>You are in every challenge automatically. What you walk, run or ride counts towards all of them at once.</Text></p>
        </div>
        {campaigns.length > 0 && <span className="map-key-chip"><Trophy className="size-3.5 text-gold-600" aria-hidden /><Text>{campaigns.length === 1 ? '1 running' : `${campaigns.length} running`}</Text></span>}
      </div>
      {campaigns.length === 0 ? (
        <Card className="flex items-center gap-3 p-5 text-[15px] text-ink-600">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-ink-100 text-ink-500"><Megaphone className="size-4.5" aria-hidden /></span>
          <Text>No challenges are running right now. Your loops and trips still earn Impact XP.</Text>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {shown.map((c, i) => (
              <Reveal key={c.id} index={i % 2} className="h-full">
                <ChallengeCard c={c} now={now} />
              </Reveal>
            ))}
          </div>
          {campaigns.length > FIRST && (
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              aria-expanded={all}
              className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-md text-[15px] font-semibold text-brand-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <Text>{all ? 'Show fewer challenges' : `Show all ${campaigns.length} challenges`}</Text>
              <ChevronDown className={`size-4 transition-transform duration-200 ${all ? 'rotate-180' : ''}`} aria-hidden />
            </button>
          )}
        </>
      )}
    </section>
  );
}

function ChallengeCard({ c, now }: { c: Campaign; now: number }) {
  const kind = gerakChallengeKind(c.activity, c.goal_metric);
  const counts = kind ? { ...KINDS[kind], ...GERAK_CHALLENGE_RULES[kind] } : { tag: 'Gerak activity', rule: '', icon: Route, one: 'time', many: 'times' };
  const progress = c.my_progress ?? 0;
  const earned = c.my_rewards ?? 0;
  const complete = earned >= c.per_person_cap;
  // A repeatable challenge pays once per multiple of the goal; the bar shows the way to the next one.
  // A do-it-once goal has no bar, as on the shared campaign card.
  const single = c.goal_metric === 'COUNT' && c.goal_target === 1;
  const toward = single ? 0 : progress % c.goal_target;
  const left = Math.max(0, c.goal_target - toward);
  // The goal is reached but not paid: the budget ran out or the monthly earning limit was hit.
  const waiting = !complete && Math.floor(progress / c.goal_target) > earned;
  const poolEmpty = c.pool_left_sen < c.reward_points;
  const days = Math.ceil((new Date(c.ends_at).getTime() - now) / DAY_MS);
  const amount = (n: number) => (c.goal_metric === 'COUNT' ? `${n} ${n === 1 ? counts.one : counts.many}` : c.quantity_unit === 'm' ? formatKm(n) : `${n}`);
  const quiet = complete || poolEmpty;

  return (
    <Card className={`challenge-card relative flex h-full flex-col overflow-hidden p-5 sm:p-6 ${quiet ? 'is-quiet' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={complete ? 'success' : 'gold'}><Text>{complete ? 'Reward earned' : `${formatPoints(c.reward_points)} points`}</Text></Badge>
        <Badge><Text>{counts.tag}</Text></Badge>
        <span className={`ml-auto inline-flex items-center gap-1 text-xs font-semibold ${days <= 3 && !complete ? 'text-warning-700' : 'text-ink-500'}`}>
          <CalendarClock className="size-3.5" aria-hidden />
          <Text>{days <= 1 ? 'Ends today' : `Ends in ${days} days`}</Text>
        </span>
      </div>
      <h3 className="mt-3 text-[17px] font-semibold">{c.title}</h3>
      <p className="mt-1 text-[15px] text-ink-600">{c.description}</p>
      {/* The counting rule, always shown, so nobody has to guess whether a loop must be finished. */}
      {counts.rule && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-ink-50 px-3 py-2.5 text-sm text-ink-700">
          <counts.icon className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
          <Text>{counts.rule}</Text>
        </p>
      )}
      <div className="flex-1" />

      {!complete && (
        <div className="mt-4">
          {!single && (
            <>
              <div className="mb-1.5 flex justify-between text-xs font-medium text-ink-600">
                <span className="tabular-nums"><Text>{amount(toward)}</Text></span>
                <span className="tabular-nums"><Text>{amount(c.goal_target)}</Text></span>
              </div>
              <Progress value={toward} max={c.goal_target} tone="gold" label={`Progress in ${c.title}`} />
            </>
          )}
          <p className="mt-2 text-sm font-medium text-ink-800">
            {waiting ? (
              <Text>{poolEmpty ? 'Goal reached. The reward budget is used up, so no points can be paid.' : 'Goal reached. Your points are waiting: they are paid the next time you take part, if your monthly limit allows.'}</Text>
            ) : poolEmpty ? (
              <Text>The reward budget is used up. Your activity still earns Impact XP.</Text>
            ) : (
              <Text>{`${amount(left)} to go`}</Text>
            )}
          </p>
        </div>
      )}

      <p className="mt-4 border-t border-ink-100 pt-3 text-xs text-ink-500">
        <Text>Funded by </Text><span className="font-semibold text-ink-700"><Text>{c.funder}</Text></span><Text> · ends </Text><Text>{formatDate(c.ends_at)}</Text>
      </p>
    </Card>
  );
}
