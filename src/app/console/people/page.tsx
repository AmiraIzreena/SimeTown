'use client';

import { Text } from '@/components/ui/localized-text';
import { CopyButton } from '@/components/ui/copy-button';

import '../operations/parcel-workspace.css';
import { KeyRound, MapPin, Plus, Search, Send, UserCheck } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type CSSProperties, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { EmptyState, ErrorState, Skeleton, SkeletonList } from '@/components/ui/feedback';
import { Input, Select, Textarea } from '@/components/ui/field';
import { FilterBar, FilterChips, FilterMenu, FilterSummary, SearchField } from '@/components/ui/filter-bar';
import { SubNav } from '@/components/ui/sub-nav';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, timeAgo } from '@/lib/format';
import { useAction, useApi, usePaged } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import type { Me } from '@/lib/types';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { afterLeave } from '@/lib/motion';
import { useMinLoading } from '@/lib/use-min-loading';
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
  /** Confirmed and rejected lists: when and by whom; rejected only: the reason given, if any. */
  decided_at: string | null;
  decided_by: string | null;
  reason: string | null;
}
interface Account {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  active: boolean;
  merchant_name: string | null;
  sponsor_name: string | null;
  created_at: string;
}
/** Role chips on the Accounts list: staff and admins together, then each outside role. */
type RoleGroup = 'ALL' | 'STAFF' | 'MERCHANT' | 'COURIER' | 'GUARD' | 'SPONSOR';
const ROLE_GROUPS: Record<Exclude<RoleGroup, 'ALL'>, { label: string; roles: Role[] }> = {
  STAFF: { label: 'Staff & admins', roles: ['TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN', 'HQ_ADMIN'] },
  MERCHANT: { label: 'Shops', roles: ['MERCHANT'] },
  COURIER: { label: 'Couriers', roles: ['COURIER'] },
  GUARD: { label: 'Guards', roles: ['GUARD'] },
  SPONSOR: { label: 'Sponsors', roles: ['SPONSOR'] },
};
const inGroup = (a: Account, g: RoleGroup) => g === 'ALL' || ROLE_GROUPS[g].roles.includes(a.role);
type SignIn = '' | 'ACTIVE' | 'INVITED';
type AccountSort = 'ROLE' | 'NAME' | 'NEWEST';
/** Name and email, role, shop or sponsor, sign-in, added, action. */
const ACCOUNT_COLS = 'lg:grid-cols-[minmax(0,1.5fr)_9rem_minmax(0,1fr)_6.5rem_7rem_10rem]';
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
  // The Waiting / Confirmed / Rejected pills are read from the URL, which needs a Suspense boundary.
  return <Suspense fallback={<SkeletonList rows={3} />}><People /></Suspense>;
}

function People() {
  const me = useApi<Me>('/me');
  const isAdmin = me.data ? ADMINS.includes(me.data.role) : false;
  const [tab, setTab] = useState<Tab>('verify');
  return (
    <>
      <PageHeader title="People" description="Verify residents’ homes, and manage who else can sign in: your team and partners." />
      <Tabs<Tab> label="People sections" value={tab} onChange={setTab} items={[{ key: 'verify', label: 'Resident verification' }, ...(isAdmin ? [{ key: 'accounts' as const, label: 'Staff & partner access' }] : [])]} />
      <TabPanel>{tab === 'accounts' && isAdmin ? <Accounts hq={me.data?.role === 'HQ_ADMIN'} meId={me.data?.id} /> : <VerifyResidents />}</TabPanel>
    </>
  );
}

/** Waiting, confirmed and rejected residents, as pills inside the Resident verification tab (the URL keeps the choice). */
type View = 'waiting' | 'confirmed' | 'rejected';
const VIEWS: Record<View, { label: string; status: 'PENDING' | 'VERIFIED' | 'REJECTED'; count: 'pending' | 'verified' | 'rejected'; rail: string; when: string }> = {
  waiting: { label: 'Waiting', status: 'PENDING', count: 'pending', rail: 'bg-warning-600', when: 'Registered' },
  confirmed: { label: 'Confirmed', status: 'VERIFIED', count: 'verified', rail: 'bg-success-600', when: 'Confirmed' },
  rejected: { label: 'Rejected', status: 'REJECTED', count: 'rejected', rail: 'bg-accent-500', when: 'Rejected' },
};
const VIEW_KEYS = Object.keys(VIEWS) as View[];
interface Place { name: string; pending: number; verified: number; rejected: number }

/** Resident, address, property record, contact, when, then actions (waiting) or the decision (decided). */
const VERIFY_COLS = 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_8rem_minmax(0,1fr)_6.5rem_10.5rem]';
const DECIDED_COLS = 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_8rem_minmax(0,1fr)_minmax(0,1.3fr)]';

/** The message for an empty list, naming the place and search so staff know exactly what was checked. */
function emptyText(view: View, place: string, q: string): { title: string; body: string } {
  if (q) return { title: 'No residents match', body: place ? `Nobody in ${place} matches “${q}”. Try another name, unit or property record.` : `Nobody matches “${q}”. Try another name, unit or property record.` };
  if (view === 'waiting') return place ? { title: `Nobody is waiting in ${place}`, body: 'Every resident here has been reviewed. New registrations from this place will appear here.' } : { title: 'Nobody is waiting', body: 'New residents appear here until their home is checked against the property record.' };
  if (view === 'confirmed') return place ? { title: `No confirmed residents in ${place}`, body: 'Nobody living in this place has had their home confirmed yet.' } : { title: 'No confirmed residents yet', body: 'Residents appear here once their home is confirmed.' };
  return place ? { title: `No rejected residents in ${place}`, body: 'Nobody from this place has been rejected.' } : { title: 'No rejected residents', body: 'Residents appear here if their home could not be confirmed.' };
}

function VerifyResidents() {
  const params = useSearchParams();
  const view: View = VIEW_KEYS.find((v) => v === params.get('view')) ?? 'waiting';
  const v = VIEWS[view];
  const [q, setQ] = useState('');
  const search = useDebouncedValue(q.trim());
  const [place, setPlace] = useState('');

  const places = useApi<{ places: Place[] }>('/admin/residents/places');
  const query = new URLSearchParams({ status: v.status, limit: '20', ...(search ? { q: search } : {}), ...(place ? { precinct: place } : {}) }).toString();
  const path = `/admin/residents?${query}`;
  const list = usePaged<Resident>(path);
  const typing = q.trim() !== search;
  // Only the results show a skeleton, for at least 600ms per new search, place or pill.
  const loading = useMinLoading(`${path}${typing ? '~' : ''}`, list.isLoading || typing);

  const [acting, setActing] = useState<{ id: string; approve: boolean } | null>(null);
  const [rejecting, setRejecting] = useState<Resident | null>(null);
  const [reason, setReason] = useState('');
  // A decided row slides out of the queue first, then the list and counts refresh.
  const [leaving, setLeaving] = useState<string | null>(null);
  const leave = async (id: string) => {
    setLeaving(id);
    await afterLeave();
    await Promise.all([list.reload(), places.mutate()]);
    setLeaving(null);
  };
  const decide = useAction((id: string, approve: boolean, why?: string) => api.post(`/admin/residents/${id}/verify`, { approve, ...(why ? { reason: why } : {}) }), {
    success: 'Saved. The resident has been told.',
  });
  const confirm = async (id: string) => {
    setActing({ id, approve: true });
    const ok = await decide.run(id, true);
    setActing(null);
    if (ok !== undefined) await leave(id);
  };
  const reject = async () => {
    if (!rejecting) return;
    const id = rejecting.id;
    setActing({ id, approve: false });
    const ok = await decide.run(id, false, reason.trim() || undefined);
    setActing(null);
    if (ok !== undefined) {
      setRejecting(null);
      setReason('');
      await leave(id);
    }
  };

  const all = places.data?.places;
  const total = (key: 'pending' | 'verified' | 'rejected') =>
    all ? all.filter((p) => !place || p.name === place).reduce((sum, p) => sum + p[key], 0) : undefined;
  const filtered = Boolean(q || place);
  const empty = emptyText(view, place, search);
  const cols = view === 'waiting' ? VERIFY_COLS : DECIDED_COLS;

  return (
    <section className="space-y-4">
      <SubNav
        label="Residents"
        value={view}
        items={VIEW_KEYS.map((key) => ({ key, label: VIEWS[key].label, count: total(VIEWS[key].count), alert: key === 'waiting' }))}
        hrefOf={(key) => (key === 'waiting' ? '/console/people' : `/console/people?view=${key}`)}
      />
      <p className="text-sm text-ink-500">
        <Text>{view === 'waiting' ? 'Check each home against the property record before you confirm it. The resident is told either way. The longest waiting are first.' : view === 'confirmed' ? 'Residents whose home matched the property record. Latest first.' : 'Residents whose home could not be confirmed, with the reason given. Latest first.'}</Text>
      </p>

      <FilterBar
        search={<SearchField value={q} onChange={setQ} label="Search residents" placeholder="Name, email, unit or property record, e.g. Grace or RK-A-02-01" />}
        controls={
          <FilterMenu<string>
            label="Place"
            value={place}
            onChange={setPlace}
            options={[
              { value: '', label: 'All places' },
              ...(all ?? []).map((p) => ({ value: p.name, label: `${p.name} (${p[v.count]})`, raw: true })),
            ]}
          />
        }
        summary={
          loading ? undefined : (
            <FilterSummary
              shown={list.items.length}
              total={search ? undefined : total(v.count)}
              noun="residents"
              onClear={filtered ? () => { setQ(''); setPlace(''); } : undefined}
            />
          )
        }
      />

      {list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.reload()} />
      ) : loading ? (
        <VerifySkeleton cols={cols} decided={view !== 'waiting'} />
      ) : list.items.length === 0 ? (
        <EmptyState icon={search ? Search : place ? MapPin : UserCheck} title={empty.title}><Text>{empty.body}</Text></EmptyState>
      ) : (
        <Card className="content-in overflow-hidden">
          <VerifyHeader cols={cols} when={v.when} decided={view !== 'waiting'} />
          <ul className="ops-queue divide-y divide-ink-100/80">
            {list.items.map((r, n) => (
              <li key={r.id} style={{ '--i': Math.min(n, 12) } as CSSProperties} className={cn('ops-row relative', leaving === r.id && 'is-leaving')}>
                <span aria-hidden className={cn('ops-rail absolute inset-y-2 left-0 w-1 rounded-r-full', v.rail)} />
                <div className={cn('grid gap-1.5 py-3.5 pl-7 pr-5 text-sm lg:items-center lg:gap-4', cols)}>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold leading-snug text-ink-900">{r.full_name}</span>
                    <span className="mt-1 inline-block"><Badge tone={r.occupancy === 'OWNER' ? 'brand' : 'neutral'}><Text>{r.occupancy === 'OWNER' ? 'Owner' : 'Tenant'}</Text></Badge></span>
                  </span>
                  <span className="min-w-0 text-ink-700">
                    <span className="block lg:truncate" title={r.address}>{r.address}</span>
                  </span>
                  <span>
                    <span className="text-xs text-ink-500 lg:hidden"><Text>Property record </Text></span>
                    <span className="font-mono text-[13px] font-semibold text-ink-800">{r.unit_code}</span>
                  </span>
                  <span className="min-w-0 text-ink-600">
                    <span className="block truncate" title={r.email}>{r.email}</span>
                    {r.phone && <span className="block tabular-nums text-ink-500">{formatPhone(r.phone)}</span>}
                  </span>
                  {view === 'waiting' ? (
                    <>
                      <span className="text-ink-500">
                        <span className="lg:hidden"><Text>Registered </Text></span>
                        <span title={formatDateTime(r.created_at)}><Text>{timeAgo(r.created_at)}</Text></span>
                      </span>
                      <span className="mt-2 flex gap-2 lg:mt-0 lg:justify-end">
                        <Button size="sm" className="flex-1 lg:flex-none" onClick={() => void confirm(r.id)} disabled={decide.pending} pending={acting?.id === r.id && acting.approve}><Text>Confirm</Text></Button>
                        <Button size="sm" variant="secondary" className="flex-1 lg:flex-none" onClick={() => { setReason(''); setRejecting(r); }} disabled={decide.pending}><Text>Reject</Text></Button>
                      </span>
                    </>
                  ) : (
                    <span className="min-w-0 text-ink-600">
                      <span className="block">
                        <Text>{v.when}</Text>{r.decided_at && <> <span title={formatDateTime(r.decided_at)}><Text>{timeAgo(r.decided_at)}</Text></span></>}
                        {r.decided_by && <span className="text-ink-500"> · <Text>{`by ${r.decided_by}`}</Text></span>}
                      </span>
                      {view === 'rejected' && (
                        <span className="mt-0.5 block text-ink-500">
                          {r.reason ? <><Text>Reason: </Text><span className="text-ink-700">{r.reason}</span></> : <Text>No reason recorded</Text>}
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {list.hasMore && (
            <div className="flex justify-center border-t border-ink-100/80 bg-ink-25/60 px-5 py-3 sm:px-6">
              <Button size="sm" variant="secondary" onClick={() => void list.loadMore()} pending={list.loadingMore}><Text>Show more</Text></Button>
            </div>
          )}
        </Card>
      )}

      <Modal
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title="Reject this home?"
        description={rejecting ? `${rejecting.full_name} · ${rejecting.unit_code}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)}><Text>Cancel</Text></Button>
            <Button variant="danger" type="submit" form="reject-resident" pending={acting?.approve === false}><Text>Reject home</Text></Button>
          </>
        }
      >
        <form id="reject-resident" method="post" className="space-y-4" onSubmit={(event) => { event.preventDefault(); void reject(); }}>
          <p className="text-[15px] text-ink-700"><Text>The resident cannot earn or spend until their home is confirmed. They are told straight away and asked to contact the township office.</Text></p>
          <Textarea label="Reason (optional)" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} rows={3} hint="Shown to the resident, for example: the property record lists a different owner." error={decide.fields.reason} />
        </form>
      </Modal>
    </section>
  );
}

function VerifyHeader({ cols, when, decided }: { cols: string; when: string; decided: boolean }) {
  return (
    <div aria-hidden className={cn('hidden gap-4 border-b border-ink-100/80 bg-ink-25/70 py-2 pl-7 pr-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 lg:grid', cols)}>
      <span><Text>Resident</Text></span><span><Text>Address</Text></span><span><Text>Property record</Text></span><span><Text>Contact</Text></span>
      {decided ? <span><Text>Decision</Text></span> : <><span><Text>{when}</Text></span><span /></>}
    </div>
  );
}

/** Rows shaped like the real ones, shown for at least 600ms while the list loads. */
function VerifySkeleton({ cols, decided }: { cols: string; decided: boolean }) {
  return (
    <Card className="overflow-hidden" aria-busy aria-live="polite">
      <VerifyHeader cols={cols} when="Registered" decided={decided} />
      <span className="sr-only"><Text>Loading residents</Text></span>
      <ul className="divide-y divide-ink-100/80">
        {Array.from({ length: 3 }, (_, i) => (
          <li key={i} className={cn('grid gap-2 py-4 pl-7 pr-5 lg:items-center lg:gap-4', cols)}>
            <span className="space-y-1.5"><Skeleton className="h-4 w-32" /><Skeleton className="h-4 w-14 rounded-full" /></span>
            <Skeleton className="h-4 w-full max-w-72" />
            <Skeleton className="h-4 w-20" />
            <span className="space-y-1.5"><Skeleton className="h-4 w-36" /><Skeleton className="h-3 w-24" /></span>
            {decided ? (
              <span className="space-y-1.5"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-28" /></span>
            ) : (
              <>
                <Skeleton className="h-4 w-16" />
                <span className="flex gap-2 lg:justify-end"><Skeleton className="h-8 w-20 rounded-md" /><Skeleton className="h-8 w-16 rounded-md" /></span>
              </>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Accounts({ hq, meId }: { hq: boolean; meId?: string }) {
  const toast = useToast();
  const t = useT();
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
      void accounts.mutate();
    },
  });
  // An approved or rejected request slides out of the list, then the list refreshes.
  const [leavingRequest, setLeavingRequest] = useState<string | null>(null);
  const decideRequest = async (id: string, approve: boolean) => {
    if ((await decide.run(id, approve)) === undefined) return;
    setLeavingRequest(id);
    await afterLeave();
    await requests.mutate();
    setLeavingRequest(null);
  };
  const [actingId, setActingId] = useState<string | null>(null);
  const sendLink = async (id: string) => {
    setActingId(id);
    await reinvite.run(id);
    setActingId(null);
  };
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<RoleGroup>('ALL');
  const [signIn, setSignIn] = useState<SignIn>('');
  const [sort, setSort] = useState<AccountSort>('ROLE');
  const loading = useMinLoading('accounts', !accounts.data);
  const rows = accounts.data ?? [];
  const term = q.trim().toLowerCase();
  // Search and sign-in apply to every chip's count; the chip then picks the role group.
  const base = rows.filter((a) => (!term || a.full_name.toLowerCase().includes(term) || a.email.toLowerCase().includes(term)) && (!signIn || a.active === (signIn === 'ACTIVE')));
  const count = (g: RoleGroup) => (accounts.data ? base.filter((a) => inGroup(a, g)).length : undefined);
  const shown = base
    .filter((a) => inGroup(a, group))
    .sort((a, b) => (sort === 'NAME' ? a.full_name.localeCompare(b.full_name) : sort === 'NEWEST' ? b.created_at.localeCompare(a.created_at) : 0));
  const filtered = group !== 'ALL' || Boolean(term || signIn) || sort !== 'ROLE';

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    void create.run({ email: form.email, fullName: form.fullName, role, merchantId: form.merchantId || undefined, sponsorId: form.sponsorId || undefined });
  };
  // Sponsor logins and admin accounts are HQ's to create; admin accounts also need a second HQ admin.
  const roles: Role[] = hq ? ['TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN', 'HQ_ADMIN', 'MERCHANT', 'SPONSOR'] : ['TOWNSHIP_STAFF', 'MERCHANT'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-ink-900"><Text>Staff & partner access</Text></h2>
          <p className="mt-1 text-sm text-ink-500"><Text>Who can sign in besides residents: your team, shops, couriers, guards and sponsors. Each person sets their own password from a one-time link.</Text></p>
        </div>
        <Button onClick={() => setCreating(true)}>
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
              <li key={r.id} className={cn('ops-row flex flex-wrap items-center justify-between gap-3 py-3', leavingRequest === r.id && 'is-leaving')}>
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-ink-900">
                    <Text>{r.kind === 'NEW_ADMIN' ? 'New account' : 'Password reset'}</Text>: {r.name} · <Text>{ROLE_LABELS[r.role]}</Text>
                  </p>
                  <p className="text-sm text-ink-500">
                    {r.email}<Text> · asked by </Text><Text>{r.requestedBy}</Text> <Text>{timeAgo(r.createdAt)}</Text>
                  </p>
                </div>
                {r.mine ? (
                  <Badge tone="warning"><Text>Waiting for another admin</Text></Badge>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void decideRequest(r.id, true)} disabled={decide.pending}><Text>Approve</Text></Button>
                    <Button size="sm" variant="secondary" onClick={() => void decideRequest(r.id, false)} disabled={decide.pending}><Text>Reject</Text></Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <FilterBar
        search={<SearchField value={q} onChange={setQ} label="Search accounts" placeholder="Name or email, e.g. Nurul or courier@demo.kita.test" />}
        chips={
          <FilterChips<RoleGroup>
            label="Role"
            value={group}
            onChange={setGroup}
            options={[
              { key: 'ALL', label: 'All accounts', count: count('ALL') },
              ...(Object.keys(ROLE_GROUPS) as Exclude<RoleGroup, 'ALL'>[]).map((g) => ({ key: g, label: ROLE_GROUPS[g].label, count: count(g) })),
            ]}
          />
        }
        controls={
          <>
            <FilterMenu<SignIn> label="Status" value={signIn} onChange={setSignIn} options={[{ value: '', label: 'Any' }, { value: 'ACTIVE', label: 'Active' }, { value: 'INVITED', label: 'Invited' }]} />
            <FilterMenu<AccountSort> label="Sort" value={sort} onChange={setSort} options={[{ value: 'ROLE', label: 'By role' }, { value: 'NAME', label: 'Name A to Z' }, { value: 'NEWEST', label: 'Newest first' }]} />
          </>
        }
        summary={loading ? undefined : <FilterSummary shown={shown.length} total={rows.length} noun="accounts" onClear={filtered ? () => { setQ(''); setGroup('ALL'); setSignIn(''); setSort('ROLE'); } : undefined} />}
      />

      {accounts.error && !accounts.data ? (
        <ErrorState error={accounts.error} onRetry={() => void accounts.mutate()} />
      ) : loading ? (
        <AccountsSkeleton />
      ) : shown.length === 0 ? (
        rows.length === 0 ? (
          <EmptyState icon={UserCheck} title="No accounts yet"><Text>Create the first one with New account.</Text></EmptyState>
        ) : (
          <EmptyState icon={Search} title="No accounts match"><Text>Try another name, role or status.</Text></EmptyState>
        )
      ) : (
        <Card key={`${group}|${signIn}|${sort}`} className="content-in overflow-hidden">
          <AccountsHeader />
          <ul className="ops-queue divide-y divide-ink-100/80">
            {shown.map((a, n) => (
              <li key={a.id} style={{ '--i': Math.min(n, 12) } as CSSProperties} className="ops-row relative">
                <span aria-hidden className={cn('ops-rail absolute inset-y-2 left-0 w-1 rounded-r-full', a.active ? 'bg-ink-200' : 'bg-warning-600')} />
                <div className={cn('grid gap-1.5 py-3.5 pl-7 pr-5 text-sm lg:items-center lg:gap-4', ACCOUNT_COLS)}>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold leading-snug text-ink-900">{a.full_name}{a.id === meId && <span className="ml-1.5 text-xs font-medium text-ink-500"><Text>(you)</Text></span>}</span>
                    <span className="block truncate text-ink-500" title={a.email}>{a.email}</span>
                  </span>
                  <span className="text-ink-700"><Text>{ROLE_LABELS[a.role]}</Text></span>
                  <span className="min-w-0 text-ink-600">
                    {a.merchant_name || a.sponsor_name ? <span className="block truncate" title={a.merchant_name ?? a.sponsor_name ?? undefined}>{a.merchant_name ?? a.sponsor_name}</span> : <span className="hidden text-ink-300 lg:inline">–</span>}
                  </span>
                  <span title={t(a.active ? 'Active: has set a password and can sign in.' : 'Invited: has not set a password yet.')}><Badge tone={a.active ? 'success' : 'warning'}><Text>{a.active ? 'Active' : 'Invited'}</Text></Badge></span>
                  <span className="text-ink-500">
                    <span className="lg:hidden"><Text>Added </Text></span>
                    <span title={formatDateTime(a.created_at)}><Text>{formatDate(a.created_at)}</Text></span>
                  </span>
                  <span className="mt-1 lg:mt-0 lg:text-right">
                    {a.id !== meId && (
                      <Button size="sm" variant="ghost" className="text-ink-600" onClick={() => void sendLink(a.id)} disabled={reinvite.pending} pending={actingId === a.id}>
                        {a.active ? <KeyRound className="size-4" aria-hidden /> : <Send className="size-4" aria-hidden />}
                        <Text>{a.active ? 'Reset password' : 'Resend invite'}</Text>
                      </Button>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t border-ink-100/80 bg-ink-25/60 px-5 py-3 text-xs text-ink-500 sm:px-6">
            <Text>Each link works once. Resetting the password of an account in use, or of any admin, needs a second admin’s approval.</Text>
          </p>
        </Card>
      )}

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
          <CopyButton text={link!} onCopied={() => toast.show('Link copied.')} />
        </div>
      </Modal>
    </div>
  );
}


function AccountsHeader() {
  return (
    <div aria-hidden className={cn('hidden gap-4 border-b border-ink-100/80 bg-ink-25/70 py-2 pl-7 pr-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 lg:grid', ACCOUNT_COLS)}>
      <span><Text>Name</Text></span><span><Text>Role</Text></span><span><Text>Shop or sponsor</Text></span><span><Text>Status</Text></span><span><Text>Added</Text></span><span />
    </div>
  );
}

/** Rows shaped like the real ones, shown for at least 600ms while accounts load. */
function AccountsSkeleton() {
  return (
    <Card className="overflow-hidden" aria-busy aria-live="polite">
      <AccountsHeader />
      <span className="sr-only"><Text>Loading accounts</Text></span>
      <ul className="divide-y divide-ink-100/80">
        {Array.from({ length: 5 }, (_, i) => (
          <li key={i} className={cn('grid gap-2 py-4 pl-7 pr-5 lg:items-center lg:gap-4', ACCOUNT_COLS)}>
            <span className="space-y-1.5"><Skeleton className="h-4 w-36" /><Skeleton className="h-3 w-48" /></span>
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-32 rounded-md lg:ml-auto" />
          </li>
        ))}
      </ul>
    </Card>
  );
}
