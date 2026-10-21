'use client';

import {
  Accessibility, ArrowRight, CalendarClock, CheckCheck, CircleHelp, Construction, HandHeart, Info, LayoutGrid, Lightbulb, MapPin, MapPinned, SearchX, Timer, Trash2, TriangleAlert, Users, Waves,
  type LucideIcon,
} from 'lucide-react';
import { Suspense, useRef, useState, type CSSProperties } from 'react';
import { IssueSummary, IssueTitle, LateBadge, StatusBadge, type Issue } from '@/components/features/report-bits';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/card';
import { CountUp } from '@/components/ui/count-up';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { FilterChips, FilterSegmented, FilterSummary, SearchField } from '@/components/ui/filter-bar';
import { Text } from '@/components/ui/localized-text';
import { Reveal } from '@/components/ui/reveal';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, timeAgo } from '@/lib/format';
import { useAction, usePaged } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { REPORT_CATEGORIES, REPORT_CATEGORY_LABELS, type ReportCategory } from '@/shared/domain';

/** A problem neighbours can see: enough residents have reported it or said "Me too". */
type AroundReport = Issue;
type View = 'open' | 'closed';
type Category = ReportCategory | 'ALL';
interface Extra {
  counts: Record<View | 'following', number>;
  categories: Record<ReportCategory, number>;
  /** How many residents make a problem public. */
  threshold: number;
  kpis: { open: number; fixed30: number; affected: number; medianDays: number | null };
}

/** How many of each type's latest reports show under "All types" before "See all". */
const PREVIEW = 3;

/** Each type of report keeps one icon and one short line wherever it appears on this page. */
const TYPE: Record<ReportCategory, { icon: LucideIcon; hint: string }> = {
  POTHOLE: { icon: Construction, hint: 'Potholes, cracked roads and damaged pavements.' },
  LIGHTING: { icon: Lightbulb, hint: 'Street lights and other lights that are out or flickering.' },
  DRAINAGE: { icon: Waves, hint: 'Blocked or overflowing drains.' },
  WASTE: { icon: Trash2, hint: 'Uncollected rubbish and illegal dumping.' },
  ACCESS_BARRIER: { icon: Accessibility, hint: 'Blocked ramps, broken lifts and other barriers.' },
  SAFETY: { icon: TriangleAlert, hint: 'Fallen trees, exposed wires, broken railings and other hazards.' },
  OTHER: { icon: CircleHelp, hint: 'Anything else neighbours reported.' },
};

/**
 * Lapor → Around the township: what other residents have reported, with the township's figures on top, a
 * "browse by type" rail and the reports as aligned rows grouped by type. A resident checks whether a problem is
 * already known and taps "Me too" to follow it, instead of reporting it again. Never shows who reported, their
 * words or photos.
 */
export function AroundScreen() {
  return <Suspense fallback={<AroundSkeleton />}><Around /></Suspense>;
}

function Around() {
  const t = useT();
  const [view, setView] = useState<View>('open');
  const [category, setCategory] = useState<Category>('ALL');
  const [onlyMine, setOnlyMine] = useState(false);
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 300);
  const list = usePaged<AroundReport, Extra>(
    `/report-issues?view=${view}&limit=24${category !== 'ALL' ? `&category=${category}` : ''}${onlyMine ? '&following=true' : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
    { keepPrevious: true },
  );
  // The groups animate in when their results change, not while the previous ones are still showing.
  const filterKey = `${view}:${category}:${onlyMine}:${q}`;
  const [shownKey, setShownKey] = useState(filterKey);
  if (!list.stale && list.first && shownKey !== filterKey) setShownKey(filterKey);
  // The figures and counts arrive with the first page of every request.
  const data: Extra | undefined = list.first?.counts && list.first.categories && list.first.kpis && list.first.threshold !== undefined
    ? { counts: list.first.counts, categories: list.first.categories, kpis: list.first.kpis, threshold: list.first.threshold }
    : undefined;
  const filtered = Boolean(q) || category !== 'ALL' || onlyMine;
  const clearFilters = () => {
    setSearch('');
    setCategory('ALL');
    setOnlyMine(false);
  };
  // All types: every type with reports gets a panel (from the server's counts, not just the loaded page) showing
  // its latest few and "See all". One type: its full list, paged with Show more.
  const preview = category === 'ALL';
  const groups = REPORT_CATEGORIES
    .filter((c) => (preview ? (data?.categories[c] ?? 0) > 0 : c === category))
    .map((c) => {
      const items = list.items.filter((r) => r.category === c);
      return { category: c, items: preview ? items.slice(0, PREVIEW) : items };
    })
    .filter((g) => preview || g.items.length > 0);
  const listTop = useRef<HTMLDivElement>(null);
  const seeAll = (c: ReportCategory) => {
    setCategory(c);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    listTop.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  };
  const typeOptions: { key: Category; label: string; count?: number }[] = [{ key: 'ALL', label: 'All types' }, ...REPORT_CATEGORIES.map((c) => ({ key: c, label: REPORT_CATEGORY_LABELS[c], count: data?.categories[c] ?? 0 }))];

  return (
    <>
      <BackLink href="/app/lapor" className="mb-3"><Text>Back to my reports</Text></BackLink>
      <PageHeader title="Around the township" description="Problems neighbours have reported, by type. If one affects you too, tap Me too: you hear every update, and the township office sees how many people it affects." />
      {data && (
        <p className="-mt-2 mb-5 flex items-start gap-2 text-sm text-ink-500">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <Text>{`A problem appears here once ${data.threshold} residents have reported it or said Me too. Titles are written for the township, never copied from anyone's report.`}</Text>
        </p>
      )}

      <div className="space-y-6">
        {data ? <AroundHero kpis={data.kpis} /> : !list.error && <Skeleton className="h-40 rounded-2xl" />}

        <div className="grid gap-6 lg:grid-cols-[232px_minmax(0,1fr)] lg:items-start">
          {/* Browse by type: a steady rail on wide screens, so the list never jumps when a type is picked. */}
          <nav aria-label={t('Browse by type')} className="hidden lg:sticky lg:top-24 lg:block">
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-500"><Text>Browse by type</Text></p>
            <ul className="space-y-0.5">
              {typeOptions.map((option) => {
                const Icon = option.key === 'ALL' ? LayoutGrid : TYPE[option.key].icon;
                const active = category === option.key;
                const count = option.key === 'ALL' ? data?.counts[view] : option.count;
                return (
                  <li key={option.key}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => setCategory(option.key)}
                      className={cn(
                        'around-rail flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm',
                        active ? 'bg-white font-semibold text-brand-800 shadow-xs ring-1 ring-brand-200' : 'text-ink-700',
                        !active && count === 0 && 'text-ink-400',
                      )}
                    >
                      <Icon className={cn('size-4 shrink-0', active ? 'text-brand-600' : 'text-ink-400')} aria-hidden />
                      <span className="min-w-0 flex-1 truncate"><Text>{option.label}</Text></span>
                      <span className="text-xs tabular-nums text-ink-500">{count ?? '–'}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="min-w-0 space-y-5">
            <div className="glass-surface space-y-3 rounded-2xl border p-3 shadow-sm sm:p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <SearchField value={search} onChange={setSearch} label="Search reports around the township" placeholder="A street, a place or an area" className="min-w-0 flex-1" />
                <FilterSegmented<View>
                  label="Report status"
                  value={view}
                  onChange={setView}
                  options={[{ key: 'open', label: 'Being handled', count: data?.counts.open ?? 0 }, { key: 'closed', label: 'Fixed or closed', count: data?.counts.closed ?? 0 }]}
                />
              </div>
              {/* On narrower screens the type rail becomes chips here. */}
              <div className="lg:hidden">
                <FilterChips<Category> label="Type of report" size="sm" value={category} onChange={setCategory} options={typeOptions} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-3">
                <FilterSegmented<'ALL' | 'MINE'>
                  label="Which reports"
                  value={onlyMine ? 'MINE' : 'ALL'}
                  onChange={(next) => setOnlyMine(next === 'MINE')}
                  options={[{ key: 'ALL', label: 'All reports' }, { key: 'MINE', label: 'Following', count: data?.counts.following ?? 0 }]}
                />
                {data && <FilterSummary shown={list.items.length} total={data.counts[view]} noun={list.items.length === 1 ? 'problem' : 'problems'} onClear={filtered ? clearFilters : undefined} live />}
              </div>
            </div>

            {/* Only the list changes when a filter is picked; it dims while the new results load. */}
            <div ref={listTop} aria-busy={list.stale || undefined} className={cn('scroll-mt-24 transition-opacity duration-200', list.stale && 'pointer-events-none opacity-50')}>
              {list.error ? (
                <ErrorState error={list.error} onRetry={() => void list.reload()} />
              ) : !data ? (
                <ListSkeleton />
              ) : groups.length === 0 ? (
                filtered ? (
                  <EmptyState icon={SearchX} title="No reports match your filters" action={<Button variant="secondary" onClick={clearFilters}><Text>Clear filters</Text></Button>}>
                    <Text>Try another type or area, or show all reports.</Text>
                  </EmptyState>
                ) : (
                  <EmptyState icon={MapPinned} title={view === 'open' ? 'Nothing being handled right now' : 'Nothing fixed or closed yet'}>
                    <Text>{view === 'open' ? 'When neighbours report a problem, it appears here until it is fixed.' : 'Reports appear here once the township office has fixed or closed them.'}</Text>
                  </EmptyState>
                )
              ) : (
                <div key={shownKey} className="space-y-6">
                  {groups.map((group, i) => {
                    const Icon = TYPE[group.category].icon;
                    return (
                      <Reveal key={group.category} index={i}>
                        <section aria-labelledby={`around-${group.category}`} className="glass-surface overflow-hidden rounded-2xl border shadow-sm">
                          <header className="flex items-center gap-3 border-b border-ink-100 bg-ink-50/60 px-4 py-3 sm:px-5">
                            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-brand-100"><Icon className="size-4" aria-hidden /></span>
                            <div className="min-w-0 flex-1">
                              <h2 id={`around-${group.category}`} className="text-[15px] font-semibold text-ink-900"><Text>{REPORT_CATEGORY_LABELS[group.category]}</Text></h2>
                              <p className="truncate text-xs text-ink-500"><Text>{TYPE[group.category].hint}</Text></p>
                            </div>
                            <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold tabular-nums text-ink-600 ring-1 ring-ink-200">{data.categories[group.category]}</span>
                          </header>
                          {group.items.length > 0 && (
                            <ul className="stagger-in divide-y divide-ink-100">
                              {group.items.map((report, n) => <AroundRow key={report.id} report={report} index={n} onChange={() => void list.reload()} />)}
                            </ul>
                          )}
                          {preview && data.categories[group.category] > group.items.length && (
                            <button
                              type="button"
                              onClick={() => seeAll(group.category)}
                              className="see-all group flex w-full items-center justify-between gap-3 border-t border-ink-100 px-4 py-3 text-left text-sm font-semibold text-brand-700 sm:px-5"
                            >
                              <span>
                                <Text>{data.categories[group.category] === 1 ? 'See the report' : `See all ${data.categories[group.category]} reports`}</Text>
                                {group.items.length > 0 && <span className="ml-2 font-normal text-ink-500"><Text>{`${group.items.length} of ${data.categories[group.category]} shown`}</Text></span>}
                              </span>
                              <ArrowRight className="see-all-arrow size-4 shrink-0" aria-hidden />
                            </button>
                          )}
                        </section>
                      </Reveal>
                    );
                  })}
                </div>
              )}
              {!preview && list.hasMore && (
                <div className="mt-6 text-center">
                  <Button variant="secondary" onClick={() => void list.loadMore()} pending={list.loadingMore}><Text>Show more</Text></Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <span className="sr-only" aria-live="polite">{list.stale ? t('Loading') : ''}</span>
    </>
  );
}

/**
 * The township's figures in one compact band: reports being handled (with the share fixed this month), then what
 * was fixed, how many neighbours joined in, and how long a fix usually takes. All live; nothing estimated.
 */
function AroundHero({ kpis }: { kpis: Extra['kpis'] }) {
  const t = useT();
  const share = kpis.open + kpis.fixed30 > 0 ? Math.round((kpis.fixed30 / (kpis.open + kpis.fixed30)) * 100) : 0;
  return (
    <section aria-label={t('The township at a glance')} className="insights-hero relative overflow-hidden rounded-2xl p-5 text-white shadow-lg sm:p-6">
      <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:items-center lg:gap-8">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-200"><MapPinned className="size-3.5" aria-hidden /><Text>Being handled now</Text></p>
          <div className="mt-2 flex items-end gap-3">
            <p className="font-display text-[44px] font-bold leading-none tracking-tight tabular-nums"><CountUp value={kpis.open} duration={1400} /></p>
            <p className="pb-1 text-sm leading-snug text-brand-100/85"><Text>problems the township office is working on</Text></p>
          </div>
          <div className="mt-4 max-w-sm">
            <div className="flex items-baseline justify-between text-xs text-brand-100/80"><Text>Fixed in the last 30 days</Text><span className="font-semibold tabular-nums text-white">{share}%</span></div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/15" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={share} aria-label={t('Fixed in the last 30 days')}>
              <div className="hero-meter h-full rounded-full bg-brand-300" style={{ width: `${share}%` }} />
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xl bg-white/10 sm:grid-cols-3">
          <HeroFigure icon={CheckCheck} label="Fixed in 30 days" value={kpis.fixed30} hint="Problems the township office fixed" />
          <HeroFigure icon={Users} label="Residents affected" value={kpis.affected} hint="By problems still being handled" />
          <HeroFigure icon={Timer} label="Typical days to fix" value={kpis.medianDays} hint="Middle of the last 90 days" />
        </dl>
      </div>
    </section>
  );
}

function HeroFigure({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: number | null; hint: string }) {
  return (
    <div className="hero-figure bg-brand-950/35 px-4 py-3.5">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-brand-100/80"><Icon className="size-3.5 shrink-0" aria-hidden /><Text>{label}</Text></dt>
      <dd className="mt-1 font-display text-2xl font-bold leading-none tracking-tight tabular-nums text-white">{value === null ? '–' : <CountUp value={value} />}</dd>
      <dd className="mt-1 truncate text-[11px] text-brand-100/70"><Text>{hint}</Text></dd>
    </div>
  );
}

/**
 * One problem as an aligned row: its written title, summary, area and dates, then status, how many residents it
 * affects and Me too in fixed columns, so a list reads down like a table. On phones the columns stack under it.
 */
function AroundRow({ report: r, index, onChange }: { report: AroundReport; index: number; onChange: () => void }) {
  const t = useT();
  const open = r.status === 'NEW' || r.status === 'IN_PROGRESS';
  const meToo = useAction((on: boolean) => api.post<{ affected: number; following: boolean }>(`/report-issues/${r.id}/me-too`, { on }), {
    success: (result) => (result.following ? 'Thanks. You will hear every update on this problem.' : 'You no longer follow this problem.'),
    onSuccess: onChange,
  });
  return (
    <li style={{ '--i': Math.min(index, 8) } as CSSProperties} className="around-row grid gap-3 px-4 py-4 sm:px-5 md:grid-cols-[minmax(0,1fr)_auto_7rem_8rem] md:items-center md:gap-5">
      <div className="min-w-0">
        <p className="font-semibold text-ink-900"><IssueTitle issue={r} /></p>
        <IssueSummary issue={r} className="mt-0.5 line-clamp-2 text-sm text-ink-600" />
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
          <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{r.zone_name ? <Text>{r.zone_name}</Text> : <Text>Township</Text>}</span>
          <span aria-hidden className="size-1 rounded-full bg-ink-300" />
          <span><Text>First reported</Text> <Text>{timeAgo(r.created_at)}</Text></span>
        </p>
        {/* The fix date has its own line, so no separator dot is left hanging when the line wraps. */}
        <p className="mt-1 flex items-center text-xs text-ink-500">
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="size-3.5" aria-hidden />
            {r.status === 'RESOLVED' && r.resolved_at ? <Text>{`Fixed ${formatDate(r.resolved_at)}`}</Text>
              : r.status === 'REJECTED' ? <Text>Closed with no action</Text>
                : r.target_date ? <Text>{`To be fixed by ${formatDate(r.target_date)}`}</Text>
                  : <Text>Waiting for a fix date</Text>}
          </span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 md:justify-end"><LateBadge late={r.late} /><StatusBadge status={r.status} /></div>
      <div className="flex items-center justify-between gap-3 md:contents">
        <span className="inline-flex items-center gap-1.5 text-sm text-ink-600 md:justify-end" title={t(r.people === 1 ? 'person affected' : 'people affected')}>
          <Users className="size-4 text-ink-400" aria-hidden />
          <span className="font-semibold tabular-nums text-ink-900"><CountUp value={r.people} /></span>
          <span className="md:sr-only"><Text>{r.people === 1 ? 'person affected' : 'people affected'}</Text></span>
        </span>
        <div className="flex md:justify-end">
          {open && r.mine ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-600"><CheckCheck className="size-4 text-success-600" aria-hidden /><Text>You reported this</Text></span>
          ) : open ? (r.following ? (
            <Button size="sm" variant="ghost" onClick={() => void meToo.run(false)} pending={meToo.pending} aria-pressed className="text-success-700">
              <CheckCheck className="size-4" aria-hidden /><Text>Following</Text>
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => void meToo.run(true)} pending={meToo.pending} aria-pressed={false}>
              <HandHeart className="size-4" aria-hidden /><Text>Me too</Text>
            </Button>
          )) : <span className="hidden text-xs text-ink-400 md:inline">—</span>}
        </div>
      </div>
    </li>
  );
}

/** The list in the shape it loads into: one group with four rows. */
function ListSkeleton() {
  return (
    <div role="status" aria-busy="true" className="glass-surface overflow-hidden rounded-2xl border shadow-sm">
      <div className="flex items-center gap-3 border-b border-ink-100 px-5 py-3"><Skeleton className="size-8 rounded-lg" /><div className="flex-1"><Skeleton className="h-4 w-36" /><Skeleton className="mt-1.5 h-3 w-56" /></div></div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-5 border-b border-ink-100 px-5 py-4 last:border-0">
          <div className="flex-1"><Skeleton className="h-4 w-3/5" /><Skeleton className="mt-2 h-3 w-4/5" /></div>
          <Skeleton className="hidden h-5 w-24 rounded-full md:block" />
          <Skeleton className="hidden h-4 w-10 md:block" />
          <Skeleton className="h-8 w-24" />
        </div>
      ))}
    </div>
  );
}

/** The whole page while it first loads: the figures band, the type rail and the list. */
function AroundSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-6">
      <Skeleton className="h-40 rounded-2xl" />
      <div className="grid gap-6 lg:grid-cols-[232px_minmax(0,1fr)]">
        <div className="hidden space-y-2 lg:block">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8 rounded-lg" />)}</div>
        <div className="space-y-5"><Skeleton className="h-32 rounded-2xl" /><ListSkeleton /></div>
      </div>
    </div>
  );
}
