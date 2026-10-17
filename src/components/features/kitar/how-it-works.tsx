'use client';

import { Text } from '@/components/ui/localized-text';

import { Plus, Ticket, type LucideIcon } from 'lucide-react';

/** The prototype's "How it works", from its Home tab. The kiosk's scale sends the weight: nobody types it (BR23). */
const STEPS = [
  { title: 'Get your items ready.', body: 'Empty, dry and rinse them. Sort by type: paper, plastic, glass, metal and so on.' },
  { title: 'Find your kiosk.', body: 'See the About tab for the locations. Each kiosk takes one type of item, so go to the one for your material.' },
  { title: 'Tap Recycle now', body: 'and scan the code on the bin’s screen.' },
  { title: 'Put your items in the bin.', body: 'Its scale weighs them and sends the weight by itself, so nobody types it.' },
  { title: 'See your reward.', body: 'You get points for every kg and 20 XP for the trip. Your goal bar moves forward.' },
  { title: 'Spend your points.', body: 'Use them at a member shop and confirm on your own phone.' },
];

const EARN: { title: string; icon: LucideIcon; body: string; value: string; sub: string }[] = [
  { title: 'Recycling kiosk', icon: Plus, body: 'Use the bin for your material. Its scale weighs your items and sends the weight for you.', value: 'Points per kg', sub: 'by material' },
  { title: 'Guest code', icon: Ticket, body: 'Recycled as a visitor? Enter your code within 14 days.', value: '+20 XP', sub: 'No points' },
];

/** The full "Step by step" guide and what each way of recycling earns. Shown in the About tab's "How Kitar works" tile. */
export function HowItWorksSteps() {
  return (
    <div className="space-y-5">
        <section>
          <h3 className="mb-3 text-[15px] font-semibold text-brand-700"><Text>Step by step</Text></h3>
          <ol className="space-y-3 text-[15px] text-ink-700">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-700 text-sm font-bold text-white">{i + 1}</span>
                <span>
                  <strong className="text-ink-900"><Text>{s.title}</Text></strong> <Text>{s.body}</Text>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-4 rounded-md bg-ink-50 px-3.5 py-2.5 text-sm text-ink-700">
            <Text>Recycling as a visitor? Get a guest code from the kiosk and keep your 8-letter code. A resident can claim it within 14 days, for XP only.</Text>
          </p>
        </section>

        <section>
          <h3 className="mb-3 text-[15px] font-semibold text-brand-700"><Text>What you earn</Text></h3>
          <ul className="space-y-2">
            {EARN.map((e) => (
              <li key={e.title} className="flex items-center gap-3 rounded-lg border border-ink-200 p-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700">
                  <e.icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-ink-900"><Text>{e.title}</Text></span>
                  <span className="block text-sm text-ink-500"><Text>{e.body}</Text></span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-semibold text-ink-900"><Text>{e.value}</Text></span>
                  <span className="block text-xs text-ink-500"><Text>{e.sub}</Text></span>
                </span>
              </li>
            ))}
          </ul>
        </section>
    </div>
  );
}
