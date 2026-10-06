'use client';

import { MapPin, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ReportPhoto, STATUS_LABELS, StatusBadge, URGENCY_LABELS, UrgencyBadge, categoryLabel, type Report } from '@/components/features/report-bits';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { Select, Textarea } from '@/components/ui/field';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useAction, usePaged } from '@/lib/hooks';
import { REPORT_CATEGORIES, REPORT_CATEGORY_LABELS, REPORT_STATUSES, URGENCIES, type ReportStatus } from '@/shared/domain';

export default function ReportQueuePage() {
  const [status, setStatus] = useState<ReportStatus>('NEW');
  const reports = usePaged<Report>(`/reports?status=${status}&limit=15`);
  const [open, setOpen] = useState<Report | null>(null);

  const update = useAction((id: string, body: Record<string, unknown>) => api.patch(`/reports/${id}`, body), {
    success: 'Report updated. The resident has been told.',
    onSuccess: () => {
      setOpen(null);
      void reports.reload();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    void update.run(open!.id, { status: form.status, category: form.category, urgency: form.urgency, staffNote: form.staffNote || undefined });
  };
  const closed = open?.status === 'RESOLVED' || open?.status === 'REJECTED';

  return (
    <>
      <PageHeader title="Reports" description="Residents’ reports for this township. The type and urgency are suggestions: correct them whenever they are wrong. Every correction is logged." />
      <Tabs<ReportStatus> label="Report status" value={status} onChange={setStatus} items={REPORT_STATUSES.map((s) => ({ key: s, label: STATUS_LABELS[s] }))} />
      <TabPanel>
        {reports.error ? (
          <ErrorState error={reports.error} onRetry={() => void reports.reload()} />
        ) : reports.isLoading ? (
          <SkeletonList rows={4} />
        ) : reports.items.length === 0 ? (
          <EmptyState title="Nothing here">No reports with this status.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {[...reports.items]
              .sort((a, b) => URGENCIES.indexOf(b.urgency) - URGENCIES.indexOf(a.urgency))
              .map((report) => (
                <li key={report.id}>
                  <button type="button" onClick={() => setOpen(report)} className="lift block w-full rounded-lg border border-ink-200 bg-white p-5 text-left shadow-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <UrgencyBadge urgency={report.urgency} />
                      <span className="text-sm font-semibold text-ink-900">{categoryLabel(report.category)}</span>
                      {report.zone_name && <span className="text-sm text-ink-500">· {report.zone_name}</span>}
                      <span className="ml-auto text-xs text-ink-500">{timeAgo(report.created_at)}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-[15px] text-ink-700">{report.description}</p>
                    <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-ink-500">
                      <MapPin className="size-4" aria-hidden />
                      {report.location_text}
                    </p>
                  </button>
                </li>
              ))}
          </ul>
        )}
        {reports.hasMore && (
          <div className="mt-5 text-center">
            <Button variant="secondary" onClick={() => void reports.loadMore()} pending={reports.loadingMore}>
              Show more
            </Button>
          </div>
        )}
      </TabPanel>

      <Modal
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open ? categoryLabel(open.category) : ''}
        description={open?.location_text}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(null)}>
              Close
            </Button>
            <Button type="submit" form="report-update" pending={update.pending}>
              Save
            </Button>
          </>
        }
      >
        {open && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={open.status} />
              <UrgencyBadge urgency={open.urgency} />
            </div>
            <p className="whitespace-pre-line text-[15px] text-ink-700">{open.description}</p>
            <ReportPhoto report={open} />
            {open.ai_category && (
              <p className="flex gap-2 rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-800">
                <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Suggested by {open.ai_source === 'MODEL' ? 'the AI photo and text check' : 'keyword rules'}: <strong>{REPORT_CATEGORY_LABELS[open.ai_category]}</strong>, <strong>{URGENCY_LABELS[open.ai_urgency!].toLowerCase()}</strong> urgency. You can change either below.
                </span>
              </p>
            )}
            <form method="post" id="report-update" key={open.id} onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
              <Select label="Type" name="category" defaultValue={open.category}>
                {REPORT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {REPORT_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
              <Select label="Urgency" name="urgency" defaultValue={open.urgency}>
                {URGENCIES.map((u) => (
                  <option key={u} value={u}>
                    {URGENCY_LABELS[u]}
                  </option>
                ))}
              </Select>
              <Select label="Status" name="status" defaultValue={open.status} disabled={closed} hint={closed ? 'This report is closed.' : 'The resident earns XP once it is in progress or resolved.'}>
                {REPORT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
              {closed && <input type="hidden" name="status" value={open.status} />}
              <Textarea label="Note to the resident (optional)" name="staffNote" defaultValue={open.staff_note ?? ''} maxLength={500} className="sm:col-span-3" />
            </form>
          </div>
        )}
      </Modal>
    </>
  );
}
