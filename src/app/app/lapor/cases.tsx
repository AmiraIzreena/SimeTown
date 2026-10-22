'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedImg } from '@/components/ui/localized-elements';

import { Archive, Bike, CheckCircle2, ChevronDown, DoorOpen, Flag, MessageSquare, Package, Recycle, RotateCcw, SearchX, Truck, type LucideIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/field';
import { FilterBar, FilterChips, FilterRow, FilterSegmented, FilterSummary, SearchField } from '@/components/ui/filter-bar';
import { SubNav } from '@/components/ui/sub-nav';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { useAction, usePaged } from '@/lib/hooks';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { CATEGORY_LABELS, REPORT_PLACE_LABELS, REPORT_SECTION_PLACES, REPORT_SECTIONS, RESIDENT_STATUS, SECTION_TAB, type IncidentStatus, type ReportPlace, type ReportSection } from '@/shared/incidents';

interface Report {
  reference: string;
  category: string;
  place: ReportPlace;
  hasPhoto: boolean;
  status: IncidentStatus;
  summary: string;
  createdAt: string;
  outcome: string | null;
  awaitingYou: boolean;
  handled: boolean;
  canReopen: boolean;
  timeline: { kind: string; body: string | null; at: string; mine: boolean }[];
}
interface Referral {
  id: string;
  reason: string;
  tracking_no: string | null;
  ticket_ref: string | null;
  ticket_simulated: boolean;
  created_at: string;
  company: string | null;
  simulated: boolean;
  support: { name: string | null; url: string | null; phone: string | null } | null;
}
type View = 'ongoing' | 'finished';
interface Extra {
  disputeDays: number;
  counts: Record<View | 'awaiting', number>;
  places: Record<ReportPlace, number>;
  sections: Record<ReportSection, number>;
  referrals: Referral[];
}

/** Each type of report carries the same small icon wherever it appears. */
const PLACE_ICONS: Record<ReportPlace, LucideIcon> = { LOCKER: Archive, GUARDHOUSE_PARCEL: Package, GATE: DoorOpen, DELIVERY: Truck, OTHER: Flag, KITAR: Recycle, GERAK: Bike };

/** What a type with no reports says: which problems would appear under it. */
const PLACE_EMPTY: Record<ReportPlace, { title: string; text: string }> = {
  LOCKER: { title: 'No parcel locker reports', text: 'Problems with a locker, such as a door that will not open or a parcel stuck inside, appear here.' },
  GUARDHOUSE_PARCEL: { title: 'No guardhouse reports', text: 'Problems with parcels kept at the guardhouse, such as a guard who could not hand one over, appear here.' },
  GATE: { title: 'No gate or visitor reports', text: 'Problems at the main gate, such as a visitor or courier who was turned away, appear here.' },
  DELIVERY: { title: 'No delivery reports', text: 'Problems with a delivery, such as a late parcel or one marked delivered that is not here, appear here.' },
  OTHER: { title: 'No other reports', text: 'Reports about anything else appear here.' },
  KITAR: { title: 'No Kitar reports yet', text: 'Had a problem with a recycling bin, its weight or your points? Tap Report a problem on the Kitar page and follow it here.' },
  GERAK: { title: 'No Gerak reports yet', text: 'Had a problem on a loop, a checkpoint, the map, your distance or a challenge? Tap Report a problem on the Gerak page and follow it here.' },
};

/** The type as it appears in the address (/app/lapor?tab=cases&type=locker), so Parcels can link straight to its own reports. */
const TYPE_PARAM: Record<ReportPlace, string> = { LOCKER: 'locker', GUARDHOUSE_PARCEL: 'guardhouse', GATE: 'gate', DELIVERY: 'delivery', OTHER: 'other', KITAR: 'kitar', GERAK: 'gerak' };
/** Where a resident reports each section's problems, offered in its empty state. */
const SECTION_SOURCE: Partial<Record<ReportSection, { href: string; label: string }>> = {
  kitar: { href: '/app/kitar', label: 'Open Kitar' },
  gerak: { href: '/app/gerak', label: 'Open Gerak' },
};

const TONE: Record<IncidentStatus, 'gold' | 'brand' | 'warning' | 'success' | 'neutral' | 'danger'> = {
  OPEN: 'gold', ASSIGNED: 'brand', INVESTIGATING: 'brand', AWAITING_EXTERNAL_PARTY: 'warning', RESOLVED: 'success', REOPENED: 'danger', CLOSED: 'neutral',
};

/** A notification links to `/app/lapor?tab=cases#INC-000123`; this reads that reference, if any. */
const subscribeHash = (callback: () => void) => {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
};
const hashReference = () => (/^#INC-\d{6,}$/.test(window.location.hash) ? window.location.hash.slice(1) : null);

/**
 * Lapor → Parcel reports (tab=cases) or Gate reports (tab=gate), formerly My reports: problems a resident raised
 * from Parcels or Tamu, what the township office told them, their answers and reopening, and (parcels) the
 * problems sent to courier companies. Lapor wraps it in Suspense; its filters live in the address beside the tab.
 */
export function ParcelGateReports({ section }: { section: ReportSection }) {
  const params = useSearchParams();
  const tabParam = SECTION_TAB[section];
  const linked = useSyncExternalStore(subscribeHash, hashReference, () => null);
  // A linked report fills the search box, so the resident sees why the list shows just that one; clearing it shows them all.
  const [typed, setTyped] = useState<string | null>(null);
  const search = typed ?? linked ?? '';
  const q = useDebouncedValue(search.trim(), 300);
  const asked: View = params.get('view') === 'finished' ? 'finished' : 'ongoing';
  // Filters stay as they are when the resident moves between Ongoing and Finished.
  const router = useRouter();
  // The type is part of the address: Parcels links to its own section, and refresh or Back keeps it.
  const place: ReportPlace | 'ALL' = REPORT_SECTION_PLACES[section].find((p) => TYPE_PARAM[p] === params.get('type')) ?? 'ALL';
  const withParams = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    next.set('tab', tabParam);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const query = next.toString();
    return `/app/lapor?${query}`;
  };
  const setPlace = (next: ReportPlace | 'ALL') => router.replace(withParams({ type: next === 'ALL' ? null : TYPE_PARAM[next] }), { scroll: false });
  const [awaiting, setAwaiting] = useState(false);
  const path = (v: View) => `/incidents/mine?view=${v}&section=${section}${q ? `&q=${encodeURIComponent(q)}` : ''}${place !== 'ALL' ? `&place=${place}` : ''}${awaiting ? '&awaiting=true' : ''}`;
  const list = usePaged<Report, Extra>(path(asked), { keepPrevious: true });
  const counts = list.first?.counts;
  // A linked report that is already finished opens on the Finished pill, unless the resident chose a pill.
  const view: View = !params.get('view') && linked && q === linked && counts && counts.ongoing === 0 && counts.finished > 0 ? 'finished' : asked;
  const shown = usePaged<Report, Extra>(view === asked ? null : path(view), { keepPrevious: true });
  const active = view === asked ? list : shown;
  // The list animates in when its results change, not while the previous ones are still showing.
  const filterKey = `${view}:${q}:${place}:${awaiting}`;
  const [shownKey, setShownKey] = useState(filterKey);
  if (!active.stale && active.first && shownKey !== filterKey) setShownKey(filterKey);

  // Replies from the township office arrive while the page is open.
  const reload = useRef(active.reload);
  useEffect(() => { reload.current = active.reload; });
  useEffect(() => {
    const timer = setInterval(() => void reload.current(), 30_000);
    return () => clearInterval(timer);
  }, []);

  const data = active.first;
  // A linked report (from a notification) that belongs to another tab opens there instead.
  const sections = list.first?.sections;
  useEffect(() => {
    if (!linked || q !== linked || !sections || sections[section] > 0) return;
    const other = REPORT_SECTIONS.find((s) => s !== section && sections[s] > 0);
    if (other) router.replace(`/app/lapor?tab=${SECTION_TAB[other]}#${linked}`);
  }, [linked, q, sections, section, router]);
  const filtered = Boolean(q) || place !== 'ALL' || awaiting;
  const nothingAtAll = counts && counts.ongoing === 0 && counts.finished === 0 && !filtered;
  const clearFilters = () => {
    setTyped('');
    setPlace('ALL');
    setAwaiting(false);
  };
  const places = data?.places;

  return (
    <>
      <div className="space-y-5">
        {!nothingAtAll && (
          <FilterBar
            // Top line: what to look for, and whether to see only the reports the office is waiting on you for.
            search={
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <SearchField value={search} onChange={setTyped} label="Search my reports" placeholder="Reference or what you reported" className="min-w-0 flex-1" />
                <FilterSegmented<'ALL' | 'AWAITING'>
                  label="Which reports"
                  value={awaiting ? 'AWAITING' : 'ALL'}
                  onChange={(next) => setAwaiting(next === 'AWAITING')}
                  options={[{ key: 'ALL', label: 'All reports' }, { key: 'AWAITING', label: 'Needs your answer', count: counts?.awaiting ?? 0 }]}
                />
              </div>
            }
            // Every type in this tab shows, with its count; a tab with a single type (gate, Kitar, Gerak) has no type row.
            chips={REPORT_SECTION_PLACES[section].length > 1 ? (
              <FilterRow label="Type">
                <FilterChips<ReportPlace | 'ALL'>
                  label="Type of report"
                  size="sm"
                  value={place}
                  onChange={setPlace}
                  options={[
                    { key: 'ALL', label: 'All types' },
                    ...REPORT_SECTION_PLACES[section].map((p) => ({ key: p, label: REPORT_PLACE_LABELS[p], count: places?.[p] ?? 0 })),
                  ]}
                />
              </FilterRow>
            ) : undefined}
            summary={counts && <FilterSummary shown={active.items.length} total={counts[view]} noun={active.items.length === 1 ? 'report' : 'reports'} onClear={filtered ? clearFilters : undefined} live />}
          />
        )}
        {/* Ongoing / Finished sits right above the list it switches. */}
        {!nothingAtAll && (
          <SubNav
            label="Report status"
            value={view}
            items={[{ key: 'ongoing', label: 'Ongoing', count: counts?.ongoing }, { key: 'finished', label: 'Finished', count: counts?.finished }]}
            hrefOf={(key) => withParams({ view: key === 'ongoing' ? null : 'finished' })}
          />
        )}

        {/* Only this part changes when a filter or the status is picked; it dims while the new results load. */}
        <div aria-busy={active.stale || undefined} className={cn('space-y-5 transition-opacity duration-200', active.stale && 'pointer-events-none opacity-50')}>
        {active.error ? (
          <ErrorState error={active.error} onRetry={() => void active.reload()} />
        ) : active.isLoading || !data ? (
          <SkeletonList rows={3} />
        ) : nothingAtAll ? (
          section === 'kitar' || section === 'gerak' ? (
            // One type per tab: its own message, and a way to the page where such a problem is reported.
            <EmptyState
              icon={PLACE_ICONS[section === 'kitar' ? 'KITAR' : 'GERAK']}
              title={PLACE_EMPTY[section === 'kitar' ? 'KITAR' : 'GERAK'].title}
              action={SECTION_SOURCE[section] && <Button variant="secondary" href={SECTION_SOURCE[section]!.href}><Text>{SECTION_SOURCE[section]!.label}</Text></Button>}
            >
              <Text>{PLACE_EMPTY[section === 'kitar' ? 'KITAR' : 'GERAK'].text}</Text>
            </EmptyState>
          ) : section === 'gate' ? (
            <EmptyState icon={DoorOpen} title="No gate reports yet"><Text>Had a problem at the main gate, such as a visitor or courier turned away? Report it from Tamu and follow it here.</Text></EmptyState>
          ) : (
            <EmptyState icon={Package} title="No parcel reports yet"><Text>Report a problem with a locker, a guardhouse parcel or a delivery from Parcels, and follow it here.</Text></EmptyState>
          )
        ) : active.items.length === 0 ? (
          place !== 'ALL' && !q && !awaiting ? (
            <EmptyState icon={PLACE_ICONS[place]} title={PLACE_EMPTY[place].title} action={<Button variant="secondary" onClick={() => setPlace('ALL')}><Text>Show all types</Text></Button>}>
              <Text>{PLACE_EMPTY[place].text}</Text>
            </EmptyState>
          ) : filtered ? (
            <EmptyState icon={SearchX} title="No reports match your filters" action={<Button variant="secondary" onClick={clearFilters}><Text>Clear filters</Text></Button>}>
              <Text>Try another type, or search by the reference, such as INC-000123, or a word from what you reported.</Text>
            </EmptyState>
          ) : view === 'ongoing' ? (
            <EmptyState icon={CheckCircle2} title="Nothing ongoing"><Text>Reports you make from Parcels or Tamu appear here while the township office works on them.</Text></EmptyState>
          ) : (
            <EmptyState icon={Flag} title="Nothing finished yet"><Text>Resolved and closed reports appear here.</Text></EmptyState>
          )
        ) : (
          <Card className="overflow-hidden">
            <ul key={shownKey} className="divide-y divide-ink-100">
              {active.items.map((r, i) => (
                <ReportRow key={r.reference} index={i} report={r} linked={linked === r.reference} disputeDays={data.disputeDays ?? 0} onChange={() => void active.reload()} />
              ))}
            </ul>
          </Card>
        )}
        {active.hasMore && (
          <div className="text-center">
            <Button variant="secondary" onClick={() => void active.loadMore()} pending={active.loadingMore}><Text>Show more</Text></Button>
          </div>
        )}
        </div>

        {section === 'parcels' && data?.referrals && data.referrals.length > 0 && (
          <Card>
            <CardHeader title="For courier companies to handle" description="Delivery problems go to the courier company. The township office is not involved unless it is a township problem too." />
            <ul className="divide-y divide-ink-100">
              {data.referrals.map((x) => (
                <li key={x.id} className="space-y-1 px-5 py-3 text-[15px]">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-ink-900">
                    <Truck className="size-4 text-brand-700" aria-hidden />{x.company ?? <Text>Courier company</Text>} · <Text>{CATEGORY_LABELS[x.reason] ?? x.reason}</Text>
                    {x.simulated && <Badge tone="neutral"><Text>Simulated company</Text></Badge>}
                  </p>
                  <p className="text-sm text-ink-600">
                    {x.tracking_no && <><span className="font-mono">{x.tracking_no}</span> · </>}<Text>{formatDateTime(x.created_at)}</Text>
                    {x.ticket_ref && <> · <Text>{x.ticket_simulated ? `Simulated reference ${x.ticket_ref}` : `Reference ${x.ticket_ref}`}</Text></>}
                  </p>
                  {x.support ? (
                    <p className="text-sm text-ink-700">
                      <Text>Contact:</Text> {x.support.name}{x.support.phone && ` · ${x.support.phone}`}
                      {x.support.url && <> · <a className="font-semibold text-brand-700 underline" href={x.support.url} target="_blank" rel="noopener noreferrer"><Text>support page</Text></a></>}
                    </p>
                  ) : (
                    <p className="text-sm text-ink-600"><Text>Use the contact in the courier’s own app or message, or ask the shop where you ordered.</Text></p>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

/** The type of a report, as a small tag beside its title. */
function PlaceTag({ place }: { place: ReportPlace }) {
  const Icon = PLACE_ICONS[place];
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-700">
      <Icon className="size-3.5" aria-hidden /><Text>{REPORT_PLACE_LABELS[place]}</Text>
    </span>
  );
}

/**
 * One report as a single line: what it is, its reference and date, and the township office's
 * latest word. It opens to the full conversation and the reply box. A report waiting for your
 * answer, or the one a notification linked to, opens by itself.
 */
function ReportRow({ report: r, index, linked, disputeDays, onChange }: { report: Report; index: number; linked: boolean; disputeDays: number; onChange: () => void }) {
  const [open, setOpen] = useState(r.awaitingYou || linked);
  const [reply, setReply] = useState('');
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState('');
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (linked) row.current?.scrollIntoView({ block: 'start' });
  }, [linked]);
  const send = useAction(() => api.post(`/incidents/mine/${r.reference}/reply`, { body: reply.trim() }), {
    success: 'Sent to the township office.',
    onSuccess: () => {
      setReply('');
      onChange();
    },
  });
  const reopen = useAction(() => api.post(`/incidents/mine/${r.reference}/reopen`, { reason: reason.trim() }), {
    success: 'Reopened. The township office will look at it again.',
    onSuccess: () => {
      setReopening(false);
      setReason('');
      onChange();
    },
  });
  const latest = [...r.timeline].reverse().find((e) => !e.mine && e.body);
  const panel = `report-${r.reference}`;

  return (
    <li ref={row} id={r.reference} style={{ '--i': Math.min(index, 12) } as CSSProperties} className={cn('value-line scroll-mt-24', open && 'bg-ink-25/60')}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={panel}
        className="flex w-full items-start gap-3 px-5 py-4 text-left transition-colors duration-200 hover:bg-brand-50/50 focus-visible:-outline-offset-2"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-display text-[16px] font-bold text-ink-900"><Text>{CATEGORY_LABELS[r.category] ?? 'Report'}</Text></span>
            <PlaceTag place={r.place} />
            {r.awaitingYou && <Badge tone="warning"><Text>Needs your answer</Text></Badge>}
          </span>
          <span className="mt-0.5 block truncate text-sm text-ink-500">
            {r.reference} · <Text>{formatDateTime(r.createdAt)}</Text>
            {latest && <> · <span className="text-ink-600">“<Text>{latest.body!}</Text>”</span></>}
          </span>
        </span>
        <Badge tone={TONE[r.status]} className="mt-0.5 shrink-0"><Text>{RESIDENT_STATUS[r.status]}</Text></Badge>
        <ChevronDown className={cn('mt-1 size-4 shrink-0 text-ink-500 transition-transform duration-200 ease-soft', open && 'rotate-180')} aria-hidden />
      </button>

      {open && (
        <div id={panel} className="content-in space-y-4 px-5 pb-5">
          {r.hasPhoto && (
            // The screenshot or photo sent with the report; tap to see it full size.
            <a href={`/api/v1/incident-photos/${r.reference}`} target="_blank" rel="noopener noreferrer" className="block w-fit overflow-hidden rounded-lg border border-ink-200 bg-white shadow-xs transition-shadow hover:shadow-md">
              <LocalizedImg src={`/api/v1/incident-photos/${r.reference}`} alt="Your screenshot or photo" className="max-h-56 w-auto object-contain" loading="lazy" />
            </a>
          )}
          {r.outcome && (
            <div className="rounded-lg bg-success-50 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-success-700"><CheckCircle2 className="size-4" aria-hidden /><Text>Outcome</Text></p>
              <p className="mt-1 text-[15px] text-ink-800"><Text>{r.outcome}</Text></p>
            </div>
          )}
          <ol className="space-y-2">
            {r.timeline.map((e, i) => (
              <li key={i} className={cn('rounded-lg px-3 py-2 text-[15px]', e.mine ? 'ml-8 bg-brand-50 text-ink-800' : 'mr-8 bg-white text-ink-800 shadow-xs ring-1 ring-ink-100', e.kind === 'INFO_REQUESTED' && 'border border-warning-600/30 bg-warning-50')}>
                <p className="text-xs text-ink-500"><Text>{e.mine ? 'You' : 'Township office'}</Text> · <Text>{formatDateTime(e.at)}</Text></p>
                {e.body && <p><Text>{e.body}</Text></p>}
              </li>
            ))}
          </ol>
          {!r.handled && (r.status === 'OPEN' || r.status === 'REOPENED') && <p className="text-sm text-ink-600"><Text>Waiting for someone in the township office to take it.</Text></p>}
          {r.status !== 'CLOSED' && r.status !== 'RESOLVED' && (
            <div className="space-y-2">
              <Textarea label={r.awaitingYou ? 'Your answer' : 'Add something'} value={reply} onChange={(event) => setReply(event.target.value)} maxLength={1000} />
              <Button size="sm" onClick={() => void send.run()} pending={send.pending} disabled={reply.trim().length < 2}><MessageSquare className="size-4" aria-hidden /><Text>Send</Text></Button>
            </div>
          )}
          {r.canReopen && !reopening && <Button size="sm" variant="ghost" onClick={() => setReopening(true)}><RotateCcw className="size-4" aria-hidden /><Text>Not fixed? Reopen it</Text></Button>}
          {reopening && (
            <div className="space-y-2 rounded-lg border border-ink-200 bg-white p-4">
              <p className="text-sm text-ink-600"><Text>{`You can reopen a report within ${disputeDays} days of its outcome. The township office’s admins are told.`}</Text></p>
              <Textarea label="What is still wrong" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void reopen.run()} pending={reopen.pending} disabled={reason.trim().length < 5}><Text>Reopen</Text></Button>
                <Button size="sm" variant="ghost" onClick={() => setReopening(false)}><Text>Cancel</Text></Button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
