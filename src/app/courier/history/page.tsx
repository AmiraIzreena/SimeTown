'use client';

import { Text } from '@/components/ui/localized-text';

import { History } from 'lucide-react';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { Async, EmptyState, SkeletonList } from '@/components/ui/feedback';
import { formatDateTime } from '@/lib/format';
import type { CSSProperties } from 'react';
import { useApi } from '@/lib/hooks';
import { PARCEL_STATE_LABELS, type ParcelState } from '@/shared/lockers';

interface Delivery {
  id: string;
  tracking_no: string;
  size: string;
  state: ParcelState;
  registered_at: string;
  failure_reason: string | null;
  station: string;
  compartment: string | null;
}

const TONE: Partial<Record<ParcelState, 'success' | 'danger' | 'warning' | 'brand'>> = {
  READY_FOR_COLLECTION: 'success', COLLECTED: 'success', DELIVERY_FAILED: 'danger', RETURNED: 'warning', RETURN_PENDING: 'warning', EXCEPTION: 'danger',
};

export default function CourierHistoryPage() {
  const list = useApi<Delivery[]>('/courier/parcels');
  return (
    <>
      <PageHeader title="My deliveries" description="Your last 50 locker deliveries, including the ones that could not be made." />
      <Async state={list} skeleton={<SkeletonList rows={4} />}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState icon={History} title="No deliveries yet" />
          ) : (
            <Card>
              <ul className="divide-y divide-ink-100">
                {rows.map((d, i) => (
                  <li key={d.id} style={{ '--i': Math.min(i, 12) } as CSSProperties} className="value-line flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-ink-900">{d.tracking_no} <span className="font-normal text-ink-500">· {d.station}{d.compartment && ` · ${d.compartment}`}</span></p>
                      <p className="text-sm text-ink-500"><Text>{formatDateTime(d.registered_at)}</Text>{d.failure_reason && <> · <Text>{d.failure_reason}</Text></>}</p>
                    </div>
                    <Badge tone={TONE[d.state] ?? 'brand'}><Text>{PARCEL_STATE_LABELS[d.state]}</Text></Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )
        }
      </Async>
    </>
  );
}
