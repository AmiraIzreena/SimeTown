'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedInput } from '@/components/ui/localized-elements';

import { Camera, CheckCircle2, MapPin, Plus, SearchX, ThumbsUp } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { AksesPage, AksesWizard, useAksesMode } from '@/components/features/akses-mode';
import { FixedPhoto, IssueReach, IssueSummary, IssueTitle, LateBadge, ReportPhoto, ReportProgress, StatusBadge, UrgencyBadge, categoryLabel, URGENCY_LABELS, type Issue, type Report } from '@/components/features/report-bits';
import { Button } from '@/components/ui/button';
import { Badge, PageHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { EmptyState, ErrorState, SkeletonTimeline } from '@/components/ui/feedback';
import { Input, Select, Textarea } from '@/components/ui/field';
import { FilterBar, FilterChips, FilterRow, FilterSummary, SearchField } from '@/components/ui/filter-bar';
import { SubNav } from '@/components/ui/sub-nav';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { ParcelGateReports } from './cases';
import { HomeServiceReports } from './home-reports';
import { AroundLink } from './around-link';
import type { ReportSection } from '@/shared/incidents';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { useAction, useApi, usePaged } from '@/lib/hooks';
import { PHOTO_ACCEPT, PHOTO_HINT, shrinkPhoto, usePhotoPick } from '@/lib/image';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import type { BanjirOverview } from '@/lib/types';
import { REPORT_CATEGORIES, REPORT_CATEGORY_LABELS, type ReportCategory, type Urgency } from '@/shared/domain';

interface Created {
  category: ReportCategory;
  urgency: Urgency;
  issueId: string;
  /** True when it was added to a problem other residents had already reported. */
  joined: boolean;
}

/** Nothing was saved yet: the report looks like this open problem, and the resident chooses. */
interface NeedsChoice {
  needsChoice: true;
  issue: Issue;
  /** The resident has already reported this problem themselves. */
  alreadyYours: boolean;
}

type View = 'ongoing' | 'finished';
/** community: from New report. cases: parcel problems (from Parcels). gate: the main gate (from Tamu). kitar, gerak: from those pages. */
type LaporTab = 'community' | 'cases' | 'gate' | 'kitar' | 'gerak' | 'home';
const TAB_SECTION: Record<Exclude<LaporTab, 'community' | 'home'>, ReportSection> = { cases: 'parcels', gate: 'gate', kitar: 'kitar', gerak: 'gerak' };
interface LaporExtra {
  counts: Record<View | 'mine' | 'following', number>;
  categories: Record<ReportCategory, number>;
}

/** The type as it appears in the address (/app/lapor?type=lighting), so a filtered view survives refresh and Back. */
const TYPE_PARAM: Record<ReportCategory, string> = { POTHOLE: 'pothole', LIGHTING: 'lighting', DRAINAGE: 'drain', WASTE: 'rubbish', ACCESS_BARRIER: 'access', SAFETY: 'safety', OTHER: 'other' };

/** What a type with no reports says: which problems would appear under it. */
const TYPE_EMPTY: Record<ReportCategory, { title: string; text: string }> = {
  POTHOLE: { title: 'No pothole or road reports', text: 'Potholes, cracked roads and damaged pavements you report or follow appear here.' },
  LIGHTING: { title: 'No lighting reports', text: 'Street lights and other lights that are out or flickering appear here.' },
  DRAINAGE: { title: 'No drain reports', text: 'Blocked or overflowing drains appear here.' },
  WASTE: { title: 'No rubbish reports', text: 'Uncollected rubbish and illegal dumping appear here.' },
  ACCESS_BARRIER: { title: 'No access barrier reports', text: 'Blocked ramps, broken lifts and other barriers for wheelchairs and prams appear here.' },
  SAFETY: { title: 'No safety hazard reports', text: 'Hazards such as fallen trees, exposed wires or broken railings appear here.' },
  OTHER: { title: 'No other reports', text: 'Reports about anything else appear here.' },
};

export default function LaporPage() {
  return <Suspense fallback={<SkeletonTimeline rows={3} />}><LaporScreen /></Suspense>;
}

function LaporScreen() {
  const akses = useAksesMode();
  const params = useSearchParams();
  const router = useRouter();
  // Ongoing or Finished, and the type, are part of the address; search and "mine or followed" stay on the page.
  // Three sections: community reports from New report, parcel problems raised from Parcels, and gate problems from Tamu.
  const askedTab = params.get('tab');
  const tab: LaporTab = askedTab === 'cases' || askedTab === 'gate' || askedTab === 'kitar' || askedTab === 'gerak' || askedTab === 'home' ? askedTab : 'community';
  const view: View = params.get('view') === 'finished' ? 'finished' : 'ongoing';
  const category: ReportCategory | 'ALL' = REPORT_CATEGORIES.find((c) => TYPE_PARAM[c] === params.get('type')) ?? 'ALL';
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 300);
  const withParams = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const query = next.toString();
    return query ? `/app/lapor?${query}` : '/app/lapor';
  };
  const setCategory = (next: ReportCategory | 'ALL') => router.replace(withParams({ type: next === 'ALL' ? null : TYPE_PARAM[next] }), { scroll: false });

  const reports = usePaged<Report, LaporExtra>(
    tab !== 'community' ? null : `/reports?view=${view}&limit=10${category !== 'ALL' ? `&category=${category}` : ''}&who=mine${q ? `&q=${encodeURIComponent(q)}` : ''}`,
    { keepPrevious: true },
  );
  // The list animates in when its results change, not while the previous ones are still showing.
  const filterKey = `${view}:${category}:${q}`;
  const [shownKey, setShownKey] = useState(filterKey);
  if (!reports.stale && reports.first && shownKey !== filterKey) setShownKey(filterKey);
  const counts = reports.first?.counts;
  const categories = reports.first?.categories;
  const filtered = Boolean(q) || category !== 'ALL';
  const nothingAtAll = counts && counts.ongoing === 0 && counts.finished === 0 && !filtered;
  const clearFilters = () => {
    setSearch('');
    setCategory('ALL');
  };
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Report | null>(null);
  const newReport = <Button size={akses.guided ? 'lg' : 'md'} onClick={() => setOpen(true)}><Plus className="size-4" aria-hidden /><Text>New report</Text></Button>;

  return (
    <AksesPage>
      <PageHeader
        title="Lapor"
        description="Report a hazard or an access barrier in under a minute, then follow it until it is fixed. You earn Impact XP once township staff confirm it."
        action={newReport}
      />
      <Tabs<LaporTab>
        label="Lapor sections"
        value={tab}
        onChange={(next) => router.push(next === 'community' ? '/app/lapor' : `/app/lapor?tab=${next}`, { scroll: false })}
        items={[
          { key: 'community', label: 'Community reports' }, { key: 'cases', label: 'Parcel reports' }, { key: 'gate', label: 'Gate reports' },
          { key: 'kitar', label: 'Kitar reports' }, { key: 'gerak', label: 'Gerak reports' }, { key: 'home', label: 'Home service reports' },
        ]}
      />
      <TabPanel>
      {tab === 'home' ? (
        <HomeServiceReports />
      ) : tab !== 'community' ? (
        <ParcelGateReports key={tab} section={TAB_SECTION[tab]} />
      ) : (
      <div className="space-y-5">
        {/* My reports only; what neighbours reported lives on its own page. */}
        <AroundLink />
        {!nothingAtAll && (
          <>
            <FilterBar
              search={<SearchField value={search} onChange={setSearch} label="Search my Lapor reports" placeholder="What, where or the area" />}
              chips={
                // Every type shows, with its count, so a resident always sees where a report would be.
                <FilterRow label="Type">
                  <FilterChips<ReportCategory | 'ALL'>
                    label="Type of report"
                    size="sm"
                    value={category}
                    onChange={setCategory}
                    options={[{ key: 'ALL', label: 'All types' }, ...REPORT_CATEGORIES.map((c) => ({ key: c, label: REPORT_CATEGORY_LABELS[c], count: categories?.[c] ?? 0 }))]}
                  />
                </FilterRow>
              }
              summary={counts && <FilterSummary shown={reports.items.length} total={counts[view]} noun={reports.items.length === 1 ? 'report' : 'reports'} onClear={filtered ? clearFilters : undefined} live />}
            />
            {/* Ongoing / Finished sits right above the list it switches. */}
            <SubNav
              label="Report status"
              value={view}
              items={[{ key: 'ongoing', label: 'Ongoing', count: counts?.ongoing }, { key: 'finished', label: 'Finished', count: counts?.finished }]}
              hrefOf={(key) => withParams({ view: key === 'ongoing' ? null : 'finished' })}
            />
          </>
        )}

        {/* Only this part changes when a filter or the status is picked; it dims while the new results load. */}
        <div aria-busy={reports.stale || undefined} className={cn('space-y-5 transition-opacity duration-200', reports.stale && 'pointer-events-none opacity-50')}>
        {reports.error ? (
          <ErrorState error={reports.error} onRetry={() => void reports.reload()} />
        ) : reports.isLoading || !counts ? (
          <SkeletonTimeline rows={3} />
        ) : nothingAtAll ? (
          <EmptyState title="You have not reported anything" action={newReport}><Text>Seen a pothole, a broken light, a blocked drain or a blocked ramp? Tell the township team.</Text></EmptyState>
        ) : reports.items.length === 0 ? (
          category !== 'ALL' && !q ? (
            <EmptyState icon={MapPin} title={TYPE_EMPTY[category].title} action={<Button variant="secondary" onClick={() => setCategory('ALL')}><Text>Show all types</Text></Button>}>
              <Text>{TYPE_EMPTY[category].text}</Text>
            </EmptyState>
          ) : filtered ? (
            <EmptyState icon={SearchX} title="No reports match your filters" action={<Button variant="secondary" onClick={clearFilters}><Text>Clear filters</Text></Button>}>
              <Text>Try another type, or search for what or where it was.</Text>
            </EmptyState>
          ) : view === 'ongoing' ? (
            <EmptyState icon={CheckCircle2} title="Nothing ongoing" action={newReport}><Text>Reports you make appear here until they are fixed.</Text></EmptyState>
          ) : (
            <EmptyState title="Nothing finished yet"><Text>Reports that are fixed or closed appear here.</Text></EmptyState>
          )
        ) : (
          <ul key={shownKey} className="report-timeline space-y-3">
            {reports.items.map((report, index) => (
              <li key={report.id} className="report-timeline-item" style={{ animationDelay: `${Math.min(index, 8) * 55}ms` }}>
                <button type="button" onClick={() => setDetail(report)} className="lift glass-surface block w-full rounded-xl border p-5 text-left shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={report.status} />
                    <LateBadge late={report.late} />
                    {!report.mine && <Badge tone="neutral"><Text>Following</Text></Badge>}
                    <span className="text-sm font-semibold text-ink-900"><Text>{categoryLabel(report.category)}</Text></span>
                    <span className="ml-auto text-xs text-ink-500"><Text>{timeAgo(report.created_at)}</Text></span>
                  </div>
                  {report.description ? (
                    <p className="mt-2 line-clamp-2 text-[15px] text-ink-700">{report.description}</p>
                  ) : (
                    <p className="mt-2 text-[15px] text-ink-600"><Text>You said “Me too” to this report, so you hear every update.</Text></p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="inline-flex items-center gap-1.5 text-sm text-ink-500">
                      <MapPin className="size-4" aria-hidden />
                      {report.location_text}
                    </span>
                    {report.mine && <IssueReach report={report} />}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {reports.hasMore && (
          <div className="text-center">
            <Button variant="secondary" onClick={() => void reports.loadMore()} pending={reports.loadingMore}><Text>Show more</Text></Button>
          </div>
        )}
        </div>
      </div>
      )}
      </TabPanel>

      <NewReport open={open} guided={akses.guided} onClose={() => setOpen(false)} onCreated={() => void reports.reload()} />

      <Modal open={detail !== null} onClose={() => setDetail(null)} title={detail ? categoryLabel(detail.category) : ''} description={detail?.location_text}>
        {detail && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={detail.status} />
              <UrgencyBadge urgency={detail.urgency} />
              <LateBadge late={detail.late} />
              {detail.mine && <IssueReach report={detail} />}
            </div>
            {detail.mine && detail.issue_people !== undefined && detail.issue_threshold !== undefined && (
              <p className="rounded-lg bg-ink-50 px-4 py-3 text-sm text-ink-600">
                {detail.issue_people >= detail.issue_threshold
                  ? <Text>{`${detail.issue_people} residents have this problem, so neighbours can see it in Reports around the township, without your words or photo.`}</Text>
                  : <Text>{`Neighbours see a problem once ${detail.issue_threshold} residents have reported it or said Me too. So far: ${detail.issue_people}. Until then only you and the township office see your report.`}</Text>}
              </p>
            )}
            <ReportProgress report={detail} />
            {detail.description && <p className="whitespace-pre-line text-[15px] text-ink-700">{detail.description}</p>}
            <ReportPhoto report={detail} />
            {detail.staff_note && (
              <div className="rounded-lg bg-brand-50 p-4 text-[15px] text-brand-800">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-600"><Text>From the township team</Text></p>
                <p className="mt-1">{detail.staff_note}</p>
              </div>
            )}
            <FixedPhoto report={detail} />
            <p className="text-sm text-ink-500"><Text>Last updated </Text><Text>{timeAgo(detail.updated_at)}</Text>.</p>
          </div>
        )}
      </Modal>
    </AksesPage>
  );
}

/** Waits until typing pauses before the value is used, so the server is not asked on every key. */
function useSettled<T>(value: T, ms = 450): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * While a report is written: problems neighbours can already see that look like the same one. Tapping "Me too"
 * follows that problem instead of sending a new report, and counts the resident as affected.
 */
function AlreadyReported({ text, category, zoneId, onFollowed }: { text: string; category: string; zoneId: string; onFollowed: () => void }) {
  const query = useSettled(text.trim().length >= 8 ? `/report-issues/similar?${new URLSearchParams({ text: text.trim(), ...(category ? { category } : {}), ...(zoneId ? { zoneId } : {}) })}` : null);
  const similar = useApi<Issue[]>(query);
  const follow = useAction((id: string) => api.post<{ affected: number }>(`/report-issues/${id}/me-too`, { on: true }), {
    success: 'Added. You will hear every update on this problem.',
    onSuccess: onFollowed,
  });
  if (!similar.data || similar.data.length === 0) return null;
  return (
    <section aria-live="polite" className="rounded-lg border border-gold-300 bg-gold-50 p-4">
      <p className="text-[15px] font-semibold text-ink-900"><Text>Already reported?</Text></p>
      <p className="mt-0.5 text-sm text-ink-600"><Text>If one of these is the same problem, tap Me too instead of sending a new report. You will hear each update.</Text></p>
      <ul className="mt-3 space-y-2">
        {similar.data.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-white p-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink-900"><IssueTitle issue={s} /></p>
              <p className="text-xs text-ink-500">
                <Text>{categoryLabel(s.category)}</Text> · <Text>{`${s.people} residents affected`}</Text>
              </p>
            </div>
            {s.following ? (
              <Badge tone="success"><Text>Following</Text></Badge>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => void follow.run(s.id)} pending={follow.pending}>
                <ThumbsUp className="size-4" aria-hidden /><Text>Me too</Text></Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function NewReport({ open, guided, onClose, onCreated }: { open: boolean; guided: boolean; onClose: () => void; onCreated: () => void }) {
  const zones = useApi<BanjirOverview>(open ? '/banjir' : null);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const pickPhoto = usePhotoPick();
  const [step, setStep] = useState(0);
  const [description, setDescription] = useState('');
  const [locationText, setLocationText] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [category, setCategory] = useState('');
  const [guidedError, setGuidedError] = useState('');
  // Set when the report looks like a problem already reported: the resident adds theirs to it or sends it on its own.
  const [choice, setChoice] = useState<NeedsChoice | null>(null);
  const reset = () => {
    setPhotoName(null);
    setPhoto(null);
    setStep(0);
    setDescription('');
    setLocationText('');
    setZoneId('');
    setCategory('');
    setChoice(null);
    setMissing({});
    setEdited({});
  };
  const create = useAction(
    async (data: FormData) => {
      const file = data.get('photo');
      if (file instanceof File && file.size > 0) data.set('photo', await shrinkPhoto(file), 'photo.jpg');
      else data.delete('photo');
      return api.post<Created | NeedsChoice>('/reports', data);
    },
    {
      success: (r) => ('needsChoice' in r ? ''
        : r.joined ? 'Added to the problem other residents reported. You will hear every update.'
          : `Sent. Sorted as ${REPORT_CATEGORY_LABELS[r.category]}, ${URGENCY_LABELS[r.urgency].toLowerCase()} urgency. Staff can correct this.`),
      onSuccess: (r) => {
        if ('needsChoice' in r) {
          setChoice(r);
          return;
        }
        reset();
        onCreated();
        onClose();
      },
    },
  );
  const followed = () => {
    reset();
    onCreated();
    onClose();
  };
  /** The form as typed; `issue` is "new" or the problem to add it to, once the resident has chosen. */
  const toForm = (issue?: string) => {
    const data = new FormData();
    data.set('description', description.trim());
    data.set('locationText', locationText.trim());
    if (zoneId) data.set('zoneId', zoneId);
    if (category) data.set('category', category);
    if (photo) data.set('photo', photo);
    if (issue) data.set('issue', issue);
    return data;
  };
  // Empty fields are caught here, before anything is sent; a field's message goes as soon as it is edited.
  const [missing, setMissing] = useState<Record<string, string>>({});
  const [edited, setEdited] = useState<Record<string, boolean>>({});
  const errorOf = (field: 'description' | 'locationText') => (edited[field] ? undefined : missing[field] ?? create.fields[field]);
  const editing = (field: 'description' | 'locationText') => setEdited((current) => (current[field] ? current : { ...current, [field]: true }));
  const choose = (issue: string) => void create.run(toForm(issue));
  const close = () => {
    setChoice(null);
    onClose();
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const empty: Record<string, string> = {};
    if (!description.trim()) empty.description = 'Please describe the problem in a few words.';
    if (!locationText.trim()) empty.locationText = 'Please say where it is: a street, landmark or nearest house.';
    setMissing(empty);
    setEdited({});
    if (Object.keys(empty).length === 0) void create.run(toForm());
  };
  const next = () => {
    if (step === 0 && !description.trim()) {
      setGuidedError('Please describe the problem.');
      return;
    }
    if (step === 1 && !locationText.trim()) {
      setGuidedError('Please enter the location.');
      return;
    }
    setGuidedError('');
    setStep((current) => Math.min(current + 1, 4));
  };
  const f = create.fields;
  const similar = <AlreadyReported text={`${description} ${locationText}`} category={category} zoneId={zoneId} onFollowed={followed} />;
  const sameProblem = choice && <SameProblem choice={choice} large={guided} />;
  // On the last step of the guided form, a problem with what was typed earlier is shown here too.
  const typedError = f.description || f.locationText;
  return (
    guided ? (
      <AksesWizard open={open} title="New report" step={step} total={5} onClose={close} onBack={() => setStep((current) => current - 1)} onNext={next} onSubmit={() => void create.run(toForm())} pending={create.pending} submitLabel="Send report">
        {step === 0 && <Textarea label="What is the problem?" labelClassName="!text-3xl !font-semibold" value={description} onChange={(event) => { setDescription(event.target.value); setGuidedError(''); }} maxLength={1000} placeholder="e.g. Street light not working outside the playground" required error={guidedError || f.description} />}
        {step === 1 && <Input label="Where is it?" labelClassName="!text-3xl !font-semibold" value={locationText} onChange={(event) => { setLocationText(event.target.value); setGuidedError(''); }} maxLength={160} placeholder="Street, landmark or nearest house" required error={guidedError || f.locationText} />}
        {step === 2 && <Select label="Area (optional)" labelClassName="!text-3xl !font-semibold" value={zoneId} onChange={(event) => setZoneId(event.target.value)}>
          <option value=""><Text>Not sure</Text></option>
          {zones.data?.zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
        </Select>}
        {step === 3 && <Select label="Type" labelClassName="!text-3xl !font-semibold" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value=""><Text>Suggest for me</Text></option>
          {REPORT_CATEGORIES.map((item) => <option key={item} value={item}><Text>{REPORT_CATEGORY_LABELS[item]}</Text></option>)}
        </Select>}
        {step === 4 && choice && <>
          {sameProblem}
          <div className="flex flex-col gap-3 sm:flex-row">
            {choice.alreadyYours ? (
              <Button size="lg" onClick={followed}><Text>Close</Text></Button>
            ) : (
              <>
                <Button size="lg" onClick={() => choose(choice.issue.id)} pending={create.pending}><Text>Yes, add my report</Text></Button>
                <Button size="lg" variant="secondary" onClick={() => choose('new')} disabled={create.pending}><Text>No, it is a different problem</Text></Button>
              </>
            )}
          </div>
        </>}
        {step === 4 && !choice && <>
          {typedError && <p role="alert" className="text-lg font-semibold text-danger-700">{typedError}</p>}
          {similar}
          <label className="flex min-h-24 cursor-pointer items-center gap-4 rounded-xl border-2 border-dashed border-ink-300 px-6 py-5 text-2xl font-semibold text-ink-700 hover:border-brand-500 hover:bg-brand-50/40">
            <Camera className="size-8 shrink-0 text-ink-500" aria-hidden />
            <span className="min-w-0 flex-1"><Text>{photoName ?? 'Add a photo (optional)'}</Text><span className="mt-1 block text-lg font-normal text-ink-500"><Text>{PHOTO_HINT}</Text></span></span>
            <LocalizedInput type="file" accept={PHOTO_ACCEPT} capture="environment" className="sr-only" onChange={(event) => { const file = pickPhoto(event.target); setPhoto(file); setPhotoName(file?.name ?? null); }} />
          </label>
        </>}
        <p className="text-lg text-ink-600"><Text>If someone is in immediate danger, call 999 first.</Text></p>
      </AksesWizard>
    ) : (
      <Modal
        open={open}
        onClose={close}
        title="New report"
        description="If someone is in immediate danger, call 999 first."
        footer={choice ? (
          choice.alreadyYours ? (
            <Button onClick={followed}><Text>Close</Text></Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setChoice(null)} disabled={create.pending}><Text>Back to my report</Text></Button>
              <Button variant="secondary" onClick={() => choose('new')} disabled={create.pending}><Text>No, it is different</Text></Button>
              <Button onClick={() => choose(choice.issue.id)} pending={create.pending}><Text>Yes, add my report</Text></Button>
            </>
          )
        ) : (
          <><Button variant="secondary" onClick={close}><Text>Cancel</Text></Button><Button type="submit" form="new-report" pending={create.pending}><Text>Send report</Text></Button></>
        )}
      >
        {sameProblem}
        <form method="post" id="new-report" onSubmit={submit} className={cn('space-y-4', choice && 'hidden')} noValidate>
          <Textarea label="What is the problem?" name="description" value={description} onChange={(event) => { setDescription(event.target.value); editing('description'); }} maxLength={1000} placeholder="e.g. Street light not working outside the playground" required error={errorOf('description')} />
          <Input label="Where is it?" name="locationText" value={locationText} onChange={(event) => { setLocationText(event.target.value); editing('locationText'); }} maxLength={160} placeholder="Street, landmark or nearest house" required error={errorOf('locationText')} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Area (optional)" name="zoneId" value={zoneId} onChange={(event) => setZoneId(event.target.value)}><option value=""><Text>Not sure</Text></option>{zones.data?.zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</Select>
            <Select label="Type" name="category" value={category} onChange={(event) => setCategory(event.target.value)} hint="Leave it and SimeTown will suggest one."><option value=""><Text>Suggest for me</Text></option>{REPORT_CATEGORIES.map((item) => <option key={item} value={item}><Text>{REPORT_CATEGORY_LABELS[item]}</Text></option>)}</Select>
          </div>
          {similar}
          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-dashed border-ink-300 px-4 py-3 text-[15px] text-ink-700 transition-colors duration-200 hover:border-brand-500 hover:bg-brand-50/40 focus-within:border-brand-500">
            <Camera className="size-5 shrink-0 text-ink-500" aria-hidden /><span className="min-w-0 flex-1"><span className="block truncate"><Text>{photoName ?? 'Add a photo (optional)'}</Text></span><span className="block text-xs text-ink-500"><Text>{PHOTO_HINT}</Text></span></span>
            <LocalizedInput type="file" name="photo" accept={PHOTO_ACCEPT} capture="environment" className="sr-only" onChange={(event) => { const file = pickPhoto(event.target); setPhoto(file); setPhotoName(file?.name ?? null); }} />
          </label>
        </form>
      </Modal>
    )
  );
}

/**
 * After "Send report": the report looks like a problem other residents already reported. Adding it counts the
 * resident in and gives the township office their words and photo; a different problem is sent on its own.
 */
function SameProblem({ choice, large }: { choice: NeedsChoice; large: boolean }) {
  const { issue, alreadyYours } = choice;
  return (
    <section aria-live="polite" className="content-in space-y-4">
      <div>
        <p className={cn('font-semibold text-ink-900', large ? 'text-2xl' : 'text-[17px]')}>
          <Text>{alreadyYours ? 'You have already reported this problem' : 'This looks like a problem already reported'}</Text>
        </p>
        <p className={cn('mt-1 text-ink-600', large ? 'text-lg' : 'text-sm')}>
          <Text>{alreadyYours
            ? 'You will hear every update, so there is no need to send it again.'
            : 'If it is the same problem, add your report to it: you count as affected, and the township office gets your details and photo. If not, send it on its own.'}</Text>
        </p>
      </div>
      <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={issue.status} />
          <span className="text-sm font-semibold text-ink-700"><Text>{categoryLabel(issue.category)}</Text></span>
          {issue.zone_name && <span className="text-sm text-ink-500">· <Text>{issue.zone_name}</Text></span>}
        </div>
        <p className={cn('mt-2 font-semibold text-ink-900', large ? 'text-xl' : 'text-[15px]')}><IssueTitle issue={issue} /></p>
        <IssueSummary issue={issue} className="mt-1 text-sm text-ink-600" />
        <p className="mt-2 text-xs text-ink-500"><Text>{issue.people === 1 ? '1 resident affected so far' : `${issue.people} residents affected so far`}</Text></p>
      </div>
    </section>
  );
}
