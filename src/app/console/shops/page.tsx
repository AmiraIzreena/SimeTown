'use client';

import { Text } from '@/components/ui/localized-text';

import { Building2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, PageHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/field';
import { DataTable } from '@/components/ui/table';
import { api } from '@/lib/api';
import { parseRM } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { formatRM, MERCHANT_KINDS, MERCHANT_KIND_LABELS, merchantKind, type MerchantKind } from '@/shared/domain';

interface Shop {
  id: string;
  name: string;
  registration_no: string;
  category: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  pool_sen: number;
  owed_sen: number;
  offers_retail: boolean;
  offers_services: boolean;
}
const STATUS = { PENDING: ['Waiting for approval', 'warning'], ACTIVE: ['Active', 'success'], SUSPENDED: ['Suspended', 'danger'] } as const;

export default function ShopsPage() {
  const shops = useApi<Shop[]>('/admin/merchants');
  const [deposit, setDeposit] = useState<Shop | null>(null);
  const [amount, setAmount] = useState('');
  const reload = () => void shops.mutate();

  const setKind = useAction((id: string, kind: MerchantKind) => api.post(`/admin/merchants/${id}/kind`, { kind }), { success: 'Saved.', onSuccess: reload });
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
      <PageHeader title="Shops" description="Approve shops and home service companies after checking their business registration, choose what each offers, and record the money shops pay into their reward pools." />
      <Async state={shops}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState icon={Building2} title="No shops yet"><Text>Shops apply from the “Join as a shop” page.</Text></EmptyState>
          ) : (
            <DataTable
              caption="Shops"
              rows={list}
              keyOf={(s) => s.id}
              columns={[
                { header: 'Shop', cell: (s) => <span className="font-medium text-ink-900">{s.name}</span> },
                { header: 'Registration', desktopOnly: true, cell: (s) => s.registration_no },
                { header: 'Type', desktopOnly: true, cell: (s) => s.category },
                {
                  header: 'Offers',
                  cell: (s) => (
                    <Select
                      label="Offers"
                      labelClassName="sr-only"
                      value={merchantKind({ offersRetail: s.offers_retail, offersServices: s.offers_services })}
                      onChange={(event) => void setKind.run(s.id, event.target.value as MerchantKind)}
                      disabled={setKind.pending}
                    >
                      {MERCHANT_KINDS.map((k) => <option key={k} value={k}><Text>{MERCHANT_KIND_LABELS[k]}</Text></option>)}
                    </Select>
                  ),
                },
                { header: 'Status', cell: (s) => <Badge tone={STATUS[s.status][1]}><Text>{STATUS[s.status][0]}</Text></Badge> },
                { header: 'Reward pool', align: 'right', cell: (s) => formatRM(s.pool_sen) },
                { header: 'Owed this week', align: 'right', cell: (s) => formatRM(s.owed_sen) },
                {
                  header: '',
                  align: 'right',
                  cell: (s) => (
                    <span className="inline-flex flex-wrap justify-end gap-1">
                      {s.status === 'ACTIVE' && (
                        <Button size="sm" variant="secondary" onClick={() => setDeposit(s)}><Text>Record deposit</Text></Button>
                      )}
                      {s.status !== 'ACTIVE' && (
                        <Button size="sm" onClick={() => setStatus.run(s.id, 'ACTIVE')} disabled={setStatus.pending}>
                          <Text>{s.status === 'PENDING' ? 'Approve' : 'Restore'}</Text>
                        </Button>
                      )}
                      {s.status === 'ACTIVE' && (
                        <Button size="sm" variant="ghost" onClick={() => setStatus.run(s.id, 'SUSPENDED')} disabled={setStatus.pending}><Text>Suspend</Text></Button>
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
            <Button variant="secondary" onClick={() => setDeposit(null)}><Text>Cancel</Text></Button>
            <Button type="submit" form="record-deposit" pending={record.pending} disabled={!parseRM(amount)}><Text>Record deposit</Text></Button>
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
          <p className="text-[15px] text-ink-700"><Text>Record this only after the transfer shows in the trust account. The money goes into the float and can only be used for this shop’s points and their service fee.</Text></p>
          <Input label="Amount received (RM)" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required error={record.fields.amountSen} />
          <Input label="Bank reference" name="bankRef" maxLength={60} required error={record.fields.bankRef} hint="Each reference can be used once." />
        </form>
      </Modal>
    </>
  );
}
