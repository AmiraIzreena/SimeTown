'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv } from '@/components/ui/localized-elements';

import { BookOpen, CircleHelp, Gauge, MapPin, PackageCheck, Store, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { HowItWorksSteps } from './how-it-works';
import { LimitsContent } from './limits-card';
import { KIOSK_HOURS, OPEN_SITES } from './sites';
import type { KitarOverview } from './types';

/** The Good to know section, which the Transaction tab's "New here?" link scrolls to. */
export const GOOD_TO_KNOW_ID = 'kitar-good-to-know';

interface Tile {
  title: string;
  icon: LucideIcon;
  /** A short answer, or one of the two longer sections the tile shows instead. */
  body: string | 'HOW_IT_WORKS' | 'LIMITS';
}

/** "Good to know", as in the prototype. Spending follows the spec: points per kg on a Shop Offer, the 30% rule for other points (BR30, BR12). */
const TILES: Tile[] = [
  { title: 'How Kitar works', icon: BookOpen, body: 'HOW_IT_WORKS' },
  {
    title: 'Accepted items',
    icon: PackageCheck,
    body: 'Plastic (PET and other), paper and cardboard, glass, aluminium and tins, e-waste, clothes and textiles, and used cooking oil. Items must be empty, dry and rinsed.',
  },
  {
    title: 'Spending points',
    icon: Store,
    body: 'Points per kg are spent on a member shop’s live Shop Offer, on the shop’s own terms: its discount and minimum spend. Other points, from campaigns and purchases, can be spent from 100 points (RM1), in whole ringgit, on up to 30% of one bill. You pay the rest as normal. You always confirm on your own phone. Points cannot be turned into cash or sent to another person.',
  },
  {
    title: 'Why did my item not count?',
    icon: CircleHelp,
    body: 'An item may not count when it is wet, greasy, mixed with other materials, or not the material that bin takes. Empty, dry and rinse items, and use the bin for your material.',
  },
  { title: 'Limits and rules', icon: Gauge, body: 'LIMITS' },
];

/** The tile the Transaction tab's "New here?" link opens. */
export const HOW_KITAR_WORKS = 'How Kitar works';

const STEPS = [
  { title: 'Scan the code on the bin’s screen.', body: 'It changes every 30 seconds. Each bin takes one material, such as paper or aluminium.' },
  { title: 'Put your items in the bin.', body: 'Its scale weighs them and sends the weight by itself, so you never type it.' },
  { title: 'Visitors recycle as a guest', body: 'and get an 8-letter code. A resident can claim it within 14 days, for XP only.' },
];

/** A kiosk with its coloured bins. Decorative: the label says what it shows. */
function KioskIllustration() {
  const bins = [
    [28, '#5B6CF0', '#4252C9'], [64, '#2E9CCA', '#1E7DA8'], [100, '#17A398', '#0F7F76'],
    [270, '#C9A21C', '#A3820F'], [306, '#6FAE30', '#528621'], [342, '#D45B8E', '#B03F70'],
  ] as const;
  return (
    <LocalizedDiv role="img" aria-label="Illustration of a recycling kiosk with coloured bins" className="relative h-40 overflow-hidden rounded-xl bg-gradient-to-br from-brand-600 to-brand-400">
      <svg viewBox="0 0 400 150" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" aria-hidden>
        <g opacity=".2" fill="#fff"><circle cx="340" cy="26" r="40" /><circle cx="48" cy="30" r="22" /></g>
        <rect x="0" y="128" width="400" height="22" fill="rgba(6,32,26,.3)" />
        <rect x="150" y="26" width="100" height="106" rx="12" fill="#F2F6F3" />
        <rect x="162" y="38" width="76" height="36" rx="6" fill="#232a2a" />
        <circle cx="200" cy="56" r="9" fill="none" stroke="#3FBF9C" strokeWidth="3" />
        <path d="M196 56l3 3 6-7" fill="none" stroke="#3FBF9C" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="170" y="84" width="60" height="22" rx="5" fill="#4c5757" />
        <rect x="178" y="92" width="44" height="6" rx="3" fill="#131818" />
        <rect x="160" y="114" width="80" height="8" rx="4" fill="#dbe0e0" />
        {bins.map(([x, body, lid]) => (
          <g key={x}>
            <rect x={x} y="84" width="30" height="46" rx="5" fill={body} />
            <rect x={x - 2} y="80" width="34" height="8" rx="4" fill={lid} />
          </g>
        ))}
      </svg>
      <span className="absolute left-3 top-2.5 rounded-full bg-black/30 px-2.5 py-0.5 text-xs font-semibold text-white" aria-hidden>
        <Text>Illustration of a recycling kiosk</Text>
      </span>
    </LocalizedDiv>
  );
}

/** The About tab, as in the prototype: the open kiosks, how a bin works, and short answers to common questions. */
/** `openTile` names a tile to open when the tab first shows, from the "New here?" link. The tab is rebuilt each time it is chosen. */
export function KitarAbout({ overview, openTile }: { overview?: KitarOverview; openTile?: string | null }) {
  const [tile, setTile] = useState<Tile | null>(() => TILES.find((t) => t.title === openTile) ?? null);
  return (
    <div className="space-y-6">
      <KioskIllustration />

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-ink-900"><Text>Recycling kiosks</Text></h2>
          <p className="text-sm text-ink-500"><Text>Open daily from 8:00 AM to 10:00 PM at every location.</Text></p>
        </div>
        <Card>
          <ul className="divide-y divide-ink-100">
            {OPEN_SITES.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-5 py-3.5">
                <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700">
                  <MapPin className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-ink-900"><Text>{s.name}</Text></span>
                  <span className="block text-sm text-ink-500"><Text>{s.location}</Text></span>
                </span>
                <Badge tone="success"><Text>Open daily</Text></Badge>
              </li>
            ))}
          </ul>
          <p className="sr-only"><Text>{KIOSK_HOURS}</Text></p>
        </Card>
      </section>

      <Card className="p-5">
        <ol className="space-y-3 text-[15px] text-ink-700">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-700 text-sm font-bold text-white">{i + 1}</span>
              <span>
                <strong className="text-ink-900"><Text>{s.title}</Text></strong> <Text>{s.body}</Text>
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <section id={GOOD_TO_KNOW_ID} tabIndex={-1} className="scroll-mt-24 space-y-3 rounded-xl focus:outline-none">
        <h2 className="text-lg font-semibold text-ink-900"><Text>Good to know</Text></h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {TILES.map((item) => (
            <button
              key={item.title}
              type="button"
              aria-haspopup="dialog"
              onClick={() => setTile(item)}
              className="glass-surface flex min-h-14 items-center gap-3 rounded-xl border px-4 py-3 text-left text-[15px] font-semibold text-ink-900 shadow-sm transition-colors duration-200 hover:border-brand-300 sm:min-h-28 sm:flex-col sm:justify-center sm:text-center"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700">
                <item.icon className="size-5" aria-hidden />
              </span>
              <Text>{item.title}</Text>
            </button>
          ))}
        </div>
      </section>

      <Modal open={tile !== null} onClose={() => setTile(null)} title={tile?.title ?? ''} footer={<Button onClick={() => setTile(null)}><Text>Got it</Text></Button>}>
        {tile?.body === 'HOW_IT_WORKS' ? (
          <HowItWorksSteps />
        ) : tile?.body === 'LIMITS' ? (
          <LimitsContent limits={overview?.limits} />
        ) : (
          <p className="text-[15px] leading-relaxed text-ink-700"><Text>{tile?.body}</Text></p>
        )}
      </Modal>
    </div>
  );
}
