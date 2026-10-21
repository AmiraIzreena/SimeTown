'use client';

import { Text } from '@/components/ui/localized-text';

import { ScrollText } from 'lucide-react';
import { PageHeader } from '@/components/ui/card';
import { CountUp } from '@/components/ui/count-up';
import { Async, EmptyState } from '@/components/ui/feedback';
import { DataTable } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { formatPoints, formatRM } from '@/shared/domain';
import { DEMO_MODE } from '@/lib/demo';

interface Statements {
  dueThisWeekSen: number;
  successFeesDueSen: number;
  statements: { id: string; period_start: string; period_end: string; amount_sen: number; paid_at: string; sales: number; bill_sen: number; points_given: number; fees_sen: number; offer_discounts_sen: number; success_fees_sen: number }[];
}

export default function StatementsPage() {
  const data = useApi<Statements>('/merchant/statements');
  return (
    <>
      <PageHeader title="Statements" description="Each week the reward float pays you the full value of the points you accepted. There is no fee for accepting points." />
      <Async state={data}>
        {(d) => (
          <div className="space-y-6">
            {/* The same brand surface as the Home points card and the console Insights hero. */}
            <section className="brand-hero relative animate-rise overflow-hidden rounded-xl p-6 text-white shadow-sm sm:p-7">
              <p className="text-sm font-medium text-brand-100"><Text>Due to you this week</Text></p>
              <p className="mt-2 font-display text-5xl font-bold leading-none tracking-tight tabular-nums">
                <CountUp value={d.dueThisWeekSen} format={formatRM} duration={1400} />
              </p>
              <p className="mt-3 max-w-2xl text-[15px] text-brand-100"><Text>Paid at the next weekly settlement, at 100% of value</Text><Text>{d.successFeesDueSen ? `, less ${formatRM(d.successFeesDueSen)} of Shop Offer success fees still waiting` : ''}</Text>.</p>
            </section>
            {d.statements.length === 0 ? (
              <EmptyState icon={ScrollText} title="No statements yet"><Text>Your first statement appears after the first weekly settlement that includes points you accepted.</Text></EmptyState>
            ) : (
              <DataTable
                caption="Weekly statements"
                rows={d.statements}
                keyOf={(s) => s.id}
                columns={[
                  { header: 'Period', cell: (s) => `${formatDate(s.period_start)} – ${formatDate(s.period_end)}` },
                  { header: 'Sales', align: 'right', cell: (s) => s.sales },
                  { header: 'Sales value', align: 'right', cell: (s) => formatRM(s.bill_sen) },
                  { header: 'Points you gave', align: 'right', desktopOnly: true, cell: (s) => formatPoints(s.points_given) },
                  { header: 'Service fee', align: 'right', desktopOnly: true, cell: (s) => formatRM(s.fees_sen) },
                  { header: 'Shop Offer discounts', align: 'right', desktopOnly: true, cell: (s) => formatRM(s.offer_discounts_sen) },
                  { header: 'Success fees', align: 'right', desktopOnly: true, cell: (s) => formatRM(s.success_fees_sen) },
                  { header: 'Paid to you', align: 'right', cell: (s) => <strong className="text-success-700"><Text>{formatRM(s.amount_sen)}</Text></strong> },
                  { header: 'Paid on', cell: (s) => formatDate(s.paid_at) },
                ]}
              />
            )}
            {DEMO_MODE && <p className="text-sm text-ink-500"><Text>Demo environment: payments are recorded, not sent.</Text></p>}
          </div>
        )}
      </Async>
    </>
  );
}
