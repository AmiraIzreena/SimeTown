'use client';

import { Text } from '@/components/ui/localized-text';

import { Copy, Plus, UserCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/field';
import { DataTable } from '@/components/ui/table';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useAction, useApi, usePaged } from '@/lib/hooks';
import type { Me } from '@/lib/types';
import { ADMINS, formatPhone, ROLE_LABELS, type Role } from '@/shared/domain';

type Tab = 'verify' | 'accounts';
interface Resident {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  occupancy: string;
  /** The property-record reference staff check against. */
  unit_code: string;
  address: string;
  created_at: string;
}
interface Account {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  active: boolean;
  merchant_name: string | null;
  sponsor_name: string | null;
}
interface AccountRequest {
  id: string;
  kind: 'NEW_ADMIN' | 'PASSWORD_RESET';
  name: string;
  email: string;
  role: Role;
  requestedBy: string;
  mine: boolean;
  createdAt: string;
}
/** A link straight away, or a request that a second admin must approve first. */
type InviteResult = { inviteToken: string } | { requestId: string; pending: true };

export default function PeoplePage() {
  const me = useApi<Me>('/me');
  const isAdmin = me.data ? ADMINS.includes(me.data.role) : false;
  const [tab, setTab] = useState<Tab>('verify');
  return (
    <>
      <PageHeader title="People" description="Confirm residents’ homes and manage shop, sponsor and staff accounts." />
      <Tabs<Tab> label="People sections" value={tab} onChange={setTab} items={[{ key: 'verify', label: 'Confirm homes' }, ...(isAdmin ? [{ key: 'accounts' as const, label: 'Accounts' }] : [])]} />
      <TabPanel>{tab === 'accounts' && isAdmin ? <Accounts hq={me.data?.role === 'HQ_ADMIN'} meId={me.data?.id} /> : <VerifyResidents />}</TabPanel>
    </>
  );
}

function VerifyResidents() {
  const pending = usePaged<Resident>('/admin/residents?status=PENDING&limit=20');
  const decide = useAction((id: string, approve: boolean) => api.post(`/admin/residents/${id}/verify`, { approve }), { success: 'Saved. The resident has been told.', onSuccess: () => void pending.reload() });
  if (pending.error) return <ErrorState error={pending.error} onRetry={() => void pending.reload()} />;
  if (pending.isLoading) return <SkeletonList rows={3} />;
  if (pending.items.length === 0) {
    return (
      <EmptyState icon={UserCheck} title="Nobody is waiting"><Text>New residents appear here until their home is checked against the property record.</Text></EmptyState>
    );
  }
  return (
    <ul className="space-y-3">
      {pending.items.map((r) => (
        <li key={r.id}>
          <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-ink-900">{r.full_name}</p>
              <p className="text-sm text-ink-600">
                <Text>{r.occupancy === 'OWNER' ? 'Owner' : 'Tenant'}</Text> · {r.address}
              </p>
              <p className="text-sm text-ink-500"><Text>Property record </Text><strong className="font-semibold text-ink-700"><Text>{r.unit_code}</Text></strong> · {r.email}
                {r.phone ? ` · ${formatPhone(r.phone)}` : ''}<Text> · registered </Text><Text>{timeAgo(r.created_at)}</Text>
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => decide.run(r.id, true)} disabled={decide.pending}><Text>Confirm</Text></Button>
              <Button size="sm" variant="secondary" onClick={() => decide.run(r.id, false)} disabled={decide.pending}><Text>Reject</Text></Button>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function Accounts({ hq, meId }: { hq: boolean; meId?: string }) {
  const toast = useToast();
  const accounts = useApi<Account[]>('/admin/accounts');
  const requests = useApi<AccountRequest[]>('/admin/account-requests');
  const merchants = useApi<{ id: string; name: string }[]>('/admin/merchants');
  const sponsors = useApi<{ id: string; name: string }[]>('/sponsors');
  const [creating, setCreating] = useState(false);
  const [role, setRole] = useState<Role>('TOWNSHIP_STAFF');
  const [link, setLink] = useState<string | null>(null);

  const showLink = (token: string) => setLink(`${window.location.origin}/invite#${token}`);
  const handleInvite = (r: InviteResult) => {
    if ('inviteToken' in r) showLink(r.inviteToken);
    else toast.show('Sent for approval. Another admin must approve it before a link is issued.');
    void requests.mutate();
  };
  const create = useAction((body: Record<string, unknown>) => api.post<InviteResult>('/admin/accounts', body), {
    onSuccess: (r) => {
      setCreating(false);
      handleInvite(r);
      void accounts.mutate();
    },
  });
  const reinvite = useAction((id: string) => api.post<InviteResult>(`/admin/accounts/${id}/invite`), { onSuccess: handleInvite });
  const decide = useAction((id: string, approve: boolean) => api.post<{ inviteToken?: string }>(`/admin/account-requests/${id}/decision`, { approve }), {
    onSuccess: (r) => {
      if (r.inviteToken) showLink(r.inviteToken);
      else toast.show('Request rejected.');
      void requests.mutate();
      void accounts.mutate();
    },
  });
  const addSponsor = useAction((name: string) => api.post('/sponsors', { name }), { success: 'Sponsor added.', onSuccess: () => void sponsors.mutate() });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    void create.run({ email: form.email, fullName: form.fullName, role, merchantId: form.merchantId || undefined, sponsorId: form.sponsorId || undefined });
  };
  // Sponsor logins and admin accounts are HQ's to create; admin accounts also need a second HQ admin.
  const roles: Role[] = hq ? ['TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN', 'HQ_ADMIN', 'MERCHANT', 'SPONSOR'] : ['TOWNSHIP_STAFF', 'MERCHANT'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        <form method="post"
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            void addSponsor.run(String(new FormData(form).get('name'))).then((ok) => ok && form.reset());
          }}
        >
          <Input label="Add a sponsor organisation" name="name" maxLength={120} required className="w-64" />
          <Button type="submit" variant="secondary" pending={addSponsor.pending}><Text>Add</Text></Button>
        </form>
        <Button onClick={() => setCreating(true)} className="self-end">
          <Plus className="size-4" aria-hidden /><Text>New account</Text></Button>
      </div>
      {requests.data && requests.data.length > 0 && (
        <Card className="space-y-3 p-5">
          <div>
            <h2 className="text-base font-semibold text-ink-900"><Text>Waiting for a second admin</Text></h2>
            <p className="text-sm text-ink-600"><Text>New admin accounts, and new passwords for accounts already in use, need two people. Only the approver gets the link.</Text></p>
          </div>
          <ul className="divide-y divide-ink-100">
            {requests.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-ink-900">
                    <Text>{r.kind === 'NEW_ADMIN' ? 'New account' : 'New set-password link'}</Text>: {r.name} · <Text>{ROLE_LABELS[r.role]}</Text>
                  </p>
                  <p className="text-sm text-ink-500">
                    {r.email}<Text> · asked by </Text><Text>{r.requestedBy}</Text> <Text>{timeAgo(r.createdAt)}</Text>
                  </p>
                </div>
                {r.mine ? (
                  <Badge tone="warning"><Text>Waiting for another admin</Text></Badge>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => decide.run(r.id, true)} disabled={decide.pending}><Text>Approve</Text></Button>
                    <Button size="sm" variant="secondary" onClick={() => decide.run(r.id, false)} disabled={decide.pending}><Text>Reject</Text></Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Async state={accounts}>
        {(list) => (
          <DataTable
            caption="Accounts"
            rows={list}
            keyOf={(a) => a.id}
            columns={[
              { header: 'Name', cell: (a) => <span className="font-medium text-ink-900">{a.full_name}</span> },
              { header: 'Email', cell: (a) => a.email },
              { header: 'Role', cell: (a) => `${ROLE_LABELS[a.role]}${a.merchant_name ? ` · ${a.merchant_name}` : ''}${a.sponsor_name ? ` · ${a.sponsor_name}` : ''}` },
              { header: 'Sign-in', cell: (a) => <Badge tone={a.active ? 'success' : 'warning'}><Text>{a.active ? 'Active' : 'Invited'}</Text></Badge> },
              {
                header: '',
                align: 'right',
                cell: (a) =>
                  a.id === meId ? null : (
                    <Button size="sm" variant="ghost" onClick={() => reinvite.run(a.id)} disabled={reinvite.pending}><Text>New set-password link</Text></Button>
                  ),
              },
            ]}
          />
        )}
      </Async>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New account"
        description="The person sets their own password from a one-time link."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}><Text>Cancel</Text></Button>
            <Button type="submit" form="create-account" pending={create.pending}><Text>Create and get link</Text></Button>
          </>
        }
      >
        <form method="post" id="create-account" onSubmit={submit} className="space-y-4" noValidate>
          <Select label="Role" value={role} onChange={(event) => setRole(event.target.value as Role)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                <Text>{ROLE_LABELS[r]}</Text>
              </option>
            ))}
          </Select>
          {role === 'MERCHANT' && (
            <Select label="Shop" name="merchantId" required defaultValue="" error={create.fields.merchantId}>
              <option value="" disabled><Text>Choose a shop</Text></option>
              {merchants.data?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}
          {role === 'SPONSOR' && (
            <Select label="Sponsor" name="sponsorId" required defaultValue="" error={create.fields.sponsorId}>
              <option value="" disabled><Text>Choose a sponsor</Text></option>
              {sponsors.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
          <Input label="Full name" name="fullName" required error={create.fields.fullName} />
          <Input label="Email" name="email" type="email" required error={create.fields.email} />
        </form>
      </Modal>

      <Modal open={link !== null} onClose={() => setLink(null)} title="Set-password link" description="Send this to the person yourself. It works once and expires in 7 days. It will not be shown again.">
        <div className="space-y-4">
          <p className="break-all rounded-md border border-ink-200 bg-ink-25 p-3 font-mono text-sm text-ink-800"><Text>{link}</Text></p>
          <Button
            onClick={async () => {
              await navigator.clipboard.writeText(link!);
              toast.show('Link copied.');
            }}
          >
            <Copy className="size-4" aria-hidden /><Text>Copy link</Text></Button>
        </div>
      </Modal>
    </div>
  );
}

