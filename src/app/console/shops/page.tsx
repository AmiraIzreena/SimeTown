'use client';

import { Building2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, PageHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState } from '@/components/ui/feedback';
import { Input } from '@/components/ui/field';
import { DataTable } from '@/components/ui/table';
import { api } from '@/lib/api';
import { parseRM } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { formatRM } from '@/shared/domain';

interface Shop {
  id: string;
  name: string;
  registration_no: string;
  category: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  pool_sen: number;
  owed_sen: number;
}
const STATUS = { PENDING: ['Waiting for approval', 'warning'], ACTIVE: ['Active', 'success'], SUSPENDED: ['Suspended', 'danger'] } as const;

export default function ShopsPage() {
  const shops = useApi<Shop[]>('/admin/merchants');
  const [deposit, setDeposit] = useState<Shop | null>(null);
  const [amount, setAmount] = useState('');
  const reload = () => void shops.mutate();

  const setStatus = useAction((id: string, status: 'ACTIVE' | 'SUSPENDED') => api.post(`/admin/merchants/${id}/status`, { status }), { success: 'Saved.', onSuccess: reload });
  const record = useAction((id: string, bankRef: string) => api.post(`/admin/merchants/${id}/deposits`, { amountSen: parseRM(amount), bankRef }), {
    success: 'Deposit recorded. The shop can give points from its pool.',
    onSuccess: () => {
      setDeposit(null);
      setAmount('');
      reload();
    },
  });

  return (
    <>
      <PageHeader title="Shops" description="Approve shops after checking their business registration, and record the money they pay into their reward pools." />
      <Async state={shops}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState icon={Building2} title="No shops yet">
              Shops apply from the “Join as a shop” page.
            </EmptyState>
          ) : (
            <DataTable
              caption="Shops"
              rows={list}
              keyOf={(s) => s.id}
              columns={[
                { header: 'Shop', cell: (s) => <span className="font-medium text-ink-900">{s.name}</span> },
                { header: 'Registration', desktopOnly: true, cell: (s) => s.registration_no },
                { header: 'Type', desktopOnly: true, cell: (s) => s.category },
                { header: 'Status', cell: (s) => <Badge tone={STATUS[s.status][1]}>{STATUS[s.status][0]}</Badge> },
                { header: 'Reward pool', align: 'right', cell: (s) => formatRM(s.pool_sen) },
                { header: 'Owed this week', align: 'right', cell: (s) => formatRM(s.owed_sen) },
                {
                  header: '',
                  align: 'right',
                  cell: (s) => (
                    <span className="inline-flex flex-wrap justify-end gap-1">
                      {s.status === 'ACTIVE' && (
                        <Button size="sm" variant="secondary" onClick={() => setDeposit(s)}>
                          Record deposit
                        </Button>
                      )}
                      {s.status !== 'ACTIVE' && (
                        <Button size="sm" onClick={() => setStatus.run(s.id, 'ACTIVE')} disabled={setStatus.pending}>
                          {s.status === 'PENDING' ? 'Approve' : 'Restore'}
                        </Button>
                      )}
                      {s.status === 'ACTIVE' && (
                        <Button size="sm" variant="ghost" onClick={() => setStatus.run(s.id, 'SUSPENDED')} disabled={setStatus.pending}>
                          Suspend
                        </Button>
                      )}
                    </span>
                  ),
                },
              ]}
            />
          )
        }
      </Async>

      <Modal
        open={deposit !== null}
        onClose={() => setDeposit(null)}
        title="Record a deposit"
        description={deposit ? `${deposit.name} · pool now ${formatRM(deposit.pool_sen)}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeposit(null)}>
              Cancel
            </Button>
            <Button type="submit" form="record-deposit" pending={record.pending} disabled={!parseRM(amount)}>
              Record deposit
            </Button>
          </>
        }
      >
        <form method="post"
          id="record-deposit"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void record.run(deposit!.id, String(new FormData(event.currentTarget).get('bankRef')));
          }}
        >
          <p className="text-[15px] text-ink-700">Record this only after the transfer shows in the trust account. The money goes into the float and can only be used for this shop’s points and their service fee.</p>
          <Input label="Amount received (RM)" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required error={record.fields.amountSen} />
          <Input label="Bank reference" name="bankRef" maxLength={60} required error={record.fields.bankRef} hint="Each reference can be used once." />
        </form>
      </Modal>
    </>
  );
}
