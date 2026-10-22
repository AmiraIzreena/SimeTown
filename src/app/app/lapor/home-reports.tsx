'use client';

import { Text } from '@/components/ui/localized-text';

import { ArrowRight, Check, ChevronDown, MessageSquare, ShieldCheck, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useId, useState, type CSSProperties } from 'react';
import { REPORT_STATUS_LABELS, REPORT_STATUS_TONES, SERVICE_ICONS } from '@/components/features/home-services';
import { Badge, Card } from '@/components/ui/card';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { Reveal } from '@/components/ui/reveal';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { useSkeletonHold } from '@/lib/use-min-loading';
import { SERVICE_CATEGORY_LABELS, SERVICE_REPORT_CATEGORY_LABELS, type ServiceCategory, type ServiceReportCategory, type ServiceReportStatus } from '@/shared/domain';

interface HomeReport {
  id: string;
  booking_id: string;
  category: ServiceReportCategory;
  status: ServiceReportStatus;
  description: string;
  staff_note: string | null;
  created_at: string;
  updated_at: string;
  merchant_name: string;
  worker_name: string | null;
  service_category: ServiceCategory;
  scheduled_at: string | null;
  /** Each status change and message from the township team, oldest first. */
  history: { at: string; to: ServiceReportStatus | null; note: string | null }[];
}

/** What the resident can expect next, for each status. */
const NEXT: Record<ServiceReportStatus, string> = {
  NEW: 'Waiting for the township team to pick it up. You will be notified when they do.',
  REVIEWING: 'The township team is looking into it. You will be notified of each update.',
  CLOSED: 'This report is closed.',
};

/** The resident's private reports about home-service visits. Made from a booking in SimeTown Home; read here. */
export function HomeServiceReports() {
  const list = useApi<HomeReport[]>('/home-services/reports');
  const loading = useSkeletonHold(!list.data && !list.error);
  const reports = list.data ?? [];
  const open = reports.filter((r) => r.status !== 'CLOSED').length;
  // A link can open one report directly (/app/lapor?tab=home&report=…).
  const linked = useSearchParams().get('report');

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-brand-800">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        <Text>Only the township team sees these reports. The company and the worker never do. To report a visit, open the booking in SimeTown Home.</Text>
      </p>
      {list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.mutate()} />
      ) : loading ? (
        <SkeletonList rows={3} />
      ) : reports.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="No home service reports"
          action={<Link href="/app/home-services" className="text-sm font-semibold text-brand-700 hover:underline"><Text>Go to SimeTown Home</Text></Link>}
        >
          <Text>{"If something goes wrong on a home-service visit, report it from the booking. It will appear here with the township team's replies."}</Text>
        </EmptyState>
      ) : (
        <>
          <p className="text-sm text-ink-600" aria-live="polite">
            <Text>{`${reports.length} ${reports.length === 1 ? 'report' : 'reports'}`}</Text> · <Text>{`${open} open`}</Text>
          </p>
          {/* A new link (a tapped notification while already here) opens its report afresh. */}
          <ul key={linked ?? ''} className="space-y-3">
            {reports.map((r, i) => (
              <li key={r.id}>
                <Reveal index={i}>
                  {/* Only one report is opened by default: the linked one, or the only one there is. */}
                  <ReportCard report={r} startOpen={linked ? linked === r.id : reports.length === 1} />
                </Reveal>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ReportCard({ report: r, startOpen }: { report: HomeReport; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const panel = useId();
  useEffect(() => {
    if (startOpen) document.getElementById(`report-${r.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [startOpen, r.id]);

  const Icon = SERVICE_ICONS[r.service_category] ?? Wrench;
  const reviewedAt = r.history.find((h) => h.to === 'REVIEWING')?.at ?? null;
  const closedAt = [...r.history].reverse().find((h) => h.to === 'CLOSED')?.at ?? null;
  const steps = [
    { key: 'NEW', label: 'Received', done: true, at: r.created_at as string | null },
    // A report can be closed straight from Received; Under review then counts as passed, with no time.
    { key: 'REVIEWING', label: 'Under review', done: r.status !== 'NEW', at: reviewedAt },
    { key: 'CLOSED', label: 'Closed', done: r.status === 'CLOSED', at: closedAt },
  ];
  const current = steps.findIndex((s) => !s.done);
  const reached = current === -1 ? steps.length : current;
  // Messages from the township team; reports from before messages were kept show the latest one.
  const notes = r.history.filter((h) => h.note).map((h) => ({ at: h.at, note: h.note! }));
  if (notes.length === 0 && r.staff_note) notes.push({ at: r.updated_at, note: r.staff_note });

  return (
    <Card id={`report-${r.id}`} className={cn('hs-report scroll-mt-24 overflow-hidden', open && 'is-open')}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={panel}
        className="hs-report-head flex w-full items-start gap-3 p-4 text-left sm:p-5 focus-visible:-outline-offset-2"
      >
        <span className="hs-report-icon grid size-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><Icon className="size-5" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-display text-[16px] font-bold text-ink-900"><Text>{SERVICE_REPORT_CATEGORY_LABELS[r.category] ?? r.category}</Text></span>
            <Badge tone={REPORT_STATUS_TONES[r.status]}><Text>{REPORT_STATUS_LABELS[r.status]}</Text></Badge>
          </span>
          <span className="mt-0.5 block text-sm text-ink-600">
            <Text>{SERVICE_CATEGORY_LABELS[r.service_category] ?? r.service_category}</Text> · {r.merchant_name}
            {r.worker_name && <> · <Text>Worker</Text>: {r.worker_name}</>}
          </span>
          {/* At a glance: how far the report has come. */}
          <span className="mt-3 flex items-center gap-3">
            <span className="flex w-full max-w-56 gap-1" aria-hidden>
              {steps.map((s, i) => (
                <span key={s.key} className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                  <span className={cn('hs-segment block h-full rounded-full', s.done ? 'bg-success-600' : 'bg-transparent')} style={{ '--i': i } as CSSProperties} />
                </span>
              ))}
            </span>
            <span className="shrink-0 text-xs font-medium text-ink-500"><Text>{`Step ${reached} of ${steps.length}`}</Text></span>
          </span>
        </span>
        <span className="mt-1 flex shrink-0 items-center gap-1 text-xs font-semibold text-brand-700">
          <span className="hidden sm:inline"><Text>{open ? 'Hide progress' : 'See progress'}</Text></span>
          <ChevronDown className={cn('size-4 transition-transform duration-200 ease-soft motion-reduce:transition-none', open && 'rotate-180')} aria-hidden />
        </span>
      </button>

      <div id={panel} className="hs-report-panel grid" inert={!open}>
        <div className="min-h-0 overflow-hidden">
          <div className="grid gap-5 border-t border-ink-100 px-4 py-5 sm:px-5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:gap-8">
            <section aria-labelledby={`${panel}-progress`}>
              <h3 id={`${panel}-progress`} className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Progress</Text></h3>
              <ol className="report-progress mt-3">
                {steps.map((s, i) => (
                  <li key={s.key} className={cn('report-progress-step hs-step', s.done && 'is-done', i === current && 'is-current')} style={{ '--i': i } as CSSProperties}>
                    <span className="report-progress-dot" aria-hidden>{s.done ? <Check className="size-3.5" /> : null}</span>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold text-ink-900"><Text>{s.label}</Text></span>
                      <span className="block text-sm text-ink-500">
                        {s.at ? <Text>{formatDateTime(s.at)}</Text> : i === current ? <Text>Next step</Text> : s.done ? <Text>Done</Text> : <Text>Not yet</Text>}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
              <p className={cn('hs-step mt-4 rounded-md p-3 text-sm', r.status === 'CLOSED' ? 'bg-ink-50 text-ink-700' : 'bg-brand-50 text-brand-800')} style={{ '--i': steps.length } as CSSProperties}>
                <Text>{NEXT[r.status]}</Text>
              </p>
            </section>

            <section aria-labelledby={`${panel}-updates`}>
              <h3 id={`${panel}-updates`} className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Updates</Text></h3>
              <ol className="mt-3 space-y-2">
                <li className="hs-step ml-8 rounded-lg bg-brand-50 px-3 py-2 text-[15px] text-ink-800" style={{ '--i': 0 } as CSSProperties}>
                  <p className="text-xs text-ink-500"><Text>You</Text> · <Text>{formatDateTime(r.created_at)}</Text></p>
                  <p className="whitespace-pre-line break-words">{r.description}</p>
                </li>
                {notes.map((n, i) => (
                  <li key={`${n.at}-${i}`} className="hs-step mr-8 rounded-lg bg-white px-3 py-2 text-[15px] text-ink-800 shadow-xs ring-1 ring-ink-100" style={{ '--i': i + 1 } as CSSProperties}>
                    <p className="flex items-center gap-1.5 text-xs text-ink-500"><MessageSquare className="size-3.5 text-brand-700" aria-hidden /><Text>Township team</Text> · <Text>{formatDateTime(n.at)}</Text></p>
                    <p className="whitespace-pre-line break-words">{n.note}</p>
                  </li>
                ))}
              </ol>
              {notes.length === 0 && <p className="mt-2 text-sm text-ink-500"><Text>No reply from the township team yet.</Text></p>}
              <Link
                href={`/app/home-services?booking=${r.booking_id}`}
                className="hs-link mt-4 inline-flex items-center gap-1 rounded text-sm font-semibold text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                <Text>View booking</Text><ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </section>
          </div>
        </div>
      </div>
    </Card>
  );
}
