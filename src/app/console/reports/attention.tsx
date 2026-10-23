'use client';

import { CalendarClock, ChevronRight, FileText, ImageOff, Info, MapPin, Siren, Sparkles, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { IssueSummary, IssueTitle, LateBadge, ReportPhoto, STATUS_LABELS, StatusBadge, UrgencyBadge, categoryLabel, type Issue } from '@/components/features/report-bits';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { Input, Select, Textarea } from '@/components/ui/field';
import { LocalizedImg } from '@/components/ui/localized-elements';
import { Text } from '@/components/ui/localized-text';
import { api } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useLang, useT } from '@/lib/i18n';
import { REPORT_STATUSES, type ReportStatus, type Urgency } from '@/shared/domain';

export interface AttentionIssue extends Issue {
  title_source: 'MODEL' | 'STAFF' | null;
  assigned_to: string | null;
  /** Reached the public threshold (otherwise it is here because it is urgent). */
  reached: boolean;
  /** The report whose photo neighbours see (null when hidden or none), staff's pick, and whether staff hid it. */
  photo_report_id: string | null;
  photo_choice: string | null;
  photo_hidden: boolean;
  members: { id: string; description: string; location_text: string; urgency: Urgency; status: ReportStatus; photo_id: string | null; created_at: string; affected: number }[];
}
export interface Attention {
  threshold: number;
  belowThreshold: number;
  items: AttentionIssue[];
}

/** The photo choice as the form holds it: the first photo, a chosen report, or hidden. */
const photoValue = (issue: AttentionIssue) => (issue.photo_hidden ? 'hidden' : issue.photo_choice ?? 'auto');

/**
 * Console → Lapor → Needs attention: the problems enough residents share to be public, and anything urgent. Each is
 * worked as one: a status, team, date or note reaches every report in it, and its public title can be corrected.
 */
export function NeedsAttention({ data, error, isLoading, reload }: { data?: Attention; error?: Parameters<typeof ErrorState>[0]['error']; isLoading: boolean; reload: () => void }) {
  const [open, setOpen] = useState<AttentionIssue | null>(null);
  const lang = useLang();
  const t = useT();
  const titleOf = (issue: AttentionIssue) => (lang === 'ms' ? issue.title_ms ?? issue.title : issue.title) ?? `${t(categoryLabel(issue.category))}${issue.zone_name ? ` · ${issue.zone_name}` : ''}`;
  const update = useAction((id: string, body: Record<string, unknown>) => api.patch(`/report-issues/${id}`, body), {
    success: 'Updated. Everyone who reported it or said Me too has been told.',
    onSuccess: () => {
      setOpen(null);
      reload();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const body: Record<string, unknown> = {
      status: form.status,
      assignedTo: form.assignedTo ?? '',
      targetDate: form.targetDate || null,
      staffNote: form.staffNote || undefined,
    };
    // The photo neighbours see: only sent when staff changed it.
    const photo = form.publicPhoto ?? 'auto';
    if (photo !== photoValue(open!)) {
      body.photoHidden = photo === 'hidden';
      if (photo !== 'hidden') body.photoReportId = photo === 'auto' ? null : photo;
    }
    // Only send a title when staff changed it, so a written one is not frozen by saving the status.
    if ((form.title ?? '') !== (open!.title_source === 'STAFF' ? open!.title ?? '' : '')) body.title = form.title ?? '';
    if ((form.titleMs ?? '') !== (open!.title_source === 'STAFF' ? open!.title_ms ?? '' : '')) body.titleMs = form.titleMs ?? '';
    void update.run(open!.id, body);
  };

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (isLoading || !data) return <SkeletonList rows={3} />;

  return (
    <>
      <p className="mb-5 flex items-start gap-2 rounded-xl bg-brand-50/70 px-4 py-3 text-sm text-brand-900 ring-1 ring-brand-100">
        <Info className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
        <span>
          <Text>{`Problems that ${data.threshold} or more residents reported or said Me too to, and anything urgent. One update reaches every report in the problem.`}</Text>{' '}
          {data.belowThreshold > 0 && <Text>{`${data.belowThreshold} smaller problems are still in Community reports.`}</Text>}
        </span>
      </p>

      {data.items.length === 0 ? (
        <EmptyState icon={Users} title="Nothing needs attention"><Text>When enough residents report the same problem, or something urgent comes in, it appears here.</Text></EmptyState>
      ) : (
        <ul className="stagger-in space-y-3">
          {data.items.map((issue) => (
            <li key={issue.id}>
              <button type="button" onClick={() => setOpen(issue)} className="lift glass-surface group block w-full rounded-xl border p-5 text-left shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  {issue.urgent && <Badge tone="danger"><Siren className="size-3.5" aria-hidden />Urgent</Badge>}
                  <StatusBadge status={issue.status} />
                  <LateBadge late={issue.late} />
                  <Badge tone="gold"><Users className="size-3.5" aria-hidden />{`${issue.people} residents`}</Badge>
                  <Badge tone="neutral"><FileText className="size-3.5" aria-hidden />{issue.reports === 1 ? '1 report' : `${issue.reports} reports`}</Badge>
                  <span className="ml-auto text-xs text-ink-500"><Text>First reported</Text> <Text>{timeAgo(issue.created_at)}</Text></span>
                </div>
                <div className="mt-3 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[16px] font-semibold text-ink-900"><IssueTitle issue={issue} /></p>
                    <IssueSummary issue={issue} className="mt-0.5 line-clamp-2 text-sm text-ink-600" />
                  </div>
                  <ChevronRight className="mt-1 size-5 shrink-0 text-ink-400 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
                </div>
                <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-500">
                  <span><Text>{categoryLabel(issue.category)}</Text></span>
                  {issue.zone_name && <span className="inline-flex items-center gap-1"><MapPin className="size-4" aria-hidden /><Text>{issue.zone_name}</Text></span>}
                  {(issue.assigned_to || issue.target_date) && (
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarClock className="size-4" aria-hidden />
                      {issue.assigned_to}
                      {issue.assigned_to && issue.target_date && ' · '}
                      {issue.target_date && formatDate(issue.target_date)}
                    </span>
                  )}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open ? titleOf(open) : ''}
        description={open ? `${categoryLabel(open.category)}${open.zone_name ? ` · ${open.zone_name}` : ''}` : undefined}
        wide
        footer={<><Button variant="secondary" onClick={() => setOpen(null)}><Text>Close</Text></Button><Button type="submit" form="issue-update" pending={update.pending}><Text>Save for every report</Text></Button></>}
      >
        {open && (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
              {open.urgent && <Badge tone="danger"><Siren className="size-3.5" aria-hidden />Urgent</Badge>}
              <StatusBadge status={open.status} />
              <LateBadge late={open.late} />
              <Badge tone="gold"><Users className="size-3.5" aria-hidden />{`${open.people} residents`}</Badge>
            </div>
            <IssueSummary issue={open} className="text-[15px] text-ink-700" />

            <form method="post" id="issue-update" key={open.id} onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
              <p className="flex items-start gap-2 text-sm text-ink-600 sm:col-span-3">
                <Sparkles className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                <Text>{open.title_source === 'STAFF' ? 'The public title was set by staff. Clear both boxes to let SimeTown write it again.' : 'The public title is written by SimeTown from the reports. Type one here only if it needs correcting; it is then kept.'}</Text>
              </p>
              <Input label="Public title" name="title" defaultValue={open.title_source === 'STAFF' ? open.title ?? '' : ''} placeholder={open.title ?? ''} maxLength={80} className="sm:col-span-3 lg:col-span-2" />
              <Input label="Public title in Malay" name="titleMs" defaultValue={open.title_source === 'STAFF' ? open.title_ms ?? '' : ''} placeholder={open.title_ms ?? ''} maxLength={80} className="sm:col-span-3 lg:col-span-1" />
              <Select label="Status" name="status" defaultValue={open.status} hint="Applies to every open report in this problem.">
                {REPORT_STATUSES.map((st) => <option key={st} value={st}><Text>{STATUS_LABELS[st]}</Text></option>)}
              </Select>
              <Input label="Who is fixing it" name="assignedTo" defaultValue={open.assigned_to ?? ''} maxLength={80} placeholder="e.g. Landscape contractor" />
              <Input label="Target date" name="targetDate" type="date" defaultValue={open.target_date ?? ''} hint="Residents see this date." />
              <Textarea label="Note to residents (optional)" name="staffNote" maxLength={500} className="sm:col-span-3" hint="Everyone who reported it or said Me too sees it." />
              <div className="flex flex-col gap-4 rounded-xl border border-ink-100 bg-ink-50/50 p-4 sm:col-span-3 sm:flex-row sm:items-start">
                {open.photo_report_id ? (
                  <LocalizedImg src={`/api/v1/reports/${open.photo_report_id}/photo`} alt="The photo neighbours see" className="h-28 w-full shrink-0 rounded-lg object-cover ring-1 ring-ink-200 sm:w-40" />
                ) : (
                  <span className="grid h-28 w-full shrink-0 place-items-center rounded-lg bg-white text-ink-400 ring-1 ring-ink-200 sm:w-40"><ImageOff className="size-6" aria-hidden /></span>
                )}
                <div className="min-w-0 flex-1">
                  <Select label="Photo neighbours see" name="publicPhoto" defaultValue={photoValue(open)} hint="Hide it if it shows a face, a car plate or a house number. The change is logged.">
                    <option value="auto">{t('The first report’s photo')}</option>
                    {open.members.map((report, n) => report.photo_id && <option key={report.id} value={report.id}>{t(`Photo from report ${n + 1}`)}</option>)}
                    <option value="hidden">{t('No photo (hidden from neighbours)')}</option>
                  </Select>
                </div>
              </div>
            </form>

            <section>
              <h3 className="mb-3 text-sm font-semibold text-ink-900"><Text>{open.members.length === 1 ? 'The report' : `The ${open.members.length} reports`}</Text></h3>
              <ul className="divide-y divide-ink-100 overflow-hidden rounded-xl border border-ink-100">
                {open.members.map((report, n) => (
                  <li key={report.id} className="space-y-2 bg-white/60 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                      <span className="font-semibold text-ink-700"><Text>{`Report ${n + 1}`}</Text></span>
                      {report.id === open.photo_report_id && <Badge tone="brand"><Text>Neighbours see this photo</Text></Badge>}
                      <UrgencyBadge urgency={report.urgency} />
                      <StatusBadge status={report.status} />
                      {report.affected > 1 && <span><Text>{`+${report.affected - 1} Me too`}</Text></span>}
                      <span className="ml-auto"><Text>{timeAgo(report.created_at)}</Text></span>
                    </div>
                    <p className="whitespace-pre-line text-[15px] text-ink-800">{report.description}</p>
                    <p className="inline-flex items-center gap-1.5 text-sm text-ink-500"><MapPin className="size-4" aria-hidden />{report.location_text}</p>
                    <ReportPhoto report={report} />
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </Modal>
    </>
  );
}
