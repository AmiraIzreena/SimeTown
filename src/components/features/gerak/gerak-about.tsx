'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv } from '@/components/ui/localized-elements';

import { CircleCheckBig, CircleHelp, Gauge, LocateFixed, MapPin, QrCode, Route, ShieldCheck, Trophy, type LucideIcon } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { Reveal } from '@/components/ui/reveal';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { GERAK_MODES, GERAK_MODE_INFO } from '@/shared/domain';
import { GERAK_CHALLENGE_RULES, type GerakChallengeKind } from '@/shared/gerak-challenges';

interface Tile {
  title: string;
  icon: LucideIcon;
  /** A short answer, or one of the longer sections the tile shows instead. */
  body: string | 'CHALLENGES' | 'FAIR_PLAY';
}

/** "Good to know", in the same tiles as the Kitar About tab (the steps are already on the page, so there is no How it works tile). Every answer follows what the server does. */
const TILES: Tile[] = [
  { title: 'How challenges count', icon: Trophy, body: 'CHALLENGES' },
  { title: 'Fair play', icon: Gauge, body: 'FAIR_PLAY' },
  {
    title: 'Your location and privacy',
    icon: ShieldCheck,
    body: 'Your location is read only between Start and Finish. On Finish, the first and last 200 m of the route (usually near home) are cut and never stored, and the whole route is deleted after 30 days. Scanning a poster sends no location at all.',
  },
  {
    title: 'Why did my loop not count?',
    icon: CircleHelp,
    body: 'A loop is complete only when every one of its checkpoints is ticked on the same day, by passing it on a tracked trip or by scanning its poster. Each checkpoint counts once a day. Check the loop’s card on the Loops tab to see which checkpoints are still to do today.',
  },
];

/** Three ways to take part, as on the Track and Loops tabs. */
const WAYS: { title: string; icon: LucideIcon; body: string }[] = [
  { title: 'Track a trip', icon: LocateFixed, body: 'Tap Start and walk, run, cycle or wheel anywhere in the township. Checkpoints you pass tick themselves. A trip counts once it has at least 200 m of fair-play distance, and the part of it on the township loops adds to your distance, finished or not.' },
  { title: 'Scan a checkpoint poster', icon: QrCode, body: 'The backup when GPS is weak: scan the QR code on the post, or type the code printed under it.' },
  { title: 'Finish a township loop', icon: Route, body: 'Tick every checkpoint of a loop on the same day. The loop’s full distance is credited to you.' },
];

const STEPS = [
  { title: 'Pick a loop.', body: 'The Loops tab lists every walking and cycling loop, with its checkpoints in order. Tap Show on map to see it.' },
  { title: 'Tap Start on the Track tab', body: 'and choose walk, run, cycle or wheelchair. Follow your trip on the map.' },
  { title: 'Pass each checkpoint.', body: 'It ticks itself as you go by. If GPS is weak, scan the poster at the post instead.' },
  { title: 'Tap Finish.', body: 'Your distance, checkpoints and any loops you completed are credited, and they count towards every challenge that is running.' },
];

/** The four kinds of Gerak challenge, in the words every challenge card uses (shared/gerak-challenges.ts). */
const CHALLENGE_KINDS: { kind: GerakChallengeKind; icon: LucideIcon }[] = [
  { kind: 'WHOLE_LOOPS', icon: CircleCheckBig },
  { kind: 'LOOP_DISTANCE', icon: Route },
  { kind: 'ANY_TRIP', icon: LocateFixed },
  { kind: 'CHECKPOINTS', icon: MapPin },
];

/** A township loop around a lake, with checkpoint posts, a walker and a cyclist. Decorative: the label says what it shows. */
function LoopIllustration() {
  return (
    <LocalizedDiv role="img" aria-label="Illustration of a township walking and cycling loop" className="relative h-40 overflow-hidden rounded-xl bg-gradient-to-br from-brand-600 to-brand-400 sm:h-44">
      <svg viewBox="0 0 400 150" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" aria-hidden>
        <g opacity=".2" fill="#fff"><circle cx="352" cy="24" r="38" /><circle cx="42" cy="28" r="18" /></g>
        {/* Park and lake. */}
        <path d="M0 96 C80 80 150 88 210 84 S330 74 400 86 V150 H0Z" fill="#2f7d55" opacity=".9" />
        <path d="M0 112 C90 100 170 108 250 104 S350 98 400 104 V150 H0Z" fill="#256847" />
        <ellipse cx="205" cy="112" rx="70" ry="14" fill="#9fd3e0" />
        <ellipse cx="205" cy="110" rx="52" ry="8" fill="#c4e6ee" opacity=".7" />
        {/* The loop: a teal walking path around the lake, with the gold cycling route beside it. */}
        <ellipse cx="205" cy="112" rx="104" ry="26" fill="none" stroke="#7fd6cf" strokeWidth="4" pathLength={1} className="gerak-ill-path" />
        <ellipse cx="205" cy="112" rx="126" ry="33" fill="none" stroke="#f3c24f" strokeWidth="3" strokeDasharray="9 7" className="gerak-ill-fade" />
        {/* Trees. */}
        {([[40, 92], [70, 98], [352, 90], [378, 96], [318, 94]] as const).map(([x, y]) => (
          <g key={x}>
            <rect x={x - 1.5} y={y} width="3" height="10" fill="#4a3424" />
            <circle cx={x} cy={y - 4} r="9" fill="#3c9a62" />
          </g>
        ))}
        {/* Checkpoint posts, each with a QR plate; the first two are ticked. */}
        {[[101, 112, true], [205, 86, true], [309, 112, false]].map(([x, y, done], i) => (
          <g key={String(x)} className="gerak-ill-cp" style={{ '--i': i } as CSSProperties}>
            <rect x={(x as number) - 1.5} y={(y as number) - 26} width="3" height="26" fill="#f7f1ea" />
            <rect x={(x as number) - 9} y={(y as number) - 40} width="18" height="16" rx="3" fill="#f7f1ea" />
            {done ? (
              <path d={`M${(x as number) - 4} ${(y as number) - 32} l3 3 l6 -6`} fill="none" stroke="#1a7f52" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <g fill="#3b2a1e"><rect x={(x as number) - 5} y={(y as number) - 36} width="4" height="4" /><rect x={(x as number) + 1} y={(y as number) - 36} width="4" height="4" /><rect x={(x as number) - 5} y={(y as number) - 30} width="4" height="4" /></g>
            )}
          </g>
        ))}
        {/* A walker on the path. */}
        <g transform="translate(150 96)" className="gerak-ill-walker" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" fill="none">
          <circle cx="0" cy="-16" r="3.6" fill="#fff" stroke="none" />
          <path d="M0 -12 L0 -2 M0 -2 L-5 7 M0 -2 L5 7 M0 -9 L-5 -4 M0 -9 L5 -5" />
        </g>
        {/* A cyclist on the outer route. */}
        <g transform="translate(268 132)" className="gerak-ill-cyclist" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" fill="none">
          <circle cx="-9" cy="0" r="6" />
          <circle cx="9" cy="0" r="6" />
          <path d="M-9 0 L-2 -9 L6 -9 L9 0 M-2 -9 L1 -15 M0 -15 L4 -15" />
          <circle cx="2" cy="-21" r="3.4" fill="#fff" stroke="none" />
        </g>
      </svg>
      <span className="absolute left-3 top-2.5 rounded-full bg-black/30 px-2.5 py-0.5 text-xs font-semibold text-white" aria-hidden>
        <Text>Illustration of a township loop</Text>
      </span>
    </LocalizedDiv>
  );
}

/** The About tab: how Gerak works, the three ways to take part, and short answers to common questions. */
export function GerakAbout() {
  const [tile, setTile] = useState<Tile | null>(null);
  return (
    <div className="space-y-8">
      <LoopIllustration />

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-ink-900"><Text>Ways to take part</Text></h2>
          <p className="text-sm text-ink-500"><Text>Every way earns Impact XP. Use whichever suits you; they all count together.</Text></p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {WAYS.map((w, i) => (
            <Reveal key={w.title} index={i} className="h-full">
              <Card className="flex h-full flex-col p-5">
                <span className="grid size-10 place-items-center rounded-md bg-brand-50 text-brand-700"><w.icon className="size-5" aria-hidden /></span>
                <h3 className="mt-3 text-[15px] font-semibold text-ink-900"><Text>{w.title}</Text></h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-600"><Text>{w.body}</Text></p>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink-900"><Text>Step by step</Text></h2>
        <Reveal>
          <Card className="p-5">
            <Steps />
          </Card>
        </Reveal>
      </section>

      <section className="space-y-3" aria-labelledby="gerak-challenge-kinds">
        <div>
          <h2 id="gerak-challenge-kinds" className="text-lg font-semibold text-ink-900"><Text>What each challenge counts</Text></h2>
          <p className="text-sm text-ink-500"><Text>You are in every challenge automatically. Each challenge card shows one of these tags, so you know whether you must finish the loop.</Text></p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CHALLENGE_KINDS.map(({ kind, icon: Icon }, i) => (
            <Reveal key={kind} index={i} className="h-full">
              <Card className="flex h-full flex-col p-5">
                <span className="grid size-10 place-items-center rounded-md bg-brand-50 text-brand-700"><Icon className="size-5" aria-hidden /></span>
                <h3 className="mt-3 text-[15px] font-semibold text-ink-900"><Text>{GERAK_CHALLENGE_RULES[kind].tag}</Text></h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-600"><Text>{GERAK_CHALLENGE_RULES[kind].rule}</Text></p>
              </Card>
            </Reveal>
          ))}
        </div>
        <Reveal>
          <p className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-900">
            <strong><Text>Example:</Text></strong>{' '}
            <Text>you walk half of a 0.6 km loop, about 0.3 km, then go home. A part-loops challenge goes up by about 0.3 km. A whole-loops challenge does not move until you finish every checkpoint of a loop on the same day.</Text>
          </p>
        </Reveal>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink-900"><Text>Good to know</Text></h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {TILES.map((item, i) => (
            <Reveal key={item.title} index={i} className="h-full">
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => setTile(item)}
                className="gerak-tile glass-surface flex size-full min-h-14 items-center gap-3 rounded-xl border px-4 py-3 text-left text-[15px] font-semibold text-ink-900 shadow-sm sm:min-h-28 sm:flex-col sm:justify-center sm:text-center"
              >
                <span className="gerak-tile-icon grid size-10 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700">
                  <item.icon className="size-5" aria-hidden />
                </span>
                <Text>{item.title}</Text>
              </button>
            </Reveal>
          ))}
        </div>
      </section>

      <Modal open={tile !== null} onClose={() => setTile(null)} title={tile?.title ?? ''} footer={<Button onClick={() => setTile(null)}><Text>Got it</Text></Button>}>
        {tile?.body === 'CHALLENGES' ? (
          <div className="space-y-4 text-[15px] text-ink-700">
            <p><Text>You never join a challenge. Every challenge that is running counts your activity automatically, from its own start date to its end date, so one walk can move several challenges at once.</Text></p>
            <p><Text>Each challenge counts one kind of activity, shown on its card:</Text></p>
            <ul className="space-y-2">
              {CHALLENGE_KINDS.map(({ kind }) => (
                <li key={kind} className="rounded-lg border border-ink-200 p-3">
                  <span className="block font-semibold text-ink-900"><Text>{GERAK_CHALLENGE_RULES[kind].tag}</Text></span>
                  <span className="block text-sm text-ink-600"><Text>{GERAK_CHALLENGE_RULES[kind].rule}</Text></span>
                </li>
              ))}
              <li className="rounded-lg border border-ink-200 p-3 text-sm text-ink-600">
                <Text>A loop you finish by scanning its posters counts its full distance in a part-loops challenge. A walk is never counted twice.</Text>
              </li>
            </ul>
            <p className="rounded-md bg-ink-50 px-3.5 py-2.5 text-sm"><Text>Points are paid from each challenge’s own budget. If the budget is used up, or you have reached the monthly points limit for you or your home, the reward waits; it is paid the next time you take part while the challenge is still running.</Text></p>
          </div>
        ) : tile?.body === 'FAIR_PLAY' ? (
          <div className="space-y-4 text-[15px] text-ink-700">
            <p><Text>Parts of a trip faster than the top speed for the activity do not count, so a car or motorbike ride never earns. The checks run on the server, not on your phone.</Text></p>
            <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
              {GERAK_MODES.map((m) => (
                <li key={m} className="flex items-center justify-between px-3.5 py-2.5">
                  <Text>{GERAK_MODE_INFO[m].label}</Text>
                  <span className="font-semibold tabular-nums text-ink-900"><Text>{`up to ${GERAK_MODE_INFO[m].maxSpeedKmh} km/h`}</Text></span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-[15px] leading-relaxed text-ink-700"><Text>{tile?.body}</Text></p>
        )}
      </Modal>
    </div>
  );
}

function Steps() {
  return (
    <ol className="space-y-3 text-[15px] text-ink-700">
      {STEPS.map((s, i) => (
        <li key={s.title} className="gerak-step flex gap-3" style={{ '--i': i } as CSSProperties}>
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-700 text-sm font-bold text-white">{i + 1}</span>
          <span>
            <strong className="text-ink-900"><Text>{s.title}</Text></strong> <Text>{s.body}</Text>
          </span>
        </li>
      ))}
    </ol>
  );
}
