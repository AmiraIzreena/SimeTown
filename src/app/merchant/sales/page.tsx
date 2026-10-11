'use client';

import { Text } from '@/components/ui/localized-text';

import { Receipt } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, PageHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { DataTable } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useAction, usePaged } from '@/lib/hooks';
import type { SaleView } from '@/lib/types';
import { formatPoints, formatRM } from '@/shared/domain';

const STATUS = { PENDING: ['Waiting', 'gold'], COMPLETED: ['Completed', 'success'], DECLINED: ['Declined', 'neutral'], EXPIRED: ['Expired', 'neutral'], REFUNDED: ['Refunded', 'warning'] } as const;

interface Refund {
  pointsReturned: number;
  pointsTakenBack: number;
  cashRefundSen: number;
}

export default function SalesPage() {
  const sales = usePaged<SaleView>('/merchant/sales?limit=20');
  const [target, setTarget] = useState<SaleView | null>(null);
  const refund = useAction((id: string) => api.post<Refund>(`/merchant/sales/${id}/refund`), {
    onSuccess: () => {
      setTarget(null);
      void sales.reload();
    },
    success: (r) => `Refunded. Give back ${formatRM(r.cashRefundSen)} in cash.${r.pointsReturned ? ` ${formatPoints(r.pointsReturned)} points went back to the customer.` : ''}`,
  });

  return (
    <>
      <PageHeader title="Sales" description="Every sale recorded through KITA+, newest first." />
      {sales.error ? (
        <ErrorState error={sales.error} onRetry={() => void sales.reload()} />
      ) : sales.isLoading ? (
        <SkeletonList rows={4} />
      ) : sales.items.length === 0 ? (
        <EmptyState icon={Receipt} title="No sales yet" action={<Button href="/merchant"><Text>Go to the counter</Text></Button>}><Text>Sales you record at the counter appear here.</Text></EmptyState>
      ) : (
        <DataTable
          caption="Sales"
          rows={sales.items}
          keyOf={(s) => s.id}
          columns={[
            { header: 'When', cell: (s) => formatDateTime(s.createdAt) },
            { header: 'Customer', cell: (s) => s.memberName },
            { header: 'Bill', align: 'right', cell: (s) => formatRM(s.billSen) },
            { header: 'Points accepted', align: 'right', cell: (s) => formatPoints(s.redeemPoints) },
            { header: 'Points given', align: 'right', cell: (s) => formatPoints(s.pointsEarned) },
            { header: 'Service fee', align: 'right', desktopOnly: true, cell: (s) => formatRM(s.feeSen) },
            { header: 'Status', cell: (s) => <Badge tone={STATUS[s.status][1]}><Text>{STATUS[s.status][0]}</Text></Badge> },
            {
              header: '',
              align: 'right',
              cell: (s) =>
                s.status === 'COMPLETED' && (
                  <Button size="sm" variant="ghost" onClick={() => setTarget(s)}><Text>Refund</Text></Button>
                ),
            },
          ]}
        />
      )}
      {sales.hasMore && (
        <div className="mt-5 text-center">
          <Button variant="secondary" onClick={() => void sales.loadMore()} pending={sales.loadingMore}><Text>Show more</Text></Button>
        </div>
      )}

      <ConfirmDialog open={target !== null} onClose={() => setTarget(null)} onConfirm={() => target && void refund.run(target.id)} title="Refund this sale?" confirmLabel="Refund" destructive pending={refund.pending}>
        {target && (
          <>
            <p>
              <Text>{target.memberName}</Text> · <Text>{formatRM(target.billSen)}</Text><Text> on </Text><Text>{formatDateTime(target.createdAt)}</Text>
            </p>
            <ul className="list-disc space-y-1 pl-5">
              {target.pointsEarned > 0 && <li><Text>The </Text><Text>{formatPoints(target.pointsEarned)}</Text><Text> points earned on this sale are taken back and returned to your pool.</Text></li>}
              {target.redeemPoints > 0 && <li><Text>The </Text><Text>{formatPoints(target.redeemPoints)}</Text><Text> points the customer used are returned to them as points, not cash.</Text></li>}
              <li><Text>You will be told how much cash to give back.</Text></li>
            </ul>
          </>
        )}
      </ConfirmDialog>
    </>
  );
}
