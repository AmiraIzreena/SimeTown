'use client';

import { Text } from '@/components/ui/localized-text';

import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { BookingStatusBadge, BookingTimeline, REPORT_STATUS_LABELS, REPORT_STATUS_TONES, type BookingEvent } from '@/components/features/home-services';
import { Button } from '@/components/ui/button';
import { Badge, PageHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState } from '@/components/ui/feedback';
import { Select, Textarea } from '@/components/ui/field';
import { DataTable } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { formatDateTime, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import {
  formatPhone, SERVICE_CATEGORY_LABELS, SERVICE_REPORT_CATEGORY_LABELS, SERVICE_REPORT_STATUSES,
  type BookingStatus, type ServiceCategory, type ServiceReportCategory, type ServiceReportStatus,
} from '@/shared/domain';

interface Row {
  id: string;
  category: ServiceReportCategory;
  status: ServiceReportStatus;
  description: string;
  created_at: string;
  merchant_name: string;
  worker_name: string | null;
  resident_name: string;
  service_category: ServiceCategory;
}
interface Detail {
  id: string;
  category: ServiceReportCategory;
  status: ServiceReportStatus;
  description: string;
  staff_note: string | null;
  created_at: string;
  worker_name: string | null;
  workerPhone: string | null;
  workerRecord: { reports: number; jobs: number } | null;
  companyRecord: { reports: number; jobs: number };
  companyPhone: string | null;
  booking: {
    id: string;
    status: BookingStatus;
    category: ServiceCategory;
    merchantName: string;
    problem: string;
    scheduledAt: string | null;
    residentName: string;
    residentPhone: string | null;
    address: string;
    hasPhoto: boolean;
  } | null;
  history: BookingEvent[];
}

export default function HomeServiceReportsPage() {
  const [tab, setTab] = useState<'OPEN' | 'CLOSED'>('OPEN');
  const reports = useApi<Row[]>('/admin/home-services/reports');
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      <PageHeader title="Home service reports" description="Private reports from residents about a home service visit. Each is tied to the booking and the worker assigned at the time. Companies never see them." />
      <Tabs label="Reports" value={tab} onChange={setTab} items={[{ key: 'OPEN', label: 'Open' }, { key: 'CLOSED', label: 'Closed' }]} />
      <div className="mt-5">
        <Async state={reports}>
          {(all) => {
            const list = all.filter((r) => (tab === 'CLOSED') === (r.status === 'CLOSED'));
            return list.length === 0 ? (
              <EmptyState icon={ShieldCheck} title="Nothing here"><Text>{tab === 'OPEN' ? 'No reports are waiting.' : 'No closed reports yet.'}</Text></EmptyState>
            ) : (
              <DataTable
                caption="Home service reports"
                rows={list}
                keyOf={(r) => r.id}
                columns={[
                  { header: 'Received', cell: (r) => timeAgo(r.created_at) },
                  { header: 'Problem', cell: (r) => <Badge tone={r.category === 'HARASSMENT' ? 'danger' : 'warning'}><Text>{SERVICE_REPORT_CATEGORY_LABELS[r.category]}</Text></Badge> },
                  { header: 'Company', cell: (r) => r.merchant_name },
                  { header: 'Worker', desktopOnly: true, cell: (r) => r.worker_name ?? '—' },
                  { header: 'Status', cell: (r) => <Badge tone={REPORT_STATUS_TONES[r.status]}><Text>{REPORT_STATUS_LABELS[r.status]}</Text></Badge> },
                  { header: '', align: 'right', cell: (r) => <Button size="sm" variant="secondary" onClick={() => setOpenId(r.id)}><Text>Open</Text></Button> },
                ]}
              />
            );
          }}
        </Async>
      </div>
      <ReportModal id={openId} onClose={() => setOpenId(null)} onChanged={() => void reports.mutate()} />
    </>
  );
}

function ReportModal({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const detail = useApi<Detail>(id ? `/admin/home-services/reports/${id}` : null);
  const update = useAction((status: ServiceReportStatus, staffNote: string) => api.patch(`/admin/home-services/reports/${id}`, { status, staffNote: staffNote || undefined }), {
    success: 'Saved. The resident has been told.',
    onSuccess: () => {
      void detail.mutate();
      onChanged();
    },
  });
  return (
    <Modal open={id !== null} onClose={onClose} title="Home service report" wide>
      <Async state={detail}>
        {(r) => (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={r.category === 'HARASSMENT' ? 'danger' : 'warning'}><Text>{SERVICE_REPORT_CATEGORY_LABELS[r.category]}</Text></Badge>
              <Badge tone={REPORT_STATUS_TONES[r.status]}><Text>{REPORT_STATUS_LABELS[r.status]}</Text></Badge>
              <span className="text-sm text-ink-500"><Text>{formatDateTime(r.created_at)}</Text></span>
            </div>
            <p className="whitespace-pre-line text-[15px] text-ink-800">{r.description}</p>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-ink-25 p-3 text-sm text-ink-700">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Worker at the time</Text></p>
                <p className="mt-1 text-[15px] font-semibold text-ink-900">{r.worker_name ?? <Text>Not yet assigned</Text>}</p>
                {r.workerPhone && <p>{formatPhone(r.workerPhone)}</p>}
                {r.workerRecord && <p><Text>{`${r.workerRecord.reports} reports · ${r.workerRecord.jobs} completed jobs`}</Text></p>}
              </div>
              <div className="rounded-lg bg-ink-25 p-3 text-sm text-ink-700">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Company</Text></p>
                <p className="mt-1 text-[15px] font-semibold text-ink-900">{r.booking?.merchantName}</p>
                {r.companyPhone && <p>{formatPhone(r.companyPhone)}</p>}
                <p><Text>{`${r.companyRecord.reports} reports · ${r.companyRecord.jobs} completed jobs`}</Text></p>
              </div>
            </div>

            {r.booking && (
              <div className="rounded-lg border border-ink-200 p-3 text-sm text-ink-700">
                <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>The booking</Text> <BookingStatusBadge status={r.booking.status} /></p>
                <p className="mt-1"><Text>{SERVICE_CATEGORY_LABELS[r.booking.category]}</Text>{r.booking.scheduledAt && <> · <Text>{formatDateTime(r.booking.scheduledAt)}</Text></>}</p>
                <p className="mt-1">{r.booking.problem}</p>
                <p className="mt-2 font-semibold text-ink-900">{r.booking.residentName}</p>
                <p>{r.booking.address}</p>
                {r.booking.residentPhone && <p>{formatPhone(r.booking.residentPhone)}</p>}
              </div>
            )}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Who was assigned, and when</Text></p>
              <BookingTimeline events={r.history} />
            </div>

            <form
              method="post"
              className="space-y-3 border-t border-ink-100 pt-4"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void update.run(String(data.get('status')) as ServiceReportStatus, String(data.get('staffNote') ?? '').trim());
              }}
            >
              {r.staff_note && <p className="rounded-md bg-brand-50 p-3 text-sm text-brand-800"><Text>Last note to the resident: </Text>{r.staff_note}</p>}
              <Select label="Status" name="status" defaultValue={r.status} disabled={r.status === 'CLOSED'}>
                {SERVICE_REPORT_STATUSES.map((s) => <option key={s} value={s}><Text>{REPORT_STATUS_LABELS[s]}</Text></option>)}
              </Select>
              {r.status === 'CLOSED' && <input type="hidden" name="status" value="CLOSED" />}
              <Textarea label="Note to the resident" name="staffNote" maxLength={500} hint="The resident sees this. Do not include the company's or worker's private details." error={update.fields.staffNote} />
              <Button type="submit" size="sm" pending={update.pending}><Text>Save and tell the resident</Text></Button>
            </form>
          </div>
        )}
      </Async>
    </Modal>
  );
}
