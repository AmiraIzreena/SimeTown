'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedAside, LocalizedDiv, LocalizedImg } from '@/components/ui/localized-elements';

import { CheckCircle2, Clock, Flag, Package, PackageOpen, RefreshCw, Share2, Undo2, type LucideIcon } from 'lucide-react';
import { Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { LockerParcels, MyLateCollections } from '@/components/features/locker-parcels';
import { ParcelAbout } from '@/components/features/parcel-about';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ResidentParcelWalkthrough } from '@/components/features/parcel-walkthroughs';
import { OPEN_GUARDHOUSE_EVENT, PARCEL_TAB_EVENT } from '@/components/shell/parcel-bar';
import { ReportProblemDialog } from '@/components/features/report-problem';
import { Async, EmptyState, Skeleton, SkeletonCard, SkeletonList } from '@/components/ui/feedback';
import { QrCode } from '@/components/ui/qr';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { formatDateTime, timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

interface Parcel {
  id: string;
  courier: string;
  trackingNo: string | null;
  shelf: string;
  note: string | null;
  hasPhoto: boolean;
  status: 'WAITING' | 'COLLECTED' | 'RETURNED';
  code: string | null;
  loggedAt: string;
  collectedAt: string | null;
  collectedBy: string | null;
  problemReported: boolean;
  days: number;
  overdue: boolean;
}

type Tab = 'lockers' | 'guardhouse' | 'about';
type Place = Exclude<Tab, 'about'>;

/** A parcel card in the shape it loads into: who it is from and the shelf, then the QR code and the collection code. */
function GuardhouseSkeleton() {
  return (
    <LocalizedDiv role="status" aria-label="Loading" aria-busy="true" className="space-y-6">
      <Skeleton className="h-4 w-3/5" />
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1].map((i) => (
          <SkeletonCard key={i} className="overflow-hidden">
            <div className="flex items-start justify-between gap-3 border-b border-ink-100 p-5">
              <div className="flex-1">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="mt-2 h-3 w-28" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <div className="flex items-center gap-5 p-5">
              <Skeleton className="size-[132px] shrink-0" />
              <div className="flex-1 space-y-3">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-8 w-32" />
                <div className="flex gap-2"><Skeleton className="h-9 w-32" /><Skeleton className="h-9 w-28" /></div>
              </div>
            </div>
          </SkeletonCard>
        ))}
      </div>
    </LocalizedDiv>
  );
}

/** Lapor → Parcel & gate reports, opened on this tab's own type: locker reports from the lockers tab, guardhouse reports from the guardhouse tab. */
const reportsHref = (tab: Place) => '/app/lapor?tab=cases&type=' + (tab === 'guardhouse' ? 'guardhouse' : 'locker');

/** The collection steps for each tab: a short title to scan, and a detail line where it helps. */
const GUIDE: Record<Place, { steps: { title: string; detail?: string }[]; tip: { title: string; text: string } }> = {
  lockers: {
    steps: [
      { title: 'Go to your locker', detail: 'Your door number is on the parcel. The locker is open 24 hours.' },
      { title: 'Type the PIN or show the QR code', detail: 'At the locker, you can also open your door from this page with the station code.' },
      { title: 'Take your parcel and shut the door' },
    ],
    tip: { title: 'Someone else may have seen your code?', text: 'Tap Get a new code on the parcel. The old PIN and QR code stop working straight away.' },
  },
  guardhouse: {
    steps: [
      { title: 'Go to the guardhouse', detail: 'During its opening hours, shown at the top of this tab.' },
      { title: 'Show your code to the guard', detail: 'The code on the parcel: a collection code, or the pickup QR code for a locker parcel.' },
      { title: 'Collect your parcel', detail: 'The guard checks the code, and your ID for a locker parcel.' },
    ],
    tip: { title: 'Someone collecting for you?', text: 'Tap Share the code on the parcel and send it to them. The code works only for that parcel.' },
  },
};

/** An icon tile with a title and one or two lines under it, the text kept in one aligned column. */
function GuideNote({ icon: Icon, title, children, tone = 'brand' }: { icon: LucideIcon; title: string; children: ReactNode; tone?: 'brand' | 'ink' }) {
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden className={cn('grid size-8 shrink-0 place-items-center rounded-lg', tone === 'brand' ? 'bg-brand-100 text-brand-700' : 'bg-ink-100 text-ink-600')}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-snug text-ink-900"><Text>{title}</Text></p>
        <p className="mt-1 text-sm leading-relaxed text-ink-600"><Text>{children}</Text></p>
      </div>
    </div>
  );
}

/**
 * How to collect, beside the parcels: the steps for this tab as a connected list, one tip, and
 * where to go when a parcel is missing. Fills the space next to a single parcel with something useful.
 */
function CollectGuide({ tab, onMissing }: { tab: Place; onMissing: () => void }) {
  const guide = GUIDE[tab];
  return (
    <LocalizedAside aria-label="How to collect" className="stagger-in space-y-4 lg:sticky lg:top-24">
      <Card>
        <CardHeader title="How to collect" />
        <ol key={tab} className="px-5 pt-5">
          {guide.steps.map((step, i) => (
            <li key={step.title} style={{ '--i': i } as CSSProperties} className="guide-step relative flex gap-3.5 pb-5">
              {/* The line joining each step to the next. */}
              {i < guide.steps.length - 1 && <span aria-hidden className="absolute bottom-0 left-[0.9375rem] top-9 w-px bg-brand-200" />}
              <span aria-hidden className="guide-step-number relative grid size-8 shrink-0 place-items-center rounded-full border border-brand-200 bg-brand-50 text-sm font-bold text-brand-700">{i + 1}</span>
              <div className="min-w-0 pt-1">
                <p className="text-sm font-semibold leading-snug text-ink-900"><Text>{step.title}</Text></p>
                {step.detail && <p className="mt-1 text-sm leading-relaxed text-ink-600"><Text>{step.detail}</Text></p>}
              </div>
            </li>
          ))}
        </ol>
        <div className="border-t border-ink-100 p-4">
          <div className="rounded-lg bg-brand-50/70 p-3.5">
            <GuideNote icon={tab === 'guardhouse' ? Share2 : RefreshCw} title={guide.tip.title}>{guide.tip.text}</GuideNote>
          </div>
        </div>
      </Card>
      {/* On phones these two stay in the page header; on wider screens they live here, beside the parcels. */}
      <Card className="hidden p-5 lg:block">
        <GuideNote icon={PackageOpen} tone="ink" title="Parcel missing?"><Text>Tell us the tracking number. If it is already here, we will tell you where.</Text></GuideNote>
        <div className="mt-4 flex flex-wrap gap-2 pl-11">
          <Button size="sm" variant="secondary" onClick={onMissing}><PackageOpen className="size-4" aria-hidden /><Text>A parcel hasn’t arrived?</Text></Button>
          <Button size="sm" variant="ghost" href={reportsHref(tab)}><Flag className="size-4" aria-hidden /><Text>My reports</Text></Button>
        </div>
      </Card>
    </LocalizedAside>
  );
}

export default function ParcelsPage() {
  return <Suspense fallback={<SkeletonList rows={2} />}><ParcelsScreen /></Suspense>;
}

function ParcelsScreen() {
  const search = useSearchParams();
  const requestedTab = search.get('tab');
  const parcelId = search.get('parcel');
  const scrolledTo = useRef<string | null>(null);
  const parcels = useApi<{ parcels: Parcel[] }>('/parcels', { refreshInterval: 30_000 });
  const lockers = useApi<{ parcels: { state: string }[] }>('/lockers/my-parcels', { refreshInterval: 5_000 });
  const [chosen, setChosen] = useState<Tab | null>(null);
  // Locker parcels that could not go into the door are kept at the guardhouse, so they count there.
  const lockerAtGuardhouse = lockers.data?.parcels.filter((p) => p.state === 'RELOCATED_TO_STORAGE' || p.state === 'RETURN_PENDING').length ?? 0;
  const atGuardhouse = (parcels.data?.parcels.filter((p) => p.status === 'WAITING').length ?? 0) + lockerAtGuardhouse;
  const inLockers = lockers.data?.parcels.filter((p) => !['COLLECTED', 'RETURNED', 'RELOCATED_TO_STORAGE', 'RETURN_PENDING'].includes(p.state)).length ?? 0;
  // Until the resident picks a tab, open the one with something waiting.
  const tab: Tab = chosen ?? (requestedTab === 'guardhouse' || requestedTab === 'lockers' || requestedTab === 'about' ? requestedTab : inLockers === 0 && atGuardhouse > 0 ? 'guardhouse' : 'lockers');
  // The reports link and the guide follow the place last shown; About has no parcels of its own.
  const place: Place = tab === 'about' ? 'lockers' : tab;
  // The parcel bar above the page: it steps aside on the Guardhouse tab, and opens it from any other tab.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(PARCEL_TAB_EVENT, { detail: tab }));
  }, [tab]);
  useEffect(() => () => { window.dispatchEvent(new CustomEvent(PARCEL_TAB_EVENT, { detail: null })); }, []);
  useEffect(() => {
    const open = () => {
      setChosen('guardhouse');
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      requestAnimationFrame(() => document.getElementById('parcel-tabs')?.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' }));
    };
    window.addEventListener(OPEN_GUARDHOUSE_EVENT, open);
    return () => window.removeEventListener(OPEN_GUARDHOUSE_EVENT, open);
  }, []);
  useEffect(() => {
    if (parcelId && tab === 'guardhouse' && parcels.data && scrolledTo.current !== parcelId) {
      const target = document.getElementById(`parcel-${parcelId}`);
      if (target) { target.scrollIntoView({ block: 'center' }); scrolledTo.current = parcelId; }
    }
  }, [parcelId, tab, parcels.data]);
  const toast = useToast();
  const t = useT();
  // Which guardhouse parcel is being reported, and from where; or a parcel that has not arrived at all.
  const [problem, setProblem] = useState<{ parcel: Parcel; context: 'GUARD_WAITING' | 'GUARD_DONE' } | null>(null);
  const [missing, setMissing] = useState(false);

  const share = async (p: Parcel) => {
    const text = t('Collection code {code} for the parcel from {courier}, shelf {shelf} at the guardhouse.', { code: p.code!, courier: p.courier, shelf: p.shelf });
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        toast.show(t('Code copied'), 'success');
      }
    } catch {
      /* the person closed the share sheet */
    }
  };

  return (
    <>
      <PageHeader
        title="Parcels"
        description="Parcels for your home: in your own smart locker door, or kept at the guardhouse. Each has a one-time code that works only for that parcel. Someone collecting for you? Share the code with them."
        action={<>
          <ResidentParcelWalkthrough />
          <div className="flex flex-wrap gap-2 lg:hidden">
            <Button size="sm" variant="secondary" onClick={() => setMissing(true)}><PackageOpen className="size-4" aria-hidden /><Text>A parcel hasn’t arrived?</Text></Button>
            <Button size="sm" variant="ghost" href={reportsHref(place)}><Flag className="size-4" aria-hidden /><Text>My reports</Text></Button>
          </div>
        </>}
      />
      <div id="parcel-tabs" className="scroll-mt-24">
      <Tabs<Tab>
        label="Where the parcel is"
        value={tab}
        onChange={setChosen}
        items={[
          { key: 'lockers', label: 'Parcel lockers', count: inLockers || undefined },
          { key: 'guardhouse', label: 'Guardhouse', count: atGuardhouse || undefined },
          { key: 'about', label: 'About' },
        ]}
      />
      </div>
      <div className={cn('grid items-start gap-6', tab !== 'about' && 'lg:grid-cols-[minmax(0,1fr)_19rem] xl:grid-cols-[minmax(0,1fr)_21rem]')}>
      <div className="min-w-0">
      <TabPanel>
      {tab === 'lockers' && <LockerParcels />}
      {tab === 'about' && <div className="max-w-4xl"><ParcelAbout /></div>}
      {tab === 'guardhouse' && <Async state={parcels} skeleton={<GuardhouseSkeleton />}>
        {(data) => {
          const waiting = data.parcels.filter((p) => p.status === 'WAITING');
          const past = data.parcels.filter((p) => p.status !== 'WAITING');
          return (
            <div className="space-y-6">
              <p className="text-[15px] text-ink-600"><Text>Parcels the guard keeps for your home: left at the guardhouse by a courier, or too big for your locker door. Show the code to the guard to collect. They stay until you collect them.</Text></p>
              <LockerParcels view="guardhouse" />
              {waiting.length === 0 && lockerAtGuardhouse === 0 ? (
                <EmptyState icon={Package} title="Nothing at the guardhouse"><Text>When a parcel is left at the guardhouse for your home, you are told at once and the code appears here.</Text></EmptyState>
              ) : waiting.length > 0 && (
                <div className="stagger-in grid gap-4 2xl:grid-cols-2">
                  {waiting.map((p) => (
                    <Card key={p.id} id={`parcel-${p.id}`} className={`scroll-mt-20 overflow-hidden ${parcelId === p.id ? 'ring-2 ring-brand-400' : ''}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 p-5">
                        <div>
                          <p className="font-display text-lg font-bold text-ink-900"><Text>{`From ${p.courier}`}</Text></p>
                          <p className="text-sm text-ink-500"><Text>{`Arrived ${timeAgo(p.loggedAt)}`}</Text>{p.trackingNo && ` · ${p.trackingNo}`}</p>
                          <p className={cn('mt-1 inline-flex items-center gap-1.5 text-sm font-semibold', p.overdue ? 'text-warning-700' : 'text-ink-700')}><Clock className="size-4" aria-hidden /><Text>{p.days === 0 ? 'Under a day' : p.days === 1 ? '1 day uncollected' : `${p.days} days uncollected`}</Text></p>
                        </div>
                        <span className="flex flex-wrap items-center gap-1.5">
                          {p.overdue && <Badge tone="warning"><Text>Overdue</Text></Badge>}
                          <Badge tone="gold"><Text>{`Shelf ${p.shelf}`}</Text></Badge>
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-5 p-5">
                        <QrCode value={`KITAPARCEL:${p.code}`} size={132} label="Collection code as a QR code" />
                        <div className="min-w-0 flex-1 space-y-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Collection code</Text></p>
                            <p className="parcel-code text-3xl font-bold text-ink-900">{p.code}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="secondary" onClick={() => void share(p)}>
                              <Share2 className="size-4" aria-hidden /><Text>Share the code</Text></Button>
                            <Button size="sm" variant="ghost" onClick={() => setProblem({ parcel: p, context: 'GUARD_WAITING' })}><Flag className="size-4" aria-hidden /><Text>Report a problem</Text></Button>
                          </div>
                        </div>
                      </div>
                      {(p.hasPhoto || p.note) && (
                        <div className="space-y-3 border-t border-ink-100 p-5">
                          {p.note && <p className="text-sm text-ink-700">{p.note}</p>}
                          {p.hasPhoto && <LocalizedImg src={`/api/v1/parcels/${p.id}/photo`} alt="Photo of the parcel taken at the guardhouse" loading="lazy" className="max-h-48 w-full rounded-md border border-ink-200 object-cover" />}
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              )}

              {past.length > 0 && (
                <Card>
                  <CardHeader title="Collected from the guardhouse" description="The last 30 days. Told that a parcel was collected, but it was not you? Tell us the same day." />
                  <ul className="divide-y divide-ink-100">
                    {past.map((p) => (
                      <li key={p.id} id={`parcel-${p.id}`} className={`flex scroll-mt-20 flex-wrap items-center justify-between gap-3 px-5 py-3 ${parcelId === p.id ? 'bg-brand-50' : ''}`}>
                        <div className="flex min-w-0 items-start gap-3">
                          {p.status === 'COLLECTED' ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success-700" aria-hidden /> : <Undo2 className="mt-0.5 size-5 shrink-0 text-ink-400" aria-hidden />}
                          <div className="min-w-0">
                            <p className="text-[15px] font-semibold text-ink-900"><Text>{`From ${p.courier}`}</Text></p>
                            <p className="text-sm text-ink-500">
                              <Text>{p.status === 'COLLECTED' ? 'Collected' : 'Returned to the courier'}</Text>
                              {p.collectedAt && <> · <Text>{formatDateTime(p.collectedAt)}</Text></>}
                              {p.collectedBy && <> · <Text>by </Text>{p.collectedBy}</>}
                            </p>
                          </div>
                        </div>
                        {p.status === 'COLLECTED' &&
                          (p.problemReported ? (
                            <Badge tone="warning"><Text>Being looked into</Text></Badge>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => setProblem({ parcel: p, context: 'GUARD_DONE' })}>
                              <Flag className="size-4" aria-hidden /><Text>Report</Text></Button>
                          ))}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              <MyLateCollections />
            </div>
          );
        }}
      </Async>}
      </TabPanel>
      </div>
      {tab !== 'about' && <CollectGuide tab={tab} onMissing={() => setMissing(true)} />}
      </div>

      <ReportProblemDialog
        open={problem !== null}
        onClose={() => setProblem(null)}
        context={problem?.context ?? 'GUARD_DONE'}
        guardParcelId={problem?.parcel.id}
        subtitle={problem ? `${problem.parcel.courier} · ${t('shelf')} ${problem.parcel.shelf}` : undefined}
        onFiled={() => void parcels.mutate()}
      />
      <ReportProblemDialog open={missing} onClose={() => setMissing(false)} context="NOT_ARRIVED" subtitle="Tell us the tracking number. If it is already here, we will tell you where." />
    </>
  );
}
