'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedInput } from '@/components/ui/localized-elements';

import { CalendarClock, Camera, ClipboardList, MapPin, Sparkles, ThumbsUp, Timer, TriangleAlert } from 'lucide-react';
import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { IncidentBoard, COMMUNITY_MODULES } from '@/components/features/incident-board';
import { AffectedBadge, FixedPhoto, LateBadge, ReportPhoto, ReportProgress, STATUS_LABELS, StatusBadge, URGENCY_LABELS, UrgencyBadge, categoryLabel, type Report } from '@/components/features/report-bits';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader, Stat } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { Input, Select, Textarea } from '@/components/ui/field';
import { SubNav } from '@/components/ui/sub-nav';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useAction, useApi, usePaged } from '@/lib/hooks';
import { PHOTO_ACCEPT, PHOTO_HINT, shrinkPhoto, usePhotoPick } from '@/lib/image';
import { REPORT_CATEGORIES, REPORT_CATEGORY_LABELS, REPORT_STATUSES, URGENCIES, type ReportCategory, type ReportStatus } from '@/shared/domain';
import { NeedsAttention, type Attention } from './attention';

interface ReportStats {
  open: number;
  late: number;
  withTargetPct: number | null;
  duplicatesAvoided: number;
  medianHoursToCheck: number | null;
  medianDaysToFix: number | null;
  resolved90d: number;
  byCategory: { category: ReportCategory; resolved: number; median_days: number | null; open: number }[];
}

export default function ReportQueuePage() {
  return <Suspense fallback={<SkeletonList rows={3} />}><LaporWorkspace /></Suspense>;
}

function LaporWorkspace() {
  const search = useSearchParams();
  const router = useRouter();
  const asked = search.get('tab');
  // Parcel, locker and courier cases moved here from the Parcels page, so every report is tracked in one place.
  const tab = asked === 'parcels' ? 'parcels' : asked === 'cases' || search.has('ref') ? 'cases' : asked === 'attention' ? 'attention' : 'reports';
  const reference = search.get('ref');
  // Loaded here so the tab shows how many problems need attention from any tab.
  const attention = useApi<Attention>('/report-issues/attention');
  return <>
    <PageHeader title="Lapor" description="Community reports, gate and community cases, and parcel, locker and courier cases, in one place." />
    <Tabs label="Lapor" value={tab} onChange={(value) => router.push(`/console/reports?tab=${value}`, { scroll: false })} items={[
      { key: 'attention', label: 'Needs attention', count: attention.data?.items.length },
      { key: 'reports', label: 'Community reports' }, { key: 'cases', label: 'Gate & community cases' }, { key: 'parcels', label: 'Parcel & locker cases' },
    ]} />
    <TabPanel>
      {tab === 'attention' ? <NeedsAttention data={attention.data} error={attention.error} isLoading={attention.isLoading} reload={() => void attention.mutate()} />
        : tab === 'reports' ? <CommunityReports onChanged={() => void attention.mutate()} />
        : tab === 'parcels' ? <ParcelCases />
        : <IncidentBoard key={search.toString()} modules={COMMUNITY_MODULES} openRef={reference && /^INC-\d+$/.test(reference) ? reference : null} />}
    </TabPanel>
  </>;
}

/** Cases about guardhouse parcels, smart lockers and the courier platform. */
function ParcelCases() {
  const search = useSearchParams();
  const reference = search.get('ref');
  return <section className="space-y-5">
    <div><h2 className="font-display text-xl font-bold text-ink-900"><Text>Parcel & locker cases</Text></h2>
      <p className="mt-1 text-sm text-ink-500"><Text>Reports about guardhouse parcels, smart lockers and couriers: disputed handovers, doors that would not open, doors opened without a code, and courier problems.</Text></p></div>
    <IncidentBoard key={search.toString()} modules={['PARCELS', 'LOCKERS', 'COURIERS']}
      openRef={reference && /^INC-\d+$/.test(reference) ? reference : null}
      initialDisputed={search.get('disputed') === '1'} initialOverdue={search.get('overdue') === '1'} />
  </section>;
}

const isStatus = (value: string | null): value is ReportStatus => (REPORT_STATUSES as readonly string[]).includes(value ?? '');

function CommunityReports({ onChanged }: { onChanged: () => void }) {
  const pickPhoto = usePhotoPick();
  // The status pill is part of the address, so a refresh or Back keeps the list you were on.
  const params = useSearchParams();
  const asked = params.get('status');
  const status: ReportStatus = isStatus(asked) ? asked : 'NEW';
  const reports = usePaged<Report>(`/reports?status=${status}&limit=15`);
  const stats = useApi<ReportStats>('/reports/stats');
  const [open, setOpen] = useState<Report | null>(null);

  const done = () => {
    setOpen(null);
    void reports.reload();
    void stats.mutate();
    onChanged();
  };
  const update = useAction((id: string, body: Record<string, unknown>) => api.patch(`/reports/${id}`, body), {
    success: 'Report updated. Everyone following it has been told.',
    onSuccess: done,
  });
  const fixedPhoto = useAction(
    async (id: string, file: File) => {
      const data = new FormData();
      data.set('photo', await shrinkPhoto(file), 'photo.jpg');
      return api.post(`/reports/${id}/fixed-photo`, data);
    },
    { success: 'Photo of the fix added.', onSuccess: done },
  );
  const closed = open?.status === 'RESOLVED' || open?.status === 'REJECTED';
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    void update.run(open!.id, {
      status: form.status,
      category: form.category,
      urgency: form.urgency,
      staffNote: form.staffNote || undefined,
      // A closed report keeps who fixed it and when it was due.
      ...(closed ? {} : { assignedTo: form.assignedTo ?? '', targetDate: form.targetDate || null }),
    });
  };
  const s = stats.data;

  return (
    <>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Open reports" value={s?.open ?? 0} icon={ClipboardList} hint={s?.withTargetPct != null ? `${s.withTargetPct}% have a target date` : 'None open'} />
        <Stat label="Past their target date" value={s?.late ?? 0} icon={TriangleAlert} tone={s?.late ? 'danger' : 'brand'} hint="Residents see these as late." />
        <Stat label="Duplicate reports avoided" value={s?.duplicatesAvoided ?? 0} icon={ThumbsUp} tone="gold" hint="“Me too” taps, last 90 days" />
        <Stat
          label="Median time to fix"
          value={s?.medianDaysToFix != null ? `${s.medianDaysToFix} d` : '–'}
          icon={Timer}
          hint={s?.medianHoursToCheck != null ? `Checked within ${s.medianHoursToCheck} h · ${s.resolved90d} fixed in 90 days` : 'No fixes in the last 90 days'}
        />
      </div>

      <SubNav label="Report status" value={status} items={REPORT_STATUSES.map((st) => ({ key: st, label: STATUS_LABELS[st] }))} hrefOf={(st) => (st === 'NEW' ? '/console/reports' : `/console/reports?status=${st}`)} className="mb-5" />
      <div key={status} className="content-in">
        {reports.error ? (
          <ErrorState error={reports.error} onRetry={() => void reports.reload()} />
        ) : reports.isLoading ? (
          <SkeletonList rows={4} />
        ) : reports.items.length === 0 ? (
          <EmptyState title="Nothing here"><Text>No reports with this status.</Text></EmptyState>
        ) : (
          <ul className="stagger-in space-y-3">
            {[...reports.items]
              // Late first, then the ones that affect most people, then the most urgent.
              .sort((a, b) => Number(b.late) - Number(a.late) || b.affected - a.affected || URGENCIES.indexOf(b.urgency) - URGENCIES.indexOf(a.urgency))
              .map((report) => (
                <li key={report.id}>
                  <button type="button" onClick={() => setOpen(report)} className="lift glass-surface block w-full rounded-xl border p-5 text-left shadow-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <UrgencyBadge urgency={report.urgency} />
                      <LateBadge late={report.late} />
                      <AffectedBadge affected={report.affected} />
                      {(report.issue_reports ?? 1) > 1 && <Badge tone="brand"><Text>{`Shared problem · ${report.issue_people} residents`}</Text></Badge>}
                      <span className="text-sm font-semibold text-ink-900"><Text>{categoryLabel(report.category)}</Text></span>
                      {report.zone_name && <span className="text-sm text-ink-500">· <Text>{report.zone_name}</Text></span>}
                      <span className="ml-auto text-xs text-ink-500"><Text>{timeAgo(report.created_at)}</Text></span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-[15px] text-ink-700">{report.description}</p>
                    <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-500">
                      <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" aria-hidden />{report.location_text}</span>
                      {(report.assigned_to || report.target_date) && (
                        <span className="inline-flex items-center gap-1.5">
                          <CalendarClock className="size-4" aria-hidden />
                          {report.assigned_to}
                          {report.assigned_to && report.target_date && ' · '}
                          {report.target_date}
                        </span>
                      )}
                    </p>
                  </button>
                </li>
              ))}
          </ul>
        )}
        {reports.hasMore && (
          <div className="mt-5 text-center">
            <Button variant="secondary" onClick={() => void reports.loadMore()} pending={reports.loadingMore}><Text>Show more</Text></Button>
          </div>
        )}
      </div>

      {s && s.byCategory.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Time to fix by type" description="Median days from report to fixed, last 90 days." />
          <ul className="divide-y divide-ink-100">
            {s.byCategory.map((c) => (
              <li key={c.category} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-[15px]">
                <span className="font-semibold text-ink-900"><Text>{REPORT_CATEGORY_LABELS[c.category]}</Text></span>
                <span className="text-ink-600">
                  <Text>{`${c.open} open`}</Text> · <Text>{`${c.resolved} fixed`}</Text>
                  {c.median_days != null && <> · <Text>{`median ${c.median_days} days`}</Text></>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open ? categoryLabel(open.category) : ''}
        description={open?.location_text}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(null)}><Text>Close</Text></Button>
            <Button type="submit" form="report-update" pending={update.pending}><Text>Save</Text></Button>
          </>
        }
      >
        {open && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={open.status} />
              <UrgencyBadge urgency={open.urgency} />
              <LateBadge late={open.late} />
              <AffectedBadge affected={open.affected} />
            </div>
            <p className="whitespace-pre-line text-[15px] text-ink-700">{open.description}</p>
            <ReportPhoto report={open} />
            {open.ai_category && (
              <p className="flex gap-2 rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-800">
                <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span><Text>Suggested by </Text><Text>{open.ai_source === 'MODEL' ? 'the AI photo and text check' : 'keyword rules'}</Text>: <strong><Text>{REPORT_CATEGORY_LABELS[open.ai_category]}</Text></strong>, <strong><Text>{URGENCY_LABELS[open.ai_urgency!].toLowerCase()}</Text></strong><Text> urgency. You can change either below.</Text></span>
              </p>
            )}
            <ReportProgress report={open} />
            <form method="post" id="report-update" key={open.id} onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
              <Select label="Type" name="category" defaultValue={open.category}>
                {REPORT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    <Text>{REPORT_CATEGORY_LABELS[c]}</Text>
                  </option>
                ))}
              </Select>
              <Select label="Urgency" name="urgency" defaultValue={open.urgency}>
                {URGENCIES.map((u) => (
                  <option key={u} value={u}>
                    <Text>{URGENCY_LABELS[u]}</Text>
                  </option>
                ))}
              </Select>
              <Select label="Status" name="status" defaultValue={open.status} disabled={closed} hint={closed ? 'This report is closed.' : 'The resident earns XP once it is in progress or resolved.'}>
                {REPORT_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    <Text>{STATUS_LABELS[st]}</Text>
                  </option>
                ))}
              </Select>
              {closed && <LocalizedInput type="hidden" name="status" value={open.status} />}
              <Input label="Who is fixing it" name="assignedTo" defaultValue={open.assigned_to ?? ''} maxLength={80} placeholder="e.g. Landscape contractor" className="sm:col-span-2" disabled={closed} />
              <Input label="Target date" name="targetDate" type="date" defaultValue={open.target_date ?? ''} disabled={closed} hint="Residents see this date." />
              <Textarea label="Note to residents (optional)" name="staffNote" defaultValue={open.staff_note ?? ''} maxLength={500} className="sm:col-span-3" hint="Everyone following the report sees it." />
            </form>
            <FixedPhoto report={open} />
            <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-dashed border-ink-300 px-4 py-3 text-[15px] text-ink-700 transition-colors duration-200 hover:border-brand-500 hover:bg-brand-50/40 focus-within:border-brand-500">
              <Camera className="size-5 shrink-0 text-ink-500" aria-hidden />
              <span className="min-w-0 flex-1"><Text>{fixedPhoto.pending ? 'Uploading…' : open.fixed_photo_id ? 'Replace the photo of the fix' : 'Add a photo of the fix'}</Text><span className="block text-xs text-ink-500"><Text>{PHOTO_HINT}</Text></span></span>
              <LocalizedInput
                type="file"
                accept={PHOTO_ACCEPT}
                capture="environment"
                className="sr-only"
                onChange={(event) => {
                  const file = pickPhoto(event.target);
                  if (file) void fixedPhoto.run(open.id, file);
                }}
              />
            </label>
          </div>
        )}
      </Modal>
    </>
  );
}
