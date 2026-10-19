'use client';

import '../operations/parcel-workspace.css';
import { Text } from '@/components/ui/localized-text';

import { ArrowRight, Banknote, Building2, CircleCheck, Clock3, Hourglass, Mail, PauseCircle, Phone, Search, Wallet, type LucideIcon } from 'lucide-react';
import { useState, type CSSProperties, type FormEvent } from 'react';
import useSWR, { mutate as mutateAll } from 'swr';
import { Button } from '@/components/ui/button';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { CountUp } from '@/components/ui/count-up';
import { ConfirmDialog, Drawer, Modal } from '@/components/ui/dialog';
import { EmptyState, ErrorState, Skeleton, SkeletonStats } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/field';
import { FilterBar, FilterChips, FilterMenu, FilterSummary, SearchField } from '@/components/ui/filter-bar';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, parseRM, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useMinLoading } from '@/lib/use-min-loading';
import { formatRM, MERCHANT_KINDS, MERCHANT_KIND_LABELS, merchantKind, type MerchantKind } from '@/shared/domain';

/**
 * Shops: approve businesses after checking their registration, set what each
 * one offers, and record money paid into their reward pools. Amounts are read
 * from the ledger accounts the money moves through, so they always agree with
 * Float & payments.
 */

type Status = 'PENDING' | 'ACTIVE' | 'SUSPENDED';
interface Shop {
  id: string;
  name: string;
  registration_no: string;
  category: string;
  status: Status;
  pool_sen: number;
  owed_sen: number;
  offers_retail: boolean;
  offers_services: boolean;
  created_at: string;
  approved_at: string | null;
}
interface Summary { pending: number; active: number; suspended: number; pool_sen: number; owed_sen: number; active_unfunded: number; deposits_30d_sen: number }
interface Detail {
  merchant: Shop & { address: string | null; plan: string; live_offers: number };
  contacts: { full_name: string; email: string; phone: string | null; status: string }[];
  deposits: { amount_sen: number; bank_ref: string; created_at: string; recorded_by: string | null }[];
  depositTotals: { count: number; total_sen: number };
}

const STATUS: Record<Status, { label: string; tone: 'warning' | 'success' | 'danger' }> = {
  PENDING: { label: 'Waiting for approval', tone: 'warning' },
  ACTIVE: { label: 'Active', tone: 'success' },
  SUSPENDED: { label: 'Suspended', tone: 'danger' },
};
const RAIL: Record<Status, string> = { PENDING: 'bg-warning-600', SUSPENDED: 'bg-accent-500', ACTIVE: 'bg-ink-200' };
type StatusFilter = 'ALL' | Status;
type Sort = 'ACTION' | 'NAME' | 'POOL' | 'OWED' | 'NEWEST';
const COLS = 'lg:grid-cols-[minmax(0,1.7fr)_8.5rem_minmax(0,1fr)_10rem_7.5rem_7.5rem_8.5rem]';
const kindOf = (s: Pick<Shop, 'offers_retail' | 'offers_services'>) => merchantKind({ offersRetail: s.offers_retail, offersServices: s.offers_services });

export default function ShopsPage() {
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [kind, setKind] = useState<'' | MerchantKind>('');
  const [sort, setSort] = useState<Sort>('ACTION');
  const [q, setQ] = useState('');
  const search = useDebouncedValue(q.trim());
  const [openId, setOpenId] = useState<string | null>(null);
  const [depositFor, setDepositFor] = useState<Shop | null>(null);

  const summary = useApi<Summary>('/admin/merchant-summary', { refreshInterval: 30_000, keepPreviousData: true });
  const summaryLoading = useMinLoading('summary', !summary.data);

  // The list is tagged with the request it answers, so a slower old answer is never shown as the new one.
  const params = new URLSearchParams({ sort, ...(search ? { q: search } : {}), ...(kind ? { kind } : {}) }).toString();
  const url = `/admin/merchants?${params}`;
  const list = useSWR<{ url: string; rows: Shop[] }, ApiError>(url, async (u: string) => ({ url: u, rows: await api.get<Shop[]>(u) }), {
    keepPreviousData: true, refreshInterval: 30_000, shouldRetryOnError: false,
  });
  const typing = q.trim() !== search;
  const fresh = list.data?.url === url && !typing;
  const loading = useMinLoading(`${url}${typing ? '~' : ''}`, !fresh);

  const rows = list.data?.rows ?? [];
  // Counts come from the same answer as the rows; while a new answer loads they are hidden, never stale.
  const count = (s: StatusFilter) => (loading ? undefined : rows.filter((r) => s === 'ALL' || r.status === s).length);
  const shown = rows.filter((r) => status === 'ALL' || r.status === status);
  const filtered = status !== 'ALL' || Boolean(kind || q) || sort !== 'ACTION';
  const refresh = () => {
    void list.mutate();
    void summary.mutate();
    void mutateAll((key) => typeof key === 'string' && /^\/admin\/merchants\/[0-9a-f-]{36}$/i.test(key));
  };
  const toList = () => document.getElementById('shops-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="parcel-workspace space-y-6">
      <PageHeader title="Shops" description="Approve businesses after checking their registration, set what each one offers, and record payments into their reward pools." />

      {summaryLoading || !summary.data ? (
        summary.error && !summary.data ? <ErrorState error={summary.error} onRetry={() => void summary.mutate()} /> : <SkeletonStats count={5} />
      ) : (
        <Kpis s={summary.data} onPick={(next) => { if (next.status) setStatus(next.status); if (next.sort) setSort(next.sort); toList(); }} />
      )}

      <div id="shops-list" className="scroll-mt-24 space-y-4">
        <FilterBar
          search={<SearchField value={q} onChange={setQ} label="Search businesses" placeholder="Business name, registration number or category, e.g. Kafe or DEMO-0001" />}
          chips={
            <FilterChips<StatusFilter>
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { key: 'ALL', label: 'All businesses', count: count('ALL') },
                { key: 'PENDING', label: 'Waiting for approval', count: count('PENDING'), alert: true },
                { key: 'ACTIVE', label: 'Active', count: count('ACTIVE') },
                { key: 'SUSPENDED', label: 'Suspended', count: count('SUSPENDED') },
              ]}
            />
          }
          controls={
            <>
              <FilterMenu<'' | MerchantKind> label="Offers" value={kind} onChange={setKind} options={[{ value: '', label: 'Any' }, ...MERCHANT_KINDS.map((k) => ({ value: k, label: MERCHANT_KIND_LABELS[k] }))]} />
              <FilterMenu<Sort> label="Sort" value={sort} onChange={setSort} options={[
                { value: 'ACTION', label: 'Needs action first' },
                { value: 'NAME', label: 'Name A to Z' },
                { value: 'POOL', label: 'Largest reward pool' },
                { value: 'OWED', label: 'Most owed' },
                { value: 'NEWEST', label: 'Newest' },
              ]} />
            </>
          }
          summary={loading ? undefined : <FilterSummary live shown={shown.length} total={rows.length} noun="businesses" onClear={filtered ? () => { setStatus('ALL'); setKind(''); setSort('ACTION'); setQ(''); } : undefined} />}
        />

        {list.error && !list.data ? (
          <ErrorState error={list.error} onRetry={() => void list.mutate()} />
        ) : loading ? (
          <ListSkeleton />
        ) : shown.length === 0 ? (
          rows.length === 0 && !filtered ? (
            <EmptyState icon={Building2} title="No businesses yet"><Text>Businesses apply from the “Join as a shop” page.</Text></EmptyState>
          ) : (
            <EmptyState icon={Search} title="No businesses match"><Text>Try another name, status or offer type.</Text></EmptyState>
          )
        ) : (
          <Card className="overflow-hidden">
            <Header />
            <ul className="ops-queue divide-y divide-ink-100/80" aria-busy={false}>
              {shown.map((s, n) => (
                <Row key={s.id} s={s} index={n} onOpen={() => setOpenId(s.id)} onDeposit={() => setDepositFor(s)} />
              ))}
            </ul>
          </Card>
        )}
      </div>

      <ShopPanel id={openId} onClose={() => setOpenId(null)} onDeposit={(s) => setDepositFor(s)} onChanged={refresh} />
      <DepositModal shop={depositFor} onClose={() => setDepositFor(null)} onDone={refresh} />
    </div>
  );
}

function Kpis({ s, onPick }: { s: Summary; onPick: (next: { status?: StatusFilter; sort?: Sort }) => void }) {
  const tiles: { label: string; value: number; money?: boolean; hint: string; icon: LucideIcon; tone: 'danger' | 'warning' | 'ok' | 'neutral'; pick: { status?: StatusFilter; sort?: Sort } }[] = [
    { label: 'Waiting for approval', value: s.pending, hint: s.pending ? 'Check registration, then approve' : 'None waiting', icon: Hourglass, tone: s.pending ? 'warning' : 'ok', pick: { status: 'PENDING' } },
    { label: 'Active businesses', value: s.active, hint: s.active_unfunded ? `${s.active_unfunded} with an empty reward pool` : 'All reward pools funded', icon: CircleCheck, tone: s.active_unfunded ? 'warning' : 'ok', pick: { status: 'ACTIVE' } },
    { label: 'Held in reward pools', value: s.pool_sen, money: true, hint: `${formatRM(s.deposits_30d_sen)} deposited in 30 days`, icon: Wallet, tone: 'neutral', pick: { status: 'ALL', sort: 'POOL' } },
    { label: 'Owed to businesses', value: s.owed_sen, money: true, hint: 'Paid in the weekly settlement', icon: Banknote, tone: 'neutral', pick: { status: 'ALL', sort: 'OWED' } },
    { label: 'Suspended', value: s.suspended, hint: s.suspended ? 'Cannot give or accept points' : 'None suspended', icon: PauseCircle, tone: s.suspended ? 'danger' : 'ok', pick: { status: 'SUSPENDED' } },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {tiles.map((t, i) => (
        <button key={t.label} type="button" onClick={() => onPick(t.pick)} style={{ '--i': i } as CSSProperties} className={cn('ops-kpi glass-surface group relative overflow-hidden rounded-xl border p-4 text-left shadow-sm', `is-${t.tone}`)}>
          <span className="flex items-start justify-between gap-3">
            <span className="text-[13px] font-medium text-ink-500"><Text>{t.label}</Text></span>
            <span className="ops-kpi-icon grid size-8 shrink-0 place-items-center rounded-lg"><t.icon className="size-4" aria-hidden /></span>
          </span>
          <span className="mt-2 block font-display text-[28px] font-bold leading-none tracking-tight text-ink-900 tabular-nums">
            <CountUp value={t.value} format={t.money ? formatRM : undefined} />
          </span>
          <span className="ops-kpi-hint mt-2 flex items-center justify-between gap-2 text-xs">
            <span className="truncate"><Text>{t.hint}</Text></span>
            <ArrowRight className="ops-kpi-arrow size-3.5 shrink-0" aria-hidden />
          </span>
        </button>
      ))}
    </div>
  );
}

function Header() {
  return (
    <div aria-hidden className={cn('hidden gap-4 border-b border-ink-100/80 bg-ink-25/70 py-2 pl-7 pr-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 lg:grid', COLS)}>
      <span><Text>Business</Text></span><span><Text>Registration</Text></span><span><Text>Offers</Text></span><span><Text>Status</Text></span>
      <span className="text-right"><Text>Reward pool</Text></span><span className="text-right"><Text>Owed this week</Text></span><span />
    </div>
  );
}

/** Rows shaped like the real ones, shown only in the results area while a search or filter loads. */
function ListSkeleton() {
  return (
    <Card className="overflow-hidden" aria-busy aria-live="polite">
      <Header />
      <span className="sr-only"><Text>Loading businesses</Text></span>
      <ul className="divide-y divide-ink-100/80">
        {Array.from({ length: 5 }, (_, i) => (
          <li key={i} className={cn('grid gap-2 py-4 pl-7 pr-5 lg:items-center lg:gap-4', COLS)}>
            <span className="space-y-1.5"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-24" /></span>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-5 w-28 rounded-full" />
            <Skeleton className="h-4 w-20 lg:ml-auto" />
            <Skeleton className="h-4 w-16 lg:ml-auto" />
            <Skeleton className="h-8 w-28 rounded-md lg:ml-auto" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Row({ s, index, onOpen, onDeposit }: { s: Shop; index: number; onOpen: () => void; onDeposit: () => void }) {
  const unfunded = s.status === 'ACTIVE' && s.pool_sen === 0;
  return (
    <li style={{ '--i': Math.min(index, 12) } as CSSProperties} className="ops-row relative cursor-pointer" onClick={onOpen}>
      <span aria-hidden className={cn('ops-rail absolute inset-y-2 left-0 w-1 rounded-r-full', RAIL[s.status])} />
      <div className={cn('grid gap-1.5 py-3.5 pl-7 pr-5 text-sm lg:items-center lg:gap-4', COLS)}>
        <span className="min-w-0">
          <button type="button" onClick={(event) => { event.stopPropagation(); onOpen(); }} className="block max-w-full text-left text-[15px] font-semibold leading-snug text-ink-900 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
            {s.name}
          </button>
          <span className="block truncate text-xs text-ink-500">{s.category}</span>
        </span>
        <span className="font-mono text-[13px] font-semibold text-ink-600">{s.registration_no}</span>
        <span className="text-ink-700"><Text>{MERCHANT_KIND_LABELS[kindOf(s)]}</Text></span>
        <span><Badge tone={STATUS[s.status].tone}><Text>{STATUS[s.status].label}</Text></Badge></span>
        <span className="tabular-nums lg:text-right">
          <span className={cn('font-semibold', unfunded ? 'text-warning-700' : 'text-ink-900')}>{formatRM(s.pool_sen)}</span>
          {unfunded && <span className="block text-xs text-warning-700"><Text>Not funded yet</Text></span>}
          <span className="text-xs text-ink-400 lg:hidden"> <Text>reward pool</Text></span>
        </span>
        <span className="tabular-nums text-ink-700 lg:text-right">{formatRM(s.owed_sen)}<span className="text-xs text-ink-400 lg:hidden"> <Text>owed this week</Text></span></span>
        <span className="lg:text-right" onClick={(event) => event.stopPropagation()}>
          {s.status === 'ACTIVE' ? (
            <Button size="sm" variant="secondary" className="w-full lg:w-auto" onClick={onDeposit}><Text>Record deposit</Text></Button>
          ) : (
            <Button size="sm" variant={s.status === 'PENDING' ? 'secondary' : 'ghost'} className="w-full lg:w-auto" onClick={onOpen}><Text>{s.status === 'PENDING' ? 'Review' : 'Open'}</Text></Button>
          )}
        </span>
      </div>
    </li>
  );
}

/** One business: what to check, what it offers, its money, and the decision. */
function ShopPanel({ id, onClose, onDeposit, onChanged }: { id: string | null; onClose: () => void; onDeposit: (s: Shop) => void; onChanged: () => void }) {
  const detail = useApi<Detail>(id ? `/admin/merchants/${id}` : null);
  const loading = useMinLoading(id ?? '', Boolean(id) && !detail.data);
  const [confirm, setConfirm] = useState<null | 'ACTIVE' | 'SUSPENDED'>(null);
  const [offers, setOffers] = useState<MerchantKind | null>(null);
  const done = () => {
    void detail.mutate();
    onChanged();
  };
  const status = useAction((next: 'ACTIVE' | 'SUSPENDED') => api.post(`/admin/merchants/${id}/status`, { status: next }), {
    onSuccess: () => { setConfirm(null); done(); },
    success: (r) => ((r as { status: string }).status === 'ACTIVE' ? 'The business is active.' : 'The business is suspended.'),
  });
  const saveOffers = useAction((k: MerchantKind) => api.post(`/admin/merchants/${id}/kind`, { kind: k }), { onSuccess: () => { setOffers(null); done(); }, success: 'Saved.' });
  const d = detail.data;
  const m = d?.merchant;
  const current = m ? kindOf(m) : 'RETAIL';
  const close = () => { setOffers(null); setConfirm(null); onClose(); };

  return (
    <Drawer open={id !== null} onClose={close} side="right" title={m?.name ?? ''} description={m ? `${m.category} · ${m.registration_no}` : undefined}>
      {detail.error && !d ? (
        <ErrorState error={detail.error} onRetry={() => void detail.mutate()} />
      ) : loading || !d || !m ? (
        <div className="space-y-4" aria-busy><Skeleton className="h-20 w-full" /><Skeleton className="h-32 w-full" /><Skeleton className="h-24 w-full" /></div>
      ) : (
        <div className="space-y-6 text-sm">
          <section className={cn('rounded-lg border p-4', m.status === 'PENDING' ? 'border-warning-600/25 bg-warning-50' : m.status === 'SUSPENDED' ? 'border-accent-200 bg-accent-50' : 'border-ink-100/80')}>
            <p className="flex items-center gap-2"><Badge tone={STATUS[m.status].tone}><Text>{STATUS[m.status].label}</Text></Badge></p>
            <p className="mt-2 text-ink-700">
              <Text>{m.status === 'PENDING'
                ? 'Check the business registration number against SSM records and confirm the contact person before approving.'
                : m.status === 'SUSPENDED'
                  ? 'This business cannot give or accept points. Restore it when the issue is settled.'
                  : 'This business can accept points, and give points while its reward pool has money.'}</Text>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {m.status === 'PENDING' && <Button size="sm" onClick={() => setConfirm('ACTIVE')}><Text>Approve business</Text></Button>}
              {m.status === 'SUSPENDED' && <Button size="sm" onClick={() => setConfirm('ACTIVE')}><Text>Restore business</Text></Button>}
              {m.status === 'ACTIVE' && <Button size="sm" onClick={() => onDeposit(m)}><Text>Record deposit</Text></Button>}
              {m.status === 'ACTIVE' && <Button size="sm" variant="ghost" onClick={() => setConfirm('SUSPENDED')}><Text>Suspend</Text></Button>}
            </div>
          </section>

          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500"><Text>Business details</Text></h3>
            <dl className="mt-2 grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
              <dt className="text-ink-500"><Text>Registration no.</Text></dt><dd className="font-mono font-semibold text-ink-900">{m.registration_no}</dd>
              <dt className="text-ink-500"><Text>Category</Text></dt><dd className="text-ink-900">{m.category}</dd>
              <dt className="text-ink-500"><Text>Address</Text></dt><dd className="text-ink-900">{m.address || <Text>Not given</Text>}</dd>
              <dt className="text-ink-500"><Text>Applied</Text></dt><dd className="text-ink-900"><Text>{formatDate(m.created_at)}</Text></dd>
              <dt className="text-ink-500"><Text>Approved</Text></dt><dd className="text-ink-900">{m.approved_at ? <Text>{formatDate(m.approved_at)}</Text> : <Text>Not yet</Text>}</dd>
            </dl>
          </section>

          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500"><Text>Contact people</Text></h3>
            {d.contacts.length === 0 ? <p className="mt-2 text-ink-500"><Text>No accounts linked.</Text></p> : (
              <ul className="mt-2 divide-y divide-ink-100/80 rounded-lg border border-ink-100/80">
                {d.contacts.map((c) => (
                  <li key={c.email} className="space-y-0.5 px-3 py-2.5">
                    <p className="font-semibold text-ink-900">{c.full_name}{c.status !== 'ACTIVE' && <> · <span className="font-normal text-ink-500"><Text>Disabled</Text></span></>}</p>
                    <p className="flex flex-wrap gap-x-4 gap-y-1 text-ink-600">
                      <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1.5 hover:text-brand-700"><Mail className="size-3.5" aria-hidden />{c.email}</a>
                      {c.phone && <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 hover:text-brand-700"><Phone className="size-3.5" aria-hidden />{c.phone}</a>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500"><Text>What it offers</Text></h3>
            <form method="post" className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(event: FormEvent) => { event.preventDefault(); if (offers && offers !== current) void saveOffers.run(offers); }}>
              <Select label="Offers" labelClassName="sr-only" value={offers ?? current} onChange={(event) => setOffers(event.target.value as MerchantKind)} className="min-w-0 flex-1 basis-52">
                {MERCHANT_KINDS.map((k) => <option key={k} value={k}><Text>{MERCHANT_KIND_LABELS[k]}</Text></option>)}
              </Select>
              <Button type="submit" size="sm" variant="secondary" disabled={!offers || offers === current} pending={saveOffers.pending}><Text>Save</Text></Button>
            </form>
            <p className="mt-1.5 text-xs text-ink-500"><Text>A shop gives and accepts points at the counter. Home services take bookings. A change is refused while bookings or a Shop Offer are still open.</Text></p>
          </section>

          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500"><Text>Money</Text></h3>
            <dl className="mt-2 grid grid-cols-3 gap-2">
              {[
                { label: 'Reward pool', value: formatRM(m.pool_sen) },
                { label: 'Owed this week', value: formatRM(m.owed_sen) },
                { label: 'Total deposited', value: formatRM(d.depositTotals.total_sen) },
              ].map((x) => (
                <div key={x.label} className="rounded-lg border border-ink-100/80 p-2.5">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500"><Text>{x.label}</Text></dt>
                  <dd className="mt-1 font-display text-base font-bold tabular-nums text-ink-900">{x.value}</dd>
                </div>
              ))}
            </dl>
            <h4 className="mt-4 text-xs font-semibold text-ink-700"><Text>{`Recent deposits (${d.depositTotals.count})`}</Text></h4>
            {d.deposits.length === 0 ? <p className="mt-1 text-ink-500"><Text>No deposits yet.</Text></p> : (
              <ul className="mt-1.5 divide-y divide-ink-100/80 rounded-lg border border-ink-100/80">
                {d.deposits.map((x) => (
                  <li key={x.bank_ref} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block font-mono text-[13px] font-semibold text-ink-800">{x.bank_ref}</span>
                      <span className="block text-xs text-ink-500"><Text>{formatDateTime(x.created_at)}</Text>{x.recorded_by && <> · {x.recorded_by}</>}</span>
                    </span>
                    <span className="font-semibold tabular-nums text-success-700">+{formatRM(x.amount_sen)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <ConfirmDialog
            open={confirm !== null}
            onClose={() => setConfirm(null)}
            onConfirm={() => confirm && void status.run(confirm)}
            title={confirm === 'SUSPENDED' ? 'Suspend this business?' : m.status === 'PENDING' ? 'Approve this business?' : 'Restore this business?'}
            confirmLabel={confirm === 'SUSPENDED' ? 'Suspend' : m.status === 'PENDING' ? 'Approve' : 'Restore'}
            destructive={confirm === 'SUSPENDED'}
            pending={status.pending}
          >
            <p>
              <Text>{confirm === 'SUSPENDED'
                ? 'It will stop giving and accepting points straight away. Its reward pool and what is owed to it are kept.'
                : m.status === 'PENDING'
                  ? 'It can accept points straight away, and give points once its reward pool is funded. Its contact people are notified.'
                  : 'It can give and accept points again.'}</Text>
            </p>
          </ConfirmDialog>
        </div>
      )}
    </Drawer>
  );
}

/** Money received into a reward pool. Recorded once per bank reference; the ledger refuses a repeat. */
function DepositModal({ shop, onClose, onDone }: { shop: Shop | null; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [bankRef, setBankRef] = useState('');
  const sen = parseRM(amount);
  const close = () => { setAmount(''); setBankRef(''); onClose(); };
  const record = useAction(() => api.post<{ poolSen: number }>(`/admin/merchants/${shop!.id}/deposits`, { amountSen: sen, bankRef: bankRef.trim() }), {
    success: (r) => `Deposit recorded. The reward pool is now ${formatRM(r.poolSen)}.`,
    onSuccess: () => { close(); onDone(); },
  });
  const valid = sen !== null && sen > 0 && bankRef.trim().length >= 3;
  return (
    <Modal
      open={shop !== null}
      onClose={close}
      title="Record a deposit"
      description={shop ? shop.name : undefined}
      footer={<>
        <Button variant="secondary" onClick={close}><Text>Cancel</Text></Button>
        <Button type="submit" form="record-deposit" pending={record.pending} disabled={!valid}><Text>Record deposit</Text></Button>
      </>}
    >
      <form method="post" id="record-deposit" className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (valid && !record.pending) void record.run(); }}>
        <p className="flex items-start gap-2 rounded-lg bg-ink-25 p-3 text-ink-700">
          <Clock3 className="mt-0.5 size-4 shrink-0 text-ink-500" aria-hidden />
          <Text>Record this only after the transfer shows in the trust account. The money can only be used for this business’s points and its service fee.</Text>
        </p>
        <Input label="Amount received (RM)" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" autoComplete="off" placeholder="0.00" required
          error={record.fields.amountSen ?? (amount && sen === null ? 'Enter an amount such as 250 or 250.50.' : undefined)} />
        <Input label="Bank reference" value={bankRef} onChange={(event) => setBankRef(event.target.value)} maxLength={60} autoComplete="off" required error={record.fields.bankRef} hint="As shown on the bank statement. Each reference can be recorded once." />
        {shop && sen !== null && sen > 0 && (
          <p className="flex justify-between rounded-lg border border-ink-100/80 px-3 py-2 text-ink-700">
            <span><Text>Reward pool after this deposit</Text></span>
            <span className="font-semibold tabular-nums text-ink-900">{formatRM(shop.pool_sen + sen)}</span>
          </p>
        )}
        {shop && <p className="text-xs text-ink-500"><Text>{`Current reward pool ${formatRM(shop.pool_sen)} · approved ${shop.approved_at ? timeAgo(shop.approved_at) : '–'}`}</Text></p>}
      </form>
    </Modal>
  );
}
