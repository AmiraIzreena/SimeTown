'use client';

import { Text } from '@/components/ui/localized-text';

import { ShieldCheck } from 'lucide-react';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { BookingStatusBadge, BookingTimeline, REPORT_STATUS_LABELS, REPORT_STATUS_TONES, type BookingEvent } from '@/components/features/home-services';
import { Button } from '@/components/ui/button';
import { Badge, PageHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState, SkeletonList } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/field';
import { DataTable } from '@/components/ui/table';
import { FilterBar, FilterChips, FilterMenu, FilterSummary, SearchField } from '@/components/ui/filter-bar';
import { Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { formatDateTime, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import {
  formatPhone, ROLE_LABELS, SERVICE_CATEGORY_LABELS, SERVICE_REPORT_CATEGORIES, SERVICE_REPORT_CATEGORY_LABELS,
  type BookingStatus, type Role, type ServiceCategory, type ServiceReportCategory, type ServiceReportStatus,
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
  /** The staff member who last changed the status, and when; null while nobody has. */
  handled: { by: string; role: Role; at: string } | null;
}

/** The list loads the latest reports at most; filters search within what is loaded, and say so when it is the cap. */
const LOADED_MAX = 100;
const ALL = 'ALL';
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
  return <Suspense fallback={<SkeletonList rows={3} />}><HomeServiceReports /></Suspense>;
}

function HomeServiceReports() {
  const [tab, setTab] = useState<'OPEN' | 'CLOSED'>('OPEN');
  const [query, setQuery] = useState('');
  const [problem, setProblem] = useState<ServiceReportCategory | typeof ALL>(ALL);
  const [company, setCompany] = useState<string>(ALL);
  const [service, setService] = useState<ServiceCategory | typeof ALL>(ALL);
  const [status, setStatus] = useState<ServiceReportStatus | typeof ALL>(ALL);
  const reports = useApi<Row[]>('/admin/home-services/reports');
  // A notification links straight to its report. Only a report id is taken from the link.
  const linked = useSearchParams().get('report');
  const [openId, setOpenId] = useState<string | null>(linked && /^[0-9a-f-]{36}$/i.test(linked) ? linked : null);
  return (
    <>
      <PageHeader title="Home service reports" description="Private reports from residents about a home service visit. Each is tied to the booking and the worker assigned at the time. Companies never see them." />
      <Tabs label="Reports" value={tab} onChange={(next) => { setTab(next); setStatus(ALL); }} items={[{ key: 'OPEN', label: 'Open', count: reports.data?.filter((r) => r.status !== 'CLOSED').length }, { key: 'CLOSED', label: 'Closed' }]} />
      <div className="mt-5">
        <Async state={reports}>
          {(all) => {
            const inTab = all.filter((r) => (tab === 'CLOSED') === (r.status === 'CLOSED'));
            // Search covers what staff read in the table and the report itself: who reported it, the worker, the company and the words.
            const words = query.trim().toLowerCase();
            const matches = (r: Row) =>
              (problem === ALL || r.category === problem) &&
              (company === ALL || r.merchant_name === company) &&
              (service === ALL || r.service_category === service) &&
              (status === ALL || r.status === status) &&
              (!words || [r.resident_name, r.worker_name ?? '', r.merchant_name, r.description, SERVICE_REPORT_CATEGORY_LABELS[r.category], SERVICE_CATEGORY_LABELS[r.service_category]].some((s) => s.toLowerCase().includes(words)));
            const list = inTab.filter(matches);
            const filtered = Boolean(words) || problem !== ALL || company !== ALL || service !== ALL || status !== ALL;
            const clear = () => { setQuery(''); setProblem(ALL); setCompany(ALL); setService(ALL); setStatus(ALL); };
            const companies = [...new Set(inTab.map((r) => r.merchant_name))].sort();
            const services = [...new Set(inTab.map((r) => r.service_category))];
            const problems = SERVICE_REPORT_CATEGORIES.filter((c) => inTab.some((r) => r.category === c));
            if (inTab.length === 0) {
              return <EmptyState icon={ShieldCheck} title={tab === 'OPEN' ? 'No open reports' : 'No closed reports'}><Text>{tab === 'OPEN' ? 'New reports from residents will appear here.' : 'Reports you close will appear here.'}</Text></EmptyState>;
            }
            return (
              <div className="space-y-4">
                <FilterBar
                  search={<SearchField value={query} onChange={setQuery} label="Search reports" placeholder="Resident, worker, company or words in the report" />}
                  chips={
                    <FilterChips<ServiceReportCategory | typeof ALL>
                      label="Problem"
                      value={problem}
                      onChange={setProblem}
                      options={[
                        { key: ALL, label: 'All problems', count: inTab.length },
                        ...problems.map((c) => ({ key: c, label: SERVICE_REPORT_CATEGORY_LABELS[c], count: inTab.filter((r) => r.category === c).length, alert: c === 'HARASSMENT' })),
                      ]}
                    />
                  }
                  controls={
                    <>
                      <FilterMenu label="Company" value={company} onChange={setCompany} options={[{ value: ALL, label: 'Any' }, ...companies.map((c) => ({ value: c, label: c, raw: true }))]} />
                      <FilterMenu<ServiceCategory | typeof ALL> label="Service" value={service} onChange={setService} options={[{ value: ALL, label: 'Any' }, ...services.map((s) => ({ value: s, label: SERVICE_CATEGORY_LABELS[s] }))]} />
                      {tab === 'OPEN' && (
                        <FilterMenu<ServiceReportStatus | typeof ALL> label="Status" value={status} onChange={setStatus} options={[{ value: ALL, label: 'Any' }, { value: 'NEW', label: REPORT_STATUS_LABELS.NEW }, { value: 'REVIEWING', label: REPORT_STATUS_LABELS.REVIEWING }]} />
                      )}
                    </>
                  }
                  summary={<FilterSummary shown={list.length} total={inTab.length} noun={inTab.length === 1 ? 'report' : 'reports'} onClear={filtered ? clear : undefined} />}
                />
                {all.length >= LOADED_MAX && (
                  <p className="text-sm text-ink-500"><Text>{`Showing the latest ${LOADED_MAX} reports. Search and filters look within these.`}</Text></p>
                )}
                {list.length === 0 ? (
                  <EmptyState icon={ShieldCheck} title="No reports match" action={<Button variant="secondary" onClick={clear}><Text>Clear filters</Text></Button>}><Text>Try another name or word, or clear the filters.</Text></EmptyState>
                ) : (
                  <DataTable
                    caption="Home service reports"
                    rows={list}
                    keyOf={(r) => r.id}
                    columns={[
                      { header: 'Received', cell: (r) => <span title={formatDateTime(r.created_at)}><Text>{timeAgo(r.created_at)}</Text></span> },
                      {
                        header: 'Problem',
                        cell: (r) => (
                          <span className="block min-w-0 max-w-sm">
                            <Badge tone={r.category === 'HARASSMENT' ? 'danger' : 'warning'}><Text>{SERVICE_REPORT_CATEGORY_LABELS[r.category]}</Text></Badge>
                            <span className="mt-1 block truncate text-sm text-ink-600" title={r.description}>{r.description}</span>
                          </span>
                        ),
                      },
                      // Who made the report: residents are named to staff only; companies never see these reports.
                      { header: 'Reported by', cell: (r) => <span className="font-medium text-ink-900">{r.resident_name}</span> },
                      {
                        header: 'Company and worker',
                        desktopOnly: true,
                        cell: (r) => (
                          <span className="block">
                            <span className="block text-ink-900">{r.merchant_name}</span>
                            <span className="block text-sm text-ink-500">{r.worker_name ?? <Text>No worker assigned</Text>} · <Text>{SERVICE_CATEGORY_LABELS[r.service_category]}</Text></span>
                          </span>
                        ),
                      },
                      {
                        header: 'Status',
                        cell: (r) => (
                          <span className="block">
                            <Badge tone={REPORT_STATUS_TONES[r.status]}><Text>{REPORT_STATUS_LABELS[r.status]}</Text></Badge>
                            <span className="mt-1 block text-xs text-ink-500">
                              {r.handled ? <><Text>by </Text>{r.handled.by}<Text>{` (${ROLE_LABELS[r.handled.role]})`}</Text>{' · '}<Text>{timeAgo(r.handled.at)}</Text></> : <Text>Not picked up yet</Text>}
                            </span>
                          </span>
                        ),
                      },
                      { header: '', align: 'right', cell: (r) => <Button size="sm" variant="secondary" onClick={() => setOpenId(r.id)}><Text>Open</Text></Button> },
                    ]}
                  />
                )}
              </div>
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
  const [noteMissing, setNoteMissing] = useState(false);
  const update = useAction((status: ServiceReportStatus, staffNote: string) => api.patch(`/admin/home-services/reports/${id}`, { status, staffNote: staffNote || undefined }), {
    success: 'Saved. The resident has been notified.',
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
                const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
                const note = String(new FormData(event.currentTarget).get('staffNote') ?? '').trim();
                // "Send update" moves a new report to Under review; "Close report" closes it. Both tell the resident.
                const status: ServiceReportStatus = submitter?.value === 'close' ? 'CLOSED' : r.status === 'NEW' ? 'REVIEWING' : r.status;
                // Nothing would change, so there must be a message to send.
                setNoteMissing(status === r.status && !note);
                if (status !== r.status || note) void update.run(status, note);
              }}
            >
              {r.staff_note && <p className="rounded-md bg-brand-50 p-3 text-sm text-brand-800"><Text>Last note to the resident: </Text>{r.staff_note}</p>}
              <Textarea label="Message to the resident" name="staffNote" maxLength={500} hint="The resident sees this. Do not include the company's or worker's private details." error={noteMissing ? 'Write a message to send.' : update.fields.staffNote} />
              <div className="flex flex-wrap gap-2">
                {r.status !== 'CLOSED' && <Button type="submit" size="sm" value="update" pending={update.pending}><Text>Send update to resident</Text></Button>}
                {r.status !== 'CLOSED' && <Button type="submit" size="sm" variant="secondary" value="close" disabled={update.pending}><Text>Close report</Text></Button>}
                {r.status === 'CLOSED' && <Button type="submit" size="sm" value="update" pending={update.pending}><Text>Send a message to the resident</Text></Button>}
              </div>
            </form>
          </div>
        )}
      </Async>
    </Modal>
  );
}
