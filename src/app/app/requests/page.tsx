'use client';

import { Text } from '@/components/ui/localized-text';

import { Archive, ChevronRight, Flag, Inbox, Package, Recycle, TriangleAlert, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AffectedBadge } from '@/components/features/report-bits';
import { Badge, PageHeader } from '@/components/ui/card';
import { Async, EmptyState, SkeletonList } from '@/components/ui/feedback';
import { formatDate, formatDateTime, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { REPORT_CATEGORY_LABELS, type ReportCategory } from '@/shared/domain';
import { CATEGORY_LABELS, RESIDENT_STATUS, type IncidentStatus } from '@/shared/incidents';
import { PARCEL_STATE_LABELS, type ParcelState } from '@/shared/lockers';

type ReportStep = 'RECEIVED' | 'CHECKED' | 'ASSIGNED' | 'FIXED' | 'CLOSED';
type Item =
  | { kind: 'REPORT'; id: string; open: boolean; category: ReportCategory; place: string; step: ReportStep; assignedTo: string | null; targetDate: string | null; late: boolean; mine: boolean; affected: number; at: string; link: string }
  | { kind: 'PARCEL'; id: string; open: true; courier: string; shelf: string; at: string; link: string }
  | { kind: 'LOCKER'; id: string; open: true; courier: string; state: ParcelState; station: string; compartment: string | null; counter: string | null; deadlineAt: string | null; at: string; link: string }
  | { kind: 'COLLECTION'; id: string; open: true; collector: string; day: string; slot: 'MORNING' | 'AFTERNOON'; status: 'REQUESTED' | 'CONFIRMED'; at: string; link: string }
  | { kind: 'INCIDENT'; id: string; reference: string; category: string; status: IncidentStatus; open: boolean; awaitingYou: boolean; handled: boolean; at: string; link: string };

const SLOT_LABELS = { MORNING: 'Morning', AFTERNOON: 'Afternoon' } as const;
const ICONS: Record<Item['kind'], LucideIcon> = { REPORT: TriangleAlert, PARCEL: Package, LOCKER: Archive, COLLECTION: Recycle, INCIDENT: Flag };

/** Where a report stands, and what happens next, in a resident's words. */
function reportLines(r: Extract<Item, { kind: 'REPORT' }>): { now: ReactNode; next: string | null } {
  switch (r.step) {
    case 'RECEIVED':
      return { now: 'Received', next: 'Next: township staff check it' };
    case 'CHECKED':
      return { now: 'Checked by staff', next: 'Next: a team is given the job and a target date' };
    case 'ASSIGNED':
      return {
        now: r.assignedTo ? `Assigned to ${r.assignedTo}` : 'Assigned to a team',
        next: r.targetDate ? `Expected fixed by ${formatDate(r.targetDate)}` : 'Next: fixed',
      };
    case 'FIXED':
      return { now: 'Fixed', next: null };
    case 'CLOSED':
      return { now: 'Closed without action', next: null };
  }
}

function lines(item: Item): { title: string; now: ReactNode; next: string | null } {
  switch (item.kind) {
    case 'REPORT':
      return { title: REPORT_CATEGORY_LABELS[item.category], ...reportLines(item) };
    case 'PARCEL':
      return { title: `Parcel from ${item.courier}`, now: `Waiting on shelf ${item.shelf} at the guardhouse`, next: 'Show your collection code at the guardhouse' };
    case 'LOCKER':
      return {
        title: `Parcel from ${item.courier}`,
        now: item.counter ? <><Text>{PARCEL_STATE_LABELS[item.state]}</Text>: {item.counter}</> : <><Text>{PARCEL_STATE_LABELS[item.state]}</Text>: {item.station}{item.compartment && <>, <Text>{`door ${item.compartment}`}</Text></>}</>,
        next: item.deadlineAt ? `Collect by ${formatDateTime(item.deadlineAt)}` : 'Open Parcels for your pickup code',
      };
    case 'COLLECTION':
      return {
        title: `Recycling collection by ${item.collector}`,
        now: <><Text>{formatDate(item.day)}</Text>, <Text>{SLOT_LABELS[item.slot]}</Text></>,
        next: item.status === 'CONFIRMED' ? 'Confirmed. The gate has the collector’s pass.' : 'Waiting for the collector to confirm',
      };
    case 'INCIDENT':
      return {
        title: `${CATEGORY_LABELS[item.category] ?? 'Report'} (${item.reference})`,
        now: <Text>{RESIDENT_STATUS[item.status]}</Text>,
        next: item.awaitingYou ? 'The township office has asked you a question. Open it to answer.' : item.open ? (item.handled ? 'Someone in the township office is handling it.' : 'Waiting for someone in the township office to take it.') : 'Open it to see the outcome.',
      };
  }
}

export default function RequestsPage() {
  const requests = useApi<{ open: number; items: Item[] }>('/requests', { refreshInterval: 30_000 });
  return (
    <>
      <PageHeader
        title="Request tracking"
        description="Everything your home is waiting on, in one place: reports, parcels and recycling collections. Each shows where it stands and what happens next."
      />
      <Async state={requests} skeleton={<SkeletonList rows={4} />}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState icon={Inbox} title="Nothing waiting"><Text>Reports you send or follow, parcels at the guardhouse and in the lockers, and recycling collections show up here.</Text></EmptyState>
          ) : (
            <>
              <p className="mb-4 text-sm font-medium text-ink-600"><Text>{data.open === 1 ? '1 open request' : `${data.open} open requests`}</Text></p>
              <ul className="space-y-3">
                {data.items.map((item) => {
                  const Icon = ICONS[item.kind];
                  const l = lines(item);
                  return (
                    <li key={`${item.kind}:${item.id}`}>
                      <Link href={item.link} className="lift flex items-start gap-4 rounded-lg border border-ink-200 bg-white p-5 shadow-xs">
                        <span className={item.open ? 'grid size-10 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700' : 'grid size-10 shrink-0 place-items-center rounded-full bg-ink-100 text-ink-500'}>
                          <Icon className="size-5" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-[15px] font-semibold text-ink-900"><Text>{l.title}</Text></span>
                            {item.kind === 'REPORT' && item.late && <Badge tone="danger"><Text>Late</Text></Badge>}
                            {item.kind === 'REPORT' && !item.mine && <Badge tone="neutral"><Text>Following</Text></Badge>}
                            {item.kind === 'REPORT' && <AffectedBadge affected={item.affected} />}
                          </span>
                          {item.kind === 'REPORT' && <span className="block text-sm text-ink-500">{item.place}</span>}
                          <span className="mt-1 block text-[15px] text-ink-800"><Text>{l.now}</Text></span>
                          {l.next && <span className="block text-sm text-ink-500"><Text>{l.next}</Text></span>}
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-2 text-xs text-ink-500">
                          <Text>{timeAgo(item.at)}</Text>
                          <ChevronRight className="size-4" aria-hidden />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )
        }
      </Async>
    </>
  );
}
