'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv } from '@/components/ui/localized-elements';

import { CheckCircle2, CircleAlert, MapPin, Truck, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/field';
import { useApi } from '@/lib/hooks';
import { translateMessage } from '@/lib/i18n-core';
import { MATERIAL_INFO, type Material } from '@/shared/domain';
import { GUIDE_VERDICT_LABELS, RECYCLING_GUIDE, searchGuide, type GuideItem, type GuideVerdict } from '@/shared/recycling-guide';

const VERDICT = {
  YES: { tone: 'success' as const, icon: CheckCircle2, color: 'text-success-700' },
  SPECIAL: { tone: 'gold' as const, icon: CircleAlert, color: 'text-gold-700' },
  NO: { tone: 'neutral' as const, icon: XCircle, color: 'text-ink-500' },
} satisfies Record<GuideVerdict, unknown>;

const QUICK = ['cooking-oil', 'pizza-box', 'phone-laptop', 'styrofoam', 'batteries', 'cardboard', 'soft-plastic', 'glass'];

interface Collector {
  id: string;
  name: string;
  materials: Material[];
  days: string;
}

/**
 * "Can I recycle this?": type or tap an everyday item and get one of three
 * answers, what to do, and where it goes: any kiosk, or a partner collector
 * who can be booked to come to the house.
 */
export function RecyclingGuide({ kiosks, onBook }: { kiosks: { id: string; name: string; location: string }[]; onBook: (material: Material) => void }) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<GuideItem | null>(null);
  // Malay names are searchable too, so "minyak" finds used cooking oil.
  const results = useMemo(() => searchGuide(query, (item) => [translateMessage('ms', item.name)]).slice(0, 6), [query]);
  const shown = query.trim() ? results : [];

  return (
    <Card>
      <CardHeader title="Can I recycle this?" description="Type an item, in English or Malay, and see whether it can be recycled here, how to prepare it and where it goes." />
      <div className="space-y-4 p-5">
        <Input
          label="Item"
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setChosen(null);
          }}
          placeholder="e.g. pizza box, minyak masak, old phone"
          autoComplete="off"
        />
        {!query.trim() && (
          <LocalizedDiv className="flex flex-wrap gap-2" role="group" aria-label="Common questions">
            {QUICK.map((id) => {
              const item = RECYCLING_GUIDE.find((g) => g.id === id)!;
              return (
                <Button key={id} size="sm" variant="secondary" onClick={() => setChosen(item)}>
                  <Text>{item.name}</Text></Button>
              );
            })}
          </LocalizedDiv>
        )}
        {query.trim() && shown.length === 0 && (
          <p className="text-sm text-ink-600"><Text>Not in the guide yet. If you are unsure, keep it out of the recycling: one wrong item can spoil a whole bag. Ask at a kiosk.</Text></p>
        )}
        {shown.length > 0 && !chosen && (
          <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
            {shown.map((item) => {
              const v = VERDICT[item.verdict];
              return (
                <li key={item.id}>
                  <button type="button" onClick={() => setChosen(item)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-ink-25">
                    <span className="flex items-center gap-3">
                      <v.icon className={`size-5 shrink-0 ${v.color}`} aria-hidden />
                      <span className="text-[15px] font-semibold text-ink-900"><Text>{item.name}</Text></span>
                    </span>
                    <Badge tone={v.tone}><Text>{GUIDE_VERDICT_LABELS[item.verdict]}</Text></Badge>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {chosen && <Answer item={chosen} kiosks={kiosks} onBook={onBook} onBack={() => setChosen(null)} />}
      </div>
    </Card>
  );
}

function Answer({ item, kiosks, onBook, onBack }: { item: GuideItem; kiosks: { id: string; name: string; location: string }[]; onBook: (material: Material) => void; onBack: () => void }) {
  const v = VERDICT[item.verdict];
  const collectors = useApi<Collector[]>(item.material ? `/kitar/collectors?material=${item.material}` : null);
  return (
    <div className="animate-rise space-y-4 rounded-lg border border-ink-200 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <v.icon className={`mt-0.5 size-7 shrink-0 ${v.color}`} aria-hidden />
          <div>
            <p className="font-display text-lg font-bold text-ink-900"><Text>{item.name}</Text></p>
            <p className="text-sm font-semibold text-ink-700"><Text>{GUIDE_VERDICT_LABELS[item.verdict]}</Text></p>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={onBack}><Text>Another item</Text></Button>
      </div>
      <p className="text-[15px] text-ink-800"><Text>{item.how}</Text></p>
      {item.material && (
        <p className="text-sm text-ink-600"><Text>Counts as: </Text><strong><Text>{MATERIAL_INFO[item.material].label}</Text></strong></p>
      )}
      {item.material && kiosks.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-ink-900"><Text>Drop it off at</Text></p>
          <ul className="mt-2 space-y-1.5">
            {kiosks.map((k) => (
              <li key={k.id} className="flex items-start gap-2 text-sm text-ink-700">
                <MapPin className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden />
                <span><strong>{k.name}</strong> · <Text>{k.location}</Text></span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {item.material && collectors.data && collectors.data.length > 0 && (
        <div className="rounded-md bg-brand-50 p-4">
          <p className="text-sm font-semibold text-brand-800"><Text>Or have it collected from home</Text></p>
          <ul className="mt-1 space-y-0.5 text-sm text-brand-800">
            {collectors.data.map((c) => (
              <li key={c.id}>{c.name} · <Text>{c.days}</Text></li>
            ))}
          </ul>
          <Button size="sm" className="mt-3" onClick={() => onBook(item.material!)}>
            <Truck className="size-4" aria-hidden /><Text>Book a collection</Text></Button>
        </div>
      )}
    </div>
  );
}
