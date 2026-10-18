'use client';

import { Text } from '@/components/ui/localized-text';

import { BadgeCheck, Copy, PauseCircle, PlayCircle, Plus, UserX, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { Async, EmptyState, SkeletonList } from '@/components/ui/feedback';
import { Input } from '@/components/ui/field';
import { api } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

interface Team {
  company: { name: string; auth_method: 'COMPANY_MANAGED' | 'FEDERATED' | 'MANUAL'; provider_mode: string; agreement_until: string | null; stations: string[] };
  couriers: {
    user_id: string; full_name: string; email: string; employee_ref: string | null; status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'PENDING'; managed_by: string;
    last_verified_at: string | null; needs_reconfirming: boolean; last_sign_in: string | null; deliveries_30d: number; refused_scans_30d: number;
  }[];
  reconfirmDays: number;
}

const STATUS = {
  ACTIVE: { label: 'Active', tone: 'success' as const },
  SUSPENDED: { label: 'Suspended', tone: 'warning' as const },
  REVOKED: { label: 'Removed', tone: 'neutral' as const },
  PENDING: { label: 'Waiting', tone: 'gold' as const },
};

/**
 * A courier company's own managers look after its couriers here: the township
 * approved the company once, and never approves couriers one by one.
 */
export default function TeamPage() {
  const team = useApi<Team>('/courier/team');
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Team['couriers'][number] | null>(null);
  const status = useAction((userId: string, s: 'ACTIVE' | 'SUSPENDED' | 'REVOKED') => api.post(`/courier/team/${userId}/status`, { status: s }), {
    success: 'Saved. A suspension takes effect at once.',
    onSuccess: () => {
      setRemoving(null);
      void team.mutate();
    },
  });
  const reconfirm = useAction((userId: string) => api.post(`/courier/team/${userId}/reconfirm`), { success: 'Reconfirmed.', onSuccess: () => void team.mutate() });

  return (
    <>
      <PageHeader title="Your couriers" description="Your company was approved by the township once. You add your own couriers, suspend them when needed and reconfirm them from time to time; the township office does not approve them one by one." />
      <Async state={team} skeleton={<SkeletonList rows={3} />}>
        {(t) => (
          <div className="space-y-5">
            <Card className="grid gap-3 p-5 sm:grid-cols-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Company</Text></p>
                <p className="font-semibold text-ink-900">{t.company.name}</p>
                <p className="text-sm text-ink-600"><Text>{t.company.auth_method === 'FEDERATED' ? 'Couriers sign in with your company’s own sign-in' : 'You add your couriers here'}</Text></p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Stations</Text></p>
                <p className="text-[15px] text-ink-800">{t.company.stations.length ? t.company.stations.join(', ') : <Text>None yet</Text>}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Agreement</Text></p>
                <p className="text-[15px] text-ink-800">{t.company.agreement_until ? <Text>{`Until ${formatDate(t.company.agreement_until)}`}</Text> : <Text>No end date</Text>}</p>
              </div>
            </Card>
            <Card>
              <CardHeader
                title="Couriers"
                description={`Reconfirm each courier at least every ${t.reconfirmDays} days, or their access pauses until you do.`}
                action={t.company.auth_method !== 'FEDERATED' ? <Button size="sm" onClick={() => setInviting(true)}><Plus className="size-4" aria-hidden /><Text>Add a courier</Text></Button> : undefined}
              />
              {t.couriers.length === 0 ? (
                <div className="p-5"><EmptyState icon={Users} title="No couriers yet"><Text>{t.company.auth_method === 'FEDERATED' ? 'Couriers appear here after their first sign-in with your company’s sign-in.' : 'Add your first courier.'}</Text></EmptyState></div>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {t.couriers.map((c) => (
                    <li key={c.user_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink-900">
                          {c.full_name} {c.employee_ref && <span className="font-normal text-ink-500">· {c.employee_ref}</span>}
                          <Badge tone={STATUS[c.status].tone}><Text>{STATUS[c.status].label}</Text></Badge>
                          {c.status === 'ACTIVE' && c.needs_reconfirming && c.managed_by === 'COMPANY' && <Badge tone="gold"><Text>Reconfirm soon</Text></Badge>}
                        </p>
                        <p className="text-sm text-ink-500">
                          {c.email} · <Text>{c.last_sign_in ? `signed in ${timeAgo(c.last_sign_in)}` : 'never signed in'}</Text> · <Text>{`${c.deliveries_30d} deliveries in 30 days`}</Text>
                          {c.refused_scans_30d > 0 && <> · <span className="text-accent-700"><Text>{`${c.refused_scans_30d} refused scans`}</Text></span></>}
                        </p>
                      </div>
                      {c.status !== 'REVOKED' && (
                        <div className="flex flex-wrap gap-2">
                          {c.status === 'ACTIVE' && c.managed_by === 'COMPANY' && <Button size="sm" variant="ghost" onClick={() => void reconfirm.run(c.user_id)} disabled={reconfirm.pending}><BadgeCheck className="size-4" aria-hidden /><Text>Reconfirm</Text></Button>}
                          {c.status === 'ACTIVE' ? (
                            <Button size="sm" variant="secondary" onClick={() => void status.run(c.user_id, 'SUSPENDED')} disabled={status.pending}><PauseCircle className="size-4" aria-hidden /><Text>Suspend</Text></Button>
                          ) : (
                            <Button size="sm" variant="secondary" onClick={() => void status.run(c.user_id, 'ACTIVE')} disabled={status.pending}><PlayCircle className="size-4" aria-hidden /><Text>Reactivate</Text></Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => setRemoving(c)}><UserX className="size-4" aria-hidden /><Text>Remove</Text></Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </Async>
      <InviteCourier open={inviting} onClose={() => setInviting(false)} onInvited={(token) => { setLink(`${window.location.origin}/invite#${token}`); void team.mutate(); }} />
      <Modal open={link !== null} onClose={() => setLink(null)} title="Send this link to the courier" description="It works once, for 7 days. The courier sets their own password with it.">
        <div className="space-y-3">
          <p className="break-all rounded-md bg-ink-50 p-3 font-mono text-sm text-ink-900">{link}</p>
          <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(link ?? '')}><Copy className="size-4" aria-hidden /><Text>Copy</Text></Button>
        </div>
      </Modal>
      <ConfirmDialog open={removing !== null} onClose={() => setRemoving(null)} onConfirm={() => removing && void status.run(removing.user_id, 'REVOKED')} title="Remove this courier?" confirmLabel="Remove" destructive pending={status.pending}>
        <p className="text-[15px] text-ink-700"><Text>They lose access to the lockers at once and for good. To bring them back, add them again.</Text></p>
      </ConfirmDialog>
    </>
  );
}

function InviteCourier({ open, onClose, onInvited }: { open: boolean; onClose: () => void; onInvited: (token: string) => void }) {
  const invite = useAction((body: Record<string, unknown>) => api.post<{ inviteToken: string }>('/courier/team', body), {
    onSuccess: (r) => {
      onClose();
      onInvited(r.inviteToken);
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const phone = String(f.get('phone') ?? '').trim();
    void invite.run({ fullName: String(f.get('fullName') ?? '').trim(), email: String(f.get('email') ?? '').trim(), employeeRef: String(f.get('employeeRef') ?? '').trim(), phone: phone || null });
  };
  return (
    <Modal open={open} onClose={onClose} title="Add a courier" footer={<><Button variant="secondary" onClick={onClose}><Text>Cancel</Text></Button><Button type="submit" form="invite-courier" pending={invite.pending}><Text>Add</Text></Button></>}>
      <form method="post" id="invite-courier" onSubmit={submit} className="grid gap-4" noValidate>
        <Input label="Full name" name="fullName" maxLength={120} required error={invite.fields.fullName} />
        <Input label="Work email" name="email" type="email" maxLength={254} required error={invite.fields.email} />
        <Input label="Staff number" name="employeeRef" maxLength={40} required hint="Your company’s own number for this courier." error={invite.fields.employeeRef} />
        <Input label="Phone (optional)" name="phone" type="tel" maxLength={20} error={invite.fields.phone} />
      </form>
    </Modal>
  );
}
