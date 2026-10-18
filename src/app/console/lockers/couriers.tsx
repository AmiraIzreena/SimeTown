'use client';

import { Text } from '@/components/ui/localized-text';

import { Truck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState, SkeletonList } from '@/components/ui/feedback';
import { Checkbox } from '@/components/ui/field';
import { FilterBar, FilterChips, FilterMenu, FilterSummary, SearchField } from '@/components/ui/filter-bar';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { useIsAdmin, type Overview } from './overview';

interface CourierRow {
  user_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  company: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  kind: 'COURIER' | 'MANAGER';
  managed_by: 'TOWNSHIP' | 'COMPANY' | 'FEDERATED';
  employee_ref: string | null;
  applied_at: string;
  stations: { id: string; name: string }[];
  deliveries_30d: number;
}
interface CompanyOption { id: string; name: string }
const STATUS = {
  PENDING: { label: 'Waiting for approval', tone: 'gold' as const },
  ACTIVE: { label: 'Active', tone: 'success' as const },
  SUSPENDED: { label: 'Suspended by the company', tone: 'warning' as const },
  REVOKED: { label: 'Access withdrawn', tone: 'neutral' as const },
};
const MANAGED = { TOWNSHIP: 'Approved by the township', COMPANY: 'Managed by the company', FEDERATED: 'Company sign-in' };

const COURIER_STATUS_LABELS: Record<CourierRow['status'], string> = { PENDING: 'Waiting for approval', ACTIVE: 'Approved', SUSPENDED: 'Suspended', REVOKED: 'Revoked' };

export function CouriersTab() {
  const couriers = useApi<CourierRow[]>('/admin/lockers/couriers');
  const companies = useApi<CompanyOption[]>('/admin/couriers/companies');
  const stations = useApi<Overview>('/admin/lockers');
  const t = useT();
  const [search, setSearch] = useState('');
  const [company, setCompany] = useState('');
  const [coverage, setCoverage] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | CourierRow['status']>('');
  const [sort, setSort] = useState('newest');
  const companyOptions = (companies.data ?? []).map((company) => company.name).sort((a, b) => a.localeCompare(b));
  const coverageOptions = (stations.data?.stations ?? []).map((station) => ({ id: station.id, name: station.name })).sort((a, b) => a.name.localeCompare(b.name));
  const searchTerms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matchingCouriers = (couriers.data ?? []).filter((courier) => {
    const text = [courier.full_name, courier.company, courier.email, courier.phone, courier.employee_ref].filter(Boolean).join(' ').toLocaleLowerCase();
    return searchTerms.every((term) => text.includes(term))
      && (!statusFilter || courier.status === statusFilter)
      && (!company || courier.company === company)
      && (!coverage || (coverage === 'unassigned' ? courier.stations.length === 0 : courier.stations.some((station) => station.id === coverage)));
  }).sort((a, b) => {
    const nameOrder = a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base', numeric: true });
    if (sort === 'az') return nameOrder || a.user_id.localeCompare(b.user_id);
    if (sort === 'za') return -nameOrder || a.user_id.localeCompare(b.user_id);
    const dateOrder = new Date(a.applied_at).getTime() - new Date(b.applied_at).getTime();
    return (sort === 'oldest' ? dateOrder : -dateOrder) || nameOrder || a.user_id.localeCompare(b.user_id);
  });
  const selectedCoverageName = coverageOptions.find((station) => station.id === coverage)?.name;
  const noAccountsMessage = search
    ? t('No courier accounts match your search and filters.')
    : company && selectedCoverageName
      ? t('No courier accounts for {company} cover {station} yet.', { company, station: selectedCoverageName })
      : company
        ? t('No courier accounts have been registered for {company} yet.', { company })
        : coverage === 'unassigned'
          ? t('No courier accounts are without a locker station.')
          : selectedCoverageName
            ? t('No courier accounts cover {station} yet.', { station: selectedCoverageName })
            : t('Try another search or reset the account filters.');
  const isAdmin = useIsAdmin();
  const [approving, setApproving] = useState<CourierRow | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const approve = useAction(() => api.post(`/admin/lockers/couriers/${approving!.user_id}/approve`, { stationIds: picked }), {
    success: 'Approved. The courier can use the chosen stations now.',
    onSuccess: () => {
      setApproving(null);
      void couriers.mutate();
    },
  });
  const revoke = useAction((id: string) => api.post(`/admin/lockers/couriers/${id}/revoke`, {}), { success: 'Access withdrawn.', onSuccess: () => void couriers.mutate() });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold text-ink-900"><Text>Courier accounts</Text></h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-500"><Text>Only couriers of companies without their own arrangement are approved here, one by one. Anyone’s access can be withdrawn here at once, in an emergency.</Text></p>
      </div>
      <FilterBar
        search={<SearchField label="Search courier accounts" placeholder="Name, company, email, phone or employee reference" value={search} onChange={setSearch} />}
        chips={<FilterChips<typeof statusFilter> label="Account status" value={statusFilter} onChange={setStatusFilter} options={[
          { key: '', label: 'All accounts', count: (couriers.data ?? []).length },
          ...(['PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED'] as const).map((key) => ({ key, label: COURIER_STATUS_LABELS[key], count: (couriers.data ?? []).filter((courier) => courier.status === key).length, alert: key === 'PENDING' })),
        ]} />}
        controls={<>
          <FilterMenu label="Courier company" value={company} onChange={setCompany} options={[
            { value: '', label: 'All companies' },
            ...companyOptions.map((name) => ({ value: name, label: name, raw: true })),
          ]} />
          <FilterMenu label="Area covered (station)" value={coverage} onChange={setCoverage} options={[
            { value: '', label: 'All stations' },
            { value: 'unassigned', label: 'No stations yet' },
            ...coverageOptions.map((station) => ({ value: station.id, label: station.name, raw: true })),
          ]} />
          <FilterMenu label="Sort" value={sort} onChange={setSort} options={[
            { value: 'newest', label: 'Newest applications first' },
            { value: 'oldest', label: 'Oldest applications first' },
            { value: 'az', label: 'Name: A–Z' },
            { value: 'za', label: 'Name: Z–A' },
          ]} />
        </>}
        summary={couriers.data && <FilterSummary shown={matchingCouriers.length} total={couriers.data.length} noun="courier accounts" onClear={search || statusFilter || company || coverage || sort !== 'newest' ? () => { setSearch(''); setStatusFilter(''); setCompany(''); setCoverage(''); setSort('newest'); } : undefined} />}
      />
      <Async state={couriers} skeleton={<SkeletonList rows={3} />}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState icon={Truck} title="No courier accounts yet"><Text>Companies that manage their own couriers add them; other couriers apply at /courier-apply.</Text></EmptyState>
          ) : matchingCouriers.length === 0 ? (
            <EmptyState icon={Truck} title={search ? 'No matching accounts' : 'No courier accounts found'}>{noAccountsMessage}</EmptyState>
          ) : (
              <ul className="space-y-5">
                {matchingCouriers.map((c) => (
                  <li key={c.user_id}>
                    <Card className="overflow-hidden">
                    <div className="space-y-5 p-5 sm:p-6">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0"><h3 className="break-words text-base font-semibold text-ink-900">{c.full_name}</h3>
                          <p className="mt-1 text-sm text-ink-500">{c.company}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                        <Badge tone={STATUS[c.status].tone}><Text>{STATUS[c.status].label}</Text></Badge>
                        <Badge tone="neutral"><Text>{c.kind === 'MANAGER' ? 'Company representative' : MANAGED[c.managed_by]}</Text></Badge>
                        </div>
                      </div>
                      <dl className="grid gap-x-6 gap-y-4 border-t border-ink-100 pt-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
                        <div className="min-w-0"><dt className="text-xs font-medium text-ink-500"><Text>Email</Text></dt><dd className="mt-1 break-words text-ink-800">{c.email}</dd></div>
                        <div><dt className="text-xs font-medium text-ink-500"><Text>Phone</Text></dt><dd className="mt-1 text-ink-800">{c.phone ?? '–'}</dd></div>
                        <div><dt className="text-xs font-medium text-ink-500"><Text>Employee reference</Text></dt><dd className="mt-1 break-words font-mono text-ink-800">{c.employee_ref ?? '–'}</dd></div>
                        <div><dt className="text-xs font-medium text-ink-500"><Text>Applied on</Text></dt><dd className="mt-1 text-ink-800"><Text>{formatDateTime(c.applied_at)}</Text></dd></div>
                      </dl>
                      <div className="grid gap-4 rounded-lg bg-ink-50/70 p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                        <div><p className="mb-2 text-xs font-medium text-ink-500"><Text>Stations</Text></p>
                          {c.stations.length ? <ul className="flex flex-wrap gap-2">{c.stations.map((s) => <li key={s.id} className="rounded-md border border-ink-200 bg-white px-2.5 py-1 text-sm text-ink-700">{s.name}</li>)}</ul> : <p className="text-sm text-ink-500"><Text>No stations yet</Text></p>}
                        </div>
                        <div className="sm:border-l sm:border-ink-200 sm:pl-5"><p className="text-xs font-medium text-ink-500"><Text>Deliveries, last 30 days</Text></p><p className="mt-1 text-xl font-semibold tabular-nums text-ink-900">{c.deliveries_30d}</p></div>
                      </div>
                    </div>
                    {isAdmin && ((c.managed_by === 'TOWNSHIP' && c.kind === 'COURIER') || c.status === 'ACTIVE') && <div className="flex flex-wrap gap-2 border-t border-ink-100 px-5 py-3 sm:px-6">
                      {c.managed_by === 'TOWNSHIP' && c.kind === 'COURIER' && <Button size="sm" variant={c.status === 'PENDING' ? 'primary' : 'secondary'} onClick={() => { setApproving(c); setPicked(c.stations.map((s) => s.id)); }}><Text>{c.status === 'ACTIVE' ? 'Change stations' : 'Approve'}</Text></Button>}
                      {c.status === 'ACTIVE' && <Button size="sm" variant="ghost" onClick={() => void revoke.run(c.user_id)} disabled={revoke.pending}><Text>Withdraw access</Text></Button>}
                    </div>}
                    </Card>
                  </li>
                ))}
              </ul>
          )
        }
      </Async>
      <Modal
        open={approving !== null}
        onClose={() => setApproving(null)}
        title={approving ? `Stations for ${approving.full_name}` : ''}
        description="The courier can register parcels and open doors only at these stations."
        footer={<><Button variant="secondary" onClick={() => setApproving(null)}><Text>Cancel</Text></Button><Button disabled={picked.length === 0} pending={approve.pending} onClick={() => void approve.run()}><Text>Approve</Text></Button></>}
      >
        <div className="space-y-2">
          {stations.data?.stations.map((s) => (
            <Checkbox key={s.id} label={`${s.name} · ${s.location}`} checked={picked.includes(s.id)} onChange={() => setPicked((cur) => (cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id]))} />
          ))}
        </div>
      </Modal>
    </div>
  );
}
