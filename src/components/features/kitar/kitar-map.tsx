'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv } from '@/components/ui/localized-elements';

import { Cpu, MapPin, Plus } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { KioskMap } from './kiosk-map';
import { binsAt, KIOSK_HOURS, KIOSK_HOURS_SHORT, KITAR_SITES, MAP_CENTRE, type KitarSite } from './sites';
import { materialLabel, type KitarMachine } from './types';

const BIN_STATUS = { FULL: { label: 'Full', tone: 'warning' as const }, OFFLINE: { label: 'Offline', tone: 'neutral' as const } };
const APPROXIMATE = KITAR_SITES.some((s) => !s.verified);

/** What a bin shows in place of the hours: Full or Offline from the database, otherwise the kiosk's hours. */
function BinState({ bin }: { bin: KitarMachine }) {
  if (bin.status === 'ONLINE') return <span className="text-sm font-medium text-success-700"><Text>{KIOSK_HOURS_SHORT}</Text></span>;
  const status = BIN_STATUS[bin.status] ?? BIN_STATUS.OFFLINE;
  return <Badge tone={status.tone}><Text>{status.label}</Text></Badge>;
}

function SiteCard({ site, machines, selected, onSelect, onRecycleHere }: {
  site: KitarSite;
  machines?: KitarMachine[];
  selected: boolean;
  onSelect: () => void;
  onRecycleHere: (kiosk: string) => void;
}) {
  const t = useT();
  const open = site.status === 'OPEN';
  const bins = machines ? binsAt(site, machines) : [];
  return (
    <Card id={`kiosk-card-${site.id}`} className={cn('scroll-mt-24 p-5 transition-shadow duration-200', selected && 'border-brand-300 ring-2 ring-brand-500')}>
      {/* The card's heading is a button: it shows this kiosk on the map. */}
      <button type="button" aria-pressed={selected} onClick={onSelect} className="-m-2 flex w-[calc(100%+1rem)] items-start justify-between gap-3 rounded-lg p-2 text-left transition-colors duration-200 hover:bg-ink-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900">
        <span className="min-w-0">
          <span className="block text-lg font-semibold text-ink-900"><Text>{site.name}</Text></span>
          <span className="block text-sm text-ink-500"><Text>{t('Serves: {areas}', { areas: site.serves.join(', ') })}</Text></span>
          <span className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
            <MapPin className="size-4" aria-hidden /><Text>Show on map</Text></span>
        </span>
        <Badge tone={open ? 'success' : 'neutral'}><Text>{open ? 'Open daily' : 'Coming soon'}</Text></Badge>
      </button>
      <p className="mt-3 text-[15px] text-ink-800"><Text>{site.location ?? 'Location coming soon'}</Text></p>
      {open ? (
        <>
          <p className="mt-1 text-sm text-ink-500"><Text>{KIOSK_HOURS}</Text></p>
          <p className="mt-1 text-sm text-ink-500"><Text>Each bin takes one type of item. Scan the code on the bin’s screen to start.</Text></p>
          {machines && (
            bins.length === 0 ? (
              <p className="mt-4 text-sm text-ink-500"><Text>No bins with a scale at this kiosk yet.</Text></p>
            ) : (
              <ul className="mt-4 space-y-2" aria-label={t('Bins at this kiosk')}>
                {bins.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 rounded-lg border border-ink-200 p-3">
                    <span className="flex min-w-0 items-center gap-3">
                      <Cpu className="size-5 shrink-0 text-brand-700" aria-hidden />
                      <span className="min-w-0">
                        <span className="block text-[15px] font-semibold text-ink-900"><Text>{b.name}</Text></span>
                        <span className="block text-sm text-ink-500"><Text>{b.material ? materialLabel(b.material) : 'Any material'}</Text></span>
                      </span>
                    </span>
                    <BinState bin={b} />
                  </li>
                ))}
              </ul>
            )
          )}
          {site.kiosk && (
            <Button size="lg" className="mt-4 w-full sm:w-auto" onClick={() => onRecycleHere(site.kiosk!)}>
              <Plus className="size-5" aria-hidden /><Text>Recycle here</Text></Button>
          )}
        </>
      ) : (
        <p className="mt-1 text-sm text-ink-500"><Text>This kiosk is not open yet. The township is still choosing its site.</Text></p>
      )}
    </Card>
  );
}

/**
 * The Map tab: an OpenStreetMap map of the four kiosk sites, and a card for each.
 * A tap on a pin highlights its card; a tap on a card moves the map to its pin.
 * The sites and their positions are fixed (sites.ts); only the bins and their
 * Full or Offline status come from the database.
 */
export function KitarMap({ machines, onRecycleHere }: { machines?: KitarMachine[]; onRecycleHere: (kiosk: string) => void }) {
  const t = useT();
  const [selectedId, setSelectedId] = useState<KitarSite['id']>(KITAR_SITES[0]!.id);
  // Counts card taps; each one asks the map to move to the chosen kiosk.
  const [focus, setFocus] = useState(0);

  const selectFromPin = useCallback((id: KitarSite['id']) => {
    setSelectedId(id);
    const card = document.getElementById(`kiosk-card-${id}`);
    card?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, []);
  const selectFromCard = (id: KitarSite['id']) => {
    setSelectedId(id);
    setFocus((n) => n + 1);
  };

  // The pin's popup: the kiosk, its bins and their status, as on the card. Built with text nodes, never HTML strings.
  const popupFor = useCallback(
    (site: KitarSite) => {
      const root = document.createElement('div');
      root.className = 'space-y-1 text-sm text-ink-700';
      const line = (text: string, className: string, parent: HTMLElement = root) => {
        const el = document.createElement(parent === root ? 'p' : 'li');
        el.className = className;
        el.textContent = text;
        parent.append(el);
      };
      line(site.name, 'm-0 text-[15px] font-semibold text-ink-900');
      if (site.status !== 'OPEN') {
        line(t('Coming soon'), 'm-0');
        line(t('Location coming soon'), 'm-0 text-ink-500');
        return root;
      }
      line(t(KIOSK_HOURS), 'm-0 text-ink-500');
      const bins = machines ? binsAt(site, machines) : null;
      if (bins && bins.length === 0) line(t('No bins with a scale at this kiosk yet.'), 'm-0');
      if (bins && bins.length > 0) {
        const list = document.createElement('ul');
        list.className = 'm-0 mt-1 list-none space-y-1 p-0';
        for (const b of bins) {
          const status = b.status === 'ONLINE' ? t(KIOSK_HOURS_SHORT) : t((BIN_STATUS[b.status] ?? BIN_STATUS.OFFLINE).label);
          line(`${b.name} · ${t(b.material ? materialLabel(b.material) : 'Any material')} · ${status}`, 'm-0', list);
        }
        root.append(list);
      }
      return root;
    },
    [machines, t],
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ink-900"><Text>Kitar locations</Text></h2>
        <p className="text-sm text-ink-500"><Text>Tap a pin or a kiosk card to see its bins.</Text></p>
      </div>

      <div>
        <LocalizedDiv role="group" aria-label="Map of recycling kiosks in Elmina" className="relative isolate z-0 h-80 overflow-hidden rounded-xl border border-ink-200 bg-ink-50 sm:h-96">
          <KioskMap sites={KITAR_SITES} centre={MAP_CENTRE} selectedId={selectedId} focus={focus} onSelect={selectFromPin} popupFor={popupFor} />
        </LocalizedDiv>
        {APPROXIMATE && <p className="mt-1.5 text-xs text-ink-500"><Text>Pin positions are approximate.</Text></p>}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-500" aria-hidden>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-full border-2 border-white bg-brand-600 shadow-sm" /><Text>{KIOSK_HOURS}</Text></span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-full border-2 border-ink-400 bg-white shadow-sm" /><Text>Coming soon</Text></span>
      </div>

      {/* The same sites as a plain list, for screen readers. */}
      <ul className="sr-only" aria-label={t('Kitar locations')}>
        {KITAR_SITES.map((s) => (
          <li key={s.id}>
            <Text>{s.name}</Text>: <Text>{s.status === 'OPEN' ? KIOSK_HOURS : 'Coming soon'}</Text>. <Text>{s.location ?? 'Location coming soon'}</Text>. <Text>{t('Serves: {areas}', { areas: s.serves.join(', ') })}</Text>.
          </li>
        ))}
      </ul>

      <div className="grid gap-4 md:grid-cols-2">
        {KITAR_SITES.map((s) => (
          <SiteCard key={s.id} site={s} machines={machines} selected={s.id === selectedId} onSelect={() => selectFromCard(s.id)} onRecycleHere={onRecycleHere} />
        ))}
      </div>
    </div>
  );
}
