'use client';

import { History as HistoryIcon, SearchX } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { FilterBar, FilterChips, FilterMenu, FilterRow, FilterSummary, SearchField } from '@/components/ui/filter-bar';
import { Text } from '@/components/ui/localized-text';
import { DataTable, type Column } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { formatDate, formatKg, timeAgo } from '@/lib/format';
import { usePaged } from '@/lib/hooks';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { MATERIALS, MATERIAL_INFO, type Material } from '@/shared/domain';

/**
 * Recycling collections → History: every collection, newest collection day first, with what the household logged
 * (the weight they typed, and when), what was counted, the gate record, the outcome and who settled it. Search and
 * filters run on the server, so they cover every collection, not only the ones loaded.
 */

type Outcome = 'BOOKED' | 'CREDITED' | 'NO_REWARD' | 'MISSED' | 'CANCELLED';
interface Row {
  id: string;
  day: string;
  slot: 'MORNING' | 'AFTERNOON';
  status: 'REQUESTED' | 'CONFIRMED' | 'COLLECTED' | 'CANCELLED' | 'MISSED';
  materials: Material[];
  items: string;
  reported_weight_g: number | null;
  reported_at: string | null;
  weight_g: number | null;
  limit_hit: string | null;
  settled_by: 'SYSTEM' | 'STAFF' | null;
  gate_scanned: boolean;
  collector_at_gate: boolean;
  collector: string;
  resident: string;
  township: string;
  house: string;
}
interface Extra {
  total: number;
  counts: Record<'all' | Lowercase<Outcome>, number>;
  collectors: { id: string; name: string }[];
}

const OUTCOMES: { key: Outcome; label: string; tone: 'brand' | 'success' | 'neutral' | 'warning' }[] = [
  { key: 'BOOKED', label: 'Booked', tone: 'brand' },
  { key: 'CREDITED', label: 'Credited', tone: 'success' },
  { key: 'NO_REWARD', label: 'No reward', tone: 'neutral' },
  { key: 'MISSED', label: 'Missed', tone: 'warning' },
  { key: 'CANCELLED', label: 'Cancelled', tone: 'neutral' },
];
const outcomeOf = (x: Row): Outcome =>
  x.status === 'REQUESTED' || x.status === 'CONFIRMED' ? 'BOOKED' : x.status === 'COLLECTED' ? (x.weight_g != null ? 'CREDITED' : 'NO_REWARD') : x.status;
const SLOT = { MORNING: 'Morning', AFTERNOON: 'Afternoon' } as const;

/** What the gate knows about the collector that day. */
function gateOf(x: Row): { label: string; tone: string } {
  if (x.gate_scanned) return { label: 'Scanned in', tone: 'text-success-700' };
  if (x.collector_at_gate) return { label: 'Scanned in for another home', tone: 'text-success-700' };
  if (x.status === 'REQUESTED' || x.status === 'CONFIRMED') return { label: 'Not yet', tone: 'text-ink-500' };
  if (x.status === 'CANCELLED') return { label: '–', tone: 'text-ink-400' };
  return { label: 'No record', tone: 'text-accent-700' };
}

export function CollectionHistory({ scope, hq }: { scope: string; hq: boolean }) {
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 300);
  const [outcome, setOutcome] = useState<Outcome | 'ALL'>('ALL');
  const [collectorId, setCollectorId] = useState('');
  const [material, setMaterial] = useState<Material | ''>('');
  const [days, setDays] = useState('');
  const [settledBy, setSettledBy] = useState<'' | 'SYSTEM' | 'STAFF'>('');

  const query = new URLSearchParams(scope.replace(/^\?/, ''));
  query.set('limit', '25');
  if (q) query.set('q', q);
  if (outcome !== 'ALL') query.set('outcome', outcome);
  if (collectorId) query.set('collectorId', collectorId);
  if (material) query.set('material', material);
  if (days) query.set('days', days);
  if (settledBy) query.set('settledBy', settledBy);
  const list = usePaged<Row, Extra>(`/admin/kitar/collections/history?${query}`, { keepPrevious: true });
  const first = list.first;
  const filtered = Boolean(q) || outcome !== 'ALL' || Boolean(collectorId || material || days || settledBy);
  const clear = () => {
    setSearch('');
    setOutcome('ALL');
    setCollectorId('');
    setMaterial('');
    setDays('');
    setSettledBy('');
  };

  const columns: Column<Row>[] = [
    {
      header: 'Collection day',
      cell: (x) => <span className="block whitespace-nowrap"><span className="block font-medium text-ink-900"><Text>{formatDate(x.day)}</Text></span><span className="block text-xs text-ink-500"><Text>{SLOT[x.slot]}</Text></span></span>,
    },
    {
      header: 'Household',
      cell: (x) => (
        <span className="block min-w-0 md:min-w-36">
          <span className="block font-medium text-ink-900"><Text>{x.house}</Text></span>
          <span className="block text-xs text-ink-500">{x.resident}{hq && <> · <Text>{x.township}</Text></>}</span>
        </span>
      ),
    },
    {
      header: 'Outcome',
      cell: (x) => {
        const o = OUTCOMES.find((item) => item.key === outcomeOf(x))!;
        return (
          <span className="block">
            <Badge tone={o.tone}><Text>{o.label}</Text></Badge>
            {x.settled_by && <span className="mt-1 block text-xs text-ink-500"><Text>{x.settled_by === 'SYSTEM' ? 'By the system' : 'By staff'}</Text></span>}
            {x.limit_hit && <span className="block text-xs text-warning-700"><Text>Reward limit reached</Text></span>}
          </span>
        );
      },
    },
    {
      header: 'Logged by household',
      align: 'right',
      cell: (x) => (x.reported_weight_g != null ? (
        <span className="block whitespace-nowrap"><span className="block font-semibold text-ink-900"><Text>{formatKg(x.reported_weight_g)}</Text></span>{x.reported_at && <span className="block text-xs text-ink-500"><Text>{timeAgo(x.reported_at)}</Text></span>}</span>
      ) : <span className="text-ink-400">–</span>),
    },
    {
      header: 'Counted',
      align: 'right',
      cell: (x) => (x.weight_g != null ? (
        <span className="block whitespace-nowrap">
          <span className="block font-semibold text-ink-900"><Text>{formatKg(x.weight_g)}</Text></span>
          {x.reported_weight_g != null && x.weight_g < x.reported_weight_g && <span className="block text-xs text-ink-500"><Text>Up to the maximum</Text></span>}
        </span>
      ) : <span className="text-ink-400">–</span>),
    },
    {
      header: 'Gate record',
      cell: (x) => { const g = gateOf(x); return <span className={cn('block text-sm font-medium md:min-w-24', g.tone)}><Text>{g.label}</Text></span>; },
    },
    // Who collected it and what, last: useful detail, not what decides the outcome.
    { header: 'Collector', cell: (x) => <span className="block text-ink-800 md:min-w-24">{x.collector}</span> },
    {
      header: 'Items',
      desktopOnly: true,
      cell: (x) => (
        <span className="block max-w-56" title={x.items}>
          <span className="block text-xs font-medium text-ink-600">{x.materials.map((m) => <Text key={m}>{`${MATERIAL_INFO[m].label}. `}</Text>)}</span>
          <span className="block truncate text-ink-800">{x.items}</span>
        </span>
      ),
    },
  ];

  return (
    <section className="space-y-5" aria-labelledby="history-title">
      <div>
        <h2 id="history-title" className="font-display text-xl font-bold text-ink-900"><Text>Collection history</Text></h2>
        <p className="mt-1 text-sm text-ink-500"><Text>Every collection, with the weight the household logged, what was counted, the gate record and who settled it.</Text></p>
      </div>
      <FilterBar
        search={<SearchField value={search} onChange={setSearch} label="Search collections" placeholder="Household, resident, collector or item" />}
        chips={
          <FilterRow label="Outcome">
            <FilterChips<Outcome | 'ALL'>
              label="Outcome" size="sm" value={outcome} onChange={setOutcome}
              options={[{ key: 'ALL', label: 'All', count: first?.counts?.all }, ...OUTCOMES.map((o) => ({ key: o.key, label: o.label, count: first?.counts?.[o.key.toLowerCase() as Lowercase<Outcome>] }))]}
            />
          </FilterRow>
        }
        controls={<>
          <FilterMenu<string> label="Collector" value={collectorId} onChange={setCollectorId} options={[{ value: '', label: 'All collectors' }, ...(first?.collectors ?? []).map((c) => ({ value: c.id, label: c.name, raw: true }))]} />
          <FilterMenu<Material | ''> label="Material" value={material} onChange={setMaterial} options={[{ value: '', label: 'All materials' }, ...MATERIALS.map((m) => ({ value: m, label: MATERIAL_INFO[m].label }))]} />
          <FilterMenu<string> label="Period" value={days} onChange={setDays} options={[{ value: '', label: 'All time' }, { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }]} />
          <FilterMenu<'' | 'SYSTEM' | 'STAFF'> label="Settled by" value={settledBy} onChange={setSettledBy} options={[{ value: '', label: 'Anyone' }, { value: 'SYSTEM', label: 'The system' }, { value: 'STAFF', label: 'Staff' }]} />
        </>}
        summary={first && <FilterSummary shown={list.items.length} total={first.total} noun={first.total === 1 ? 'collection' : 'collections'} onClear={filtered ? clear : undefined} />}
      />

      <div aria-busy={list.stale || list.isLoading || undefined} className={cn('transition-opacity duration-200', list.stale && 'pointer-events-none opacity-50')}>
        {list.error ? (
          <ErrorState error={list.error} onRetry={() => void list.reload()} />
        ) : list.isLoading || !first ? (
          <SkeletonList rows={6} />
        ) : list.items.length === 0 ? (
          filtered ? (
            <EmptyState icon={SearchX} title="No collections match your filters" action={<Button variant="secondary" onClick={clear}><Text>Clear filters</Text></Button>}>
              <Text>Try another outcome, collector or period, or search for a household or item.</Text>
            </EmptyState>
          ) : (
            <EmptyState icon={HistoryIcon} title="No collections yet"><Text>When households book collections, every one appears here.</Text></EmptyState>
          )
        ) : (
          <DataTable columns={columns} rows={list.items} keyOf={(x) => x.id} caption="Collection history" />
        )}
        {list.hasMore && (
          <div className="mt-5 text-center">
            <Button variant="secondary" onClick={() => void list.loadMore()} pending={list.loadingMore}><Text>Show more</Text></Button>
          </div>
        )}
      </div>
    </section>
  );
}
