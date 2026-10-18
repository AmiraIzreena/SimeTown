'use client';

import Link from 'next/link';
import { Clock, Package, PackageCheck, ShieldAlert } from 'lucide-react';
import { Text } from '@/components/ui/localized-text';
import { PageHeader, Stat } from '@/components/ui/card';
import { Async, SkeletonStats } from '@/components/ui/feedback';
import { useApi } from '@/lib/hooks';

interface ParcelStats {
  waiting: number;
  overdue: number;
  collected30d: number;
  returned30d: number;
  medianHoursToCollect: number | null;
  sameDayPct: number | null;
  problems30d: number;
  errorRatePct: number | null;
}

export default function ParcelStatsPage() {
  const stats = useApi<ParcelStats>('/admin/parcels/stats', { refreshInterval: 30_000 });
  return (
    <>
      <PageHeader title="Guardhouse parcels" description="Monitor parcel collection performance and resolve resident-reported guardhouse issues." />
      <Async state={stats} skeleton={<SkeletonStats count={4} />}>
        {(s) => (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Waiting for collection" value={s.waiting} icon={Package} hint={s.overdue ? `${s.overdue} waiting 3 days or more` : 'None waiting long'} />
            <Stat label="Typical collection time" value={s.medianHoursToCollect != null ? `${s.medianHoursToCollect} h` : '–'} icon={Clock} hint={s.sameDayPct != null ? `${s.sameDayPct}% collected within a day` : 'No collections yet'} />
            <Stat label="Collected, last 30 days" value={s.collected30d} icon={PackageCheck} tone="success" hint={`${s.returned30d} returned to the courier`} />
            <Link href="/console/operations?tab=guardhouse&view=cases&disputed=1" className="block rounded-xl transition-shadow hover:ring-2 hover:ring-brand-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600">
              <Stat label="Disputed handovers" value={s.problems30d} icon={ShieldAlert} tone={s.problems30d ? 'danger' : 'brand'} hint={<>{s.errorRatePct != null ? <Text>{`${s.errorRatePct}% of collections, last 30 days`}</Text> : <Text>Last 30 days</Text>}<span className="mt-1 block font-semibold text-brand-700"><Text>View related cases</Text> →</span></>} />
            </Link>
          </div>
        )}
      </Async>
    </>
  );
}
