'use client';

import { Text } from '@/components/ui/localized-text';

import { Activity, Barcode, Repeat2, ScanLine } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, Stat } from '@/components/ui/card';
import { Async, EmptyState, SkeletonStats } from '@/components/ui/feedback';
import { Select } from '@/components/ui/field';
import { FilterBar, FilterChips, FilterMenu, FilterSummary, SearchField } from '@/components/ui/filter-bar';
import { api } from '@/lib/api';
import { formatDateTime, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import type { Overview } from './overview';

interface Monitor {
  outcomes: { outcome: string; n: number }[];
  recent: { id: string; tracking_no: string; outcome: string; reason: string | null; at: string; courier: string | null; company: string | null; station: string | null; assurance: string | null; match_method: string | null; case_reference: string | null; case_status: string | null }[];
  replays: { tracking_no: string; company: string; deposited_at: string; attempts: number; last_attempt: string }[];
  providers: { id: string; name: string; provider_mode: string; sim_outage: boolean; provider_checked_at: string | null; provider_ok: boolean | null; provider_error: string | null; provider_latency_ms: number | null; can_confirm_assignment: boolean; failures_24h: number }[];
}
interface Simulated {
  companies: { id: string; name: string; code: string; sim_outage: boolean; provider_mode: string; idp_mode: string | null; can_confirm_assignment: boolean }[];
  shipments: { id: string; company_id: string; tracking_no: string; status: string; locker_eligible: boolean; recipient_name: string; address_line: string; assigned_courier_ref: string | null; demo_case: string; deposited_at: string | null }[];
  directory: { company_id: string; employee_ref: string; full_name: string; active: boolean; simetown_status: string | null }[];
}
interface RegisteredCompany { id: string; name: string }

export const OUTCOME_LABELS: Record<string, string> = {
  VERIFIED: 'Verified', NOT_FOUND: 'Not found', UNVERIFIED: 'Not checkable', PROVIDER_UNAVAILABLE: 'Courier system unavailable', RECIPIENT_MISMATCH: 'Recipient not matched',
  NOT_ELIGIBLE: 'Not eligible', ALREADY_DEPOSITED: 'Already delivered', COURIER_NOT_AUTHORISED: 'Courier not authorised', DUPLICATE_PARCEL: 'Already registered',
  SCAN_FIRST: 'Fallback refused',
};
const RESULT_DETAILS: Record<string, string> = {
  'NOT_ELIGIBLE:ASSIGNED_TO_ANOTHER_COURIER': 'Another courier is assigned to this parcel. No locker door opened.',
  'NOT_ELIGIBLE:IN_PROGRESS': 'Another courier is already delivering this parcel. No locker door opened.',
  'NOT_ELIGIBLE:NOT_LOCKER_ELIGIBLE': 'This parcel cannot be placed in a locker.',
  'NOT_ELIGIBLE:DELIVERED': 'The courier company says this parcel was already delivered.',
  'NOT_ELIGIBLE:CANCELLED': 'The courier company says this delivery was cancelled.',
  'NOT_ELIGIBLE:RETURNED': 'This parcel is being returned to the sender.',
  'NOT_ELIGIBLE:ON_HOLD': 'The courier company has placed this parcel on hold.',
  'RECIPIENT_MISMATCH:NAME_MISMATCH': 'The recipient name does not match this address. No locker door opened.',
  'RECIPIENT_MISMATCH:NOT_REGISTERED': 'No registered SimeTown household was found for this recipient.',
  'PROVIDER_UNAVAILABLE:FALLBACK': 'The courier company system did not answer. Try again or use the resident delivery code.',
  NOT_FOUND: 'The courier company has no record of this parcel.',
  ALREADY_DEPOSITED: 'This parcel was scanned after delivery. No locker door opened.',
};
const resultDetail = (outcome: string, reason: string | null) => RESULT_DETAILS[`${outcome}:${reason}`] ?? RESULT_DETAILS[outcome] ?? null;
const SIM_STATUSES = ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'ON_HOLD', 'CANCELLED', 'RETURNED'] as const;
const SIM_STATUS_LABELS: Record<(typeof SIM_STATUSES)[number], string> = {
  IN_TRANSIT: 'In transit', OUT_FOR_DELIVERY: 'Out for delivery', DELIVERED: 'Delivered', ON_HOLD: 'On hold', CANCELLED: 'Cancelled', RETURNED: 'Returned to sender',
};

/** Every scan and what came of it: the place to see replayed barcodes, unknown shipments and a courier company that has stopped answering. */
export function ShipmentsTab() {
  const monitor = useApi<Monitor>('/admin/couriers/shipments', { refreshInterval: 10_000 });
  const registeredCompanies = useApi<RegisteredCompany[]>('/admin/couriers/companies');
  const lockerOverview = useApi<Overview>('/admin/lockers');
  const t = useT();
  const [search, setSearch] = useState('');
  const [resultFilter, setResultFilter] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [stationFilter, setStationFilter] = useState('');
  const [sort, setSort] = useState('newest');
  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-xl font-bold text-ink-900"><Text>Parcel check history</Text></h2>
          <Badge tone="neutral"><Text>Read-only</Text></Badge>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-ink-500"><Text>A read-only record of parcels checked at smart lockers. Successful and refused checks appear here. If staff action is required, SimeTown creates a case under Smart lockers, Cases & reports.</Text></p>
      </div>
      <Async state={monitor} skeleton={<SkeletonStats count={4} />}>
        {(m) => {
          const count = (o: string) => m.outcomes.find((x) => x.outcome === o)?.n ?? 0;
          const total = m.outcomes.reduce((a, x) => a + x.n, 0);
          const companyOptions = (registeredCompanies.data ?? []).map((company) => company.name).sort((a, b) => a.localeCompare(b));
          const stationOptions = (lockerOverview.data?.stations ?? []).map((station) => station.name).sort((a, b) => a.localeCompare(b));
          const searchTerms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
          const visibleRecent = m.recent.filter((scan) => {
            const detail = resultDetail(scan.outcome, scan.reason);
            const searchable = [scan.tracking_no, scan.courier, scan.company, scan.station, OUTCOME_LABELS[scan.outcome], detail].filter(Boolean).join(' ').toLocaleLowerCase();
            const resultMatches = !resultFilter
              || (resultFilter === 'ATTENTION' ? scan.outcome !== 'VERIFIED' : scan.outcome === resultFilter);
            return searchTerms.every((term) => searchable.includes(term))
              && resultMatches
              && (!companyFilter || scan.company === companyFilter)
              && (!stationFilter || scan.station === stationFilter);
          }).sort((a, b) => {
            const dateOrder = new Date(b.at).getTime() - new Date(a.at).getTime();
            if (sort === 'oldest') return -dateOrder;
            if (sort === 'attention') {
              const outcomeOrder = Number(a.outcome === 'VERIFIED') - Number(b.outcome === 'VERIFIED');
              return outcomeOrder || dateOrder;
            }
            return dateOrder;
          });
          const filtersActive = Boolean(search || resultFilter || companyFilter || stationFilter || sort !== 'newest');
          const noResultsTitle = search ? 'No matching parcel checks' : 'No parcel checks recorded';
          const noResultsMessage = search
            ? t('No parcel checks match your search and filters.')
            : companyFilter && stationFilter
              ? t('No parcel checks have been recorded for {company} at {station} yet.', { company: companyFilter, station: stationFilter })
              : companyFilter
                ? t('No parcel checks have been recorded for {company} yet.', { company: companyFilter })
                : stationFilter
                  ? t('No parcel checks have been recorded at {station} yet.', { station: stationFilter })
                  : resultFilter
                    ? t('No parcel checks have this result yet.')
                    : t('Try another search or reset the filters.');
          return (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Stat label="Scans, 7 days" value={total} icon={ScanLine} />
                <Stat label="Verified" value={count('VERIFIED')} icon={Barcode} tone="brand" />
                <Stat label="Repeated after delivery" value={count('ALREADY_DEPOSITED')} icon={Repeat2} tone={count('ALREADY_DEPOSITED') ? 'danger' : 'brand'} hint="No door opened" />
                <Stat label="Checks failed: courier system" value={count('PROVIDER_UNAVAILABLE')} hint="Last 7 days" icon={Activity} tone={count('PROVIDER_UNAVAILABLE') ? 'warning' : 'brand'} />
              </div>
              {m.providers.filter((p) => p.sim_outage || p.provider_ok === false).map((p) => (
                <Card key={p.id} className="border-warning-200 bg-warning-50 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-ink-900">{p.name} · <Text>{p.sim_outage ? 'Demo parcel checks are switched off' : 'Last parcel check failed'}</Text></h3>
                    {p.provider_mode === 'SIMULATED' && <Badge tone="neutral"><Text>Simulated</Text></Badge>}
                  </div>
                  {p.provider_checked_at && <p className="mt-1 text-sm text-ink-600"><Text>{formatDateTime(p.provider_checked_at)}</Text></p>}
                  <p className="mt-2 text-sm text-ink-700"><Text>The courier system could not check a parcel. Ask an admin to check the company’s Integration settings.</Text></p>
                  <Button size="sm" variant="secondary" className="mt-3" href="/console/operations?tab=manage&view=companies"><Text>Open courier companies</Text></Button>
                </Card>
              ))}
              {m.replays.length > 0 && (
                <Card>
                  <CardHeader title="Shipments scanned again after delivery" description="Each attempt was refused and no door opened. Several attempts can mean a copied label." />
                  <ul className="divide-y divide-ink-100">
                    {m.replays.map((r) => (
                      <li key={`${r.company}-${r.tracking_no}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-[15px]">
                        <span className="font-semibold text-ink-900">{r.tracking_no} <span className="font-normal text-ink-500">· {r.company}</span></span>
                        <span className="text-sm text-ink-600"><Text>{`${r.attempts} attempts, last ${timeAgo(r.last_attempt)}`}</Text> · <Text>{`delivered ${formatDateTime(r.deposited_at)}`}</Text></span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              <Card className="overflow-hidden">
                <CardHeader title="Recent checks" description="Review what happened during each check. Open the linked case when staff follow-up is required." />
                {m.recent.length > 0 && (
                  <div className="border-b border-ink-100/80 p-4 sm:p-5">
                    <FilterBar
                      className="shadow-none"
                      search={<SearchField label="Search parcel checks" placeholder="Tracking number, courier, company or locker" value={search} onChange={setSearch} />}
                      chips={<FilterChips label="Result" value={resultFilter === '' || resultFilter === 'VERIFIED' ? resultFilter : 'ATTENTION'} onChange={setResultFilter} options={[
                        { key: '', label: 'All results', count: m.recent.length },
                        { key: 'VERIFIED', label: 'Verified', count: m.recent.filter((scan) => scan.outcome === 'VERIFIED').length },
                        { key: 'ATTENTION', label: 'Failed checks', count: m.recent.filter((scan) => scan.outcome !== 'VERIFIED').length, alert: true },
                      ]} />}
                      controls={<>
                        {resultFilter !== '' && resultFilter !== 'VERIFIED' && (
                          <FilterMenu label="Why it failed" value={resultFilter === 'ATTENTION' ? '' : resultFilter} onChange={(next) => setResultFilter(next || 'ATTENTION')} options={[
                            { value: '', label: 'Any reason' },
                            { value: 'NOT_ELIGIBLE', label: 'Not eligible' },
                            { value: 'RECIPIENT_MISMATCH', label: 'Recipient not matched' },
                            { value: 'ALREADY_DEPOSITED', label: 'Already delivered' },
                            { value: 'PROVIDER_UNAVAILABLE', label: 'Courier system unavailable' },
                            { value: 'NOT_FOUND', label: 'Not found' },
                          ]} />
                        )}
                        <FilterMenu label="Courier company" value={companyFilter} onChange={setCompanyFilter} options={[
                          { value: '', label: 'All companies' },
                          ...companyOptions.map((company) => ({ value: company, label: company, raw: true })),
                        ]} />
                        <FilterMenu label="Locker station" value={stationFilter} onChange={setStationFilter} options={[
                          { value: '', label: 'All locker stations' },
                          ...stationOptions.map((station) => ({ value: station, label: station, raw: true })),
                        ]} />
                        <FilterMenu label="Sort" value={sort} onChange={setSort} options={[
                          { value: 'newest', label: 'Newest first' },
                          { value: 'oldest', label: 'Oldest first' },
                          { value: 'attention', label: 'Failed checks first' },
                        ]} />
                      </>}
                      summary={<FilterSummary shown={visibleRecent.length} total={m.recent.length} noun="checks" onClear={filtersActive ? () => { setSearch(''); setResultFilter(''); setCompanyFilter(''); setStationFilter(''); setSort('newest'); } : undefined} />}
                    />
                  </div>
                )}
                {m.recent.length === 0 ? (
                  <div className="p-5"><EmptyState icon={ScanLine} title="No scans yet"><Text>Scans appear when couriers check labels.</Text></EmptyState></div>
                ) : visibleRecent.length === 0 ? (
                  <div className="p-5"><EmptyState icon={ScanLine} title={noResultsTitle}>{noResultsMessage}</EmptyState></div>
                ) : (
                  <ul className="divide-y divide-ink-100">
                    {visibleRecent.map((r) => (
                      <li key={r.id} className="grid gap-4 px-5 py-4 text-sm lg:grid-cols-[minmax(0,1fr)_220px]">
                        <span className="min-w-0 space-y-1.5">
                          <span className="block break-all font-mono font-semibold text-ink-900">{r.tracking_no}</span>
                          <span className="block break-words text-ink-600">{r.company ?? '–'} · {r.courier ?? '–'}</span>
                          {r.station && <span className="block text-xs text-ink-500">{r.station}</span>}
                          {resultDetail(r.outcome, r.reason) && r.outcome !== 'VERIFIED' && (
                            <span className="block text-sm font-medium text-warning-800"><Text>{resultDetail(r.outcome, r.reason)!}</Text></span>
                          )}
                        </span>
                        <span className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-end">
                          {r.outcome === 'VERIFIED' ? (
                            <Badge tone="success"><Text>Verified</Text></Badge>
                          ) : r.case_reference ? (
                            <Button size="sm" variant="secondary" href={`/console/operations?tab=lockers&view=cases&ref=${encodeURIComponent(r.case_reference)}`}>
                              <Text>Case created</Text> · {r.case_reference}
                            </Button>
                          ) : (
                            <Badge tone="neutral"><Text>Stopped safely</Text></Badge>
                          )}
                          {r.outcome !== 'VERIFIED' && <span className="text-xs text-ink-500"><Text>Check result</Text>: <Text>{OUTCOME_LABELS[r.outcome] ?? r.outcome}</Text></span>}
                          {r.assurance && r.outcome === 'VERIFIED' && <span className="text-xs text-ink-500"><Text>{`${r.assurance.toLowerCase()} assurance`}</Text></span>}
                          <span className="text-xs tabular-nums text-ink-500"><Text>{timeAgo(r.at)}</Text></span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          );
        }}
      </Async>
    </div>
  );
}

/** The demo's stand-ins for real courier companies: act as the company would, to show every case. */
export function SimulatedCompanies() {
  const sim = useApi<Simulated>('/admin/couriers/simulated');
  const status = useAction((id: string, s: string) => api.post(`/admin/couriers/simulated/shipments/${id}`, { status: s }), { onSuccess: () => void sim.mutate() });
  const employee = useAction((companyId: string, ref: string, active: boolean) => api.post(`/admin/couriers/simulated/${companyId}/directory/${encodeURIComponent(ref)}`, { active }), {
    success: 'Done. The company’s change reached SimeTown at once.',
    onSuccess: () => void sim.mutate(),
  });
  if (!sim.data || sim.data.companies.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Simulated courier companies" description="Fictional companies for the demo, standing in for systems SimeTown is not connected to. Change a shipment or a staff member here as the company itself would." />
      <div className="space-y-6 p-5">
        {sim.data.companies.map((c) => (
          <div key={c.id} className="space-y-3">
            <p className="flex flex-wrap items-center gap-2 font-semibold text-ink-900">{c.name} <Badge tone="neutral"><Text>Simulated</Text></Badge>{c.sim_outage && <Badge tone="danger"><Text>Switched down</Text></Badge>}{c.can_confirm_assignment && <Badge tone="brand"><Text>Tracks which courier carries each shipment</Text></Badge>}</p>
            <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
              {sim.data!.shipments.filter((s) => s.company_id === c.id).map((s) => (
                <li key={s.id} className="grid gap-3 px-4 py-2.5 text-sm sm:grid-cols-[1fr_12rem] sm:items-center">
                  <span className="min-w-0">
                    <span className="font-mono text-ink-900">{s.tracking_no}</span> <span className="text-ink-500">· {s.recipient_name}</span>
                    <span className="block text-ink-600"><Text>{s.demo_case}</Text>{s.deposited_at && <> · <Text>delivered to a locker</Text></>}</span>
                  </span>
                  <Select label="Company status" value={s.status} onChange={(event) => void status.run(s.id, event.target.value)}>
                    {SIM_STATUSES.map((x) => <option key={x} value={x}><Text>{SIM_STATUS_LABELS[x]}</Text></option>)}
                  </Select>
                </li>
              ))}
            </ul>
            {sim.data!.directory.some((d) => d.company_id === c.id) && (
              <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
                {sim.data!.directory.filter((d) => d.company_id === c.id).map((d) => (
                  <li key={d.employee_ref} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span>{d.full_name} <span className="text-ink-500">· {d.employee_ref}</span> {!d.active && <Badge tone="warning"><Text>Suspended by the company</Text></Badge>}</span>
                    <Button size="sm" variant="secondary" onClick={() => void employee.run(c.id, d.employee_ref, !d.active)} disabled={employee.pending}><Text>{d.active ? 'Suspend at the company' : 'Reactivate at the company'}</Text></Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        <p className="text-sm text-ink-500"><Text>Printable labels for these shipments are at /demo/labels.</Text></p>
      </div>
    </Card>
  );
}
/** Technical diagnostics belong with the company's integration settings. */
export function CourierConnectionDetails({ companyId }: { companyId: string }) {
  const monitor = useApi<Monitor>('/admin/couriers/shipments', { refreshInterval: 10_000 });
  return <section className="mb-6 rounded-lg border border-ink-200 p-4">
    <h3 className="mb-3 text-sm font-semibold text-ink-900"><Text>Connection details</Text></h3>
    <Async state={monitor} skeleton={<SkeletonStats count={1} />}>
      {(data) => {
        const provider = data.providers.find((p) => p.id === companyId);
        if (!provider) return <p className="text-sm text-ink-500"><Text>Parcel checking is not connected for this company.</Text></p>;
        return <div className="space-y-3 text-sm">
          {provider.provider_mode === 'SIMULATED' && <Badge tone="neutral"><Text>Simulated</Text></Badge>}
          <p><Text>{provider.sim_outage ? 'Demo parcel checks are switched off' : provider.provider_ok === true ? 'Last parcel check successful' : provider.provider_ok === false ? 'Last parcel check failed' : 'No parcel checks recorded yet'}</Text></p>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div><dt className="text-ink-500"><Text>Last parcel check</Text></dt><dd>{provider.provider_checked_at ? <Text>{formatDateTime(provider.provider_checked_at)}</Text> : '–'}</dd></div>
            <div><dt className="text-ink-500"><Text>Response time</Text></dt><dd>{provider.provider_latency_ms != null ? <Text>{`${provider.provider_latency_ms} ms`}</Text> : '–'}</dd></div>
            <div><dt className="text-ink-500"><Text>Failed checks, last 24 hours</Text></dt><dd>{provider.failures_24h}</dd></div>
          </dl>
          {provider.provider_error && provider.provider_ok === false && <p className="break-words rounded-md bg-ink-50 p-3 font-mono text-xs">{provider.provider_error}</p>}
          <p className="text-xs text-ink-500"><Text>This is the last recorded result, not a live connection test.</Text></p>
        </div>;
      }}
    </Async>
  </section>;
}
