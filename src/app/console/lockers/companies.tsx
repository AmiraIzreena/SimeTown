'use client';

import { Text } from '@/components/ui/localized-text';
import { CopyButton } from '@/components/ui/copy-button';
import { LocalizedButton } from '@/components/ui/localized-elements';

import { Building2, CheckCircle2, ChevronDown, Plug, Plus, ShieldOff, UserPlus, Warehouse, XCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState, SkeletonList } from '@/components/ui/feedback';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/field';
import { FilterBar, FilterChips, FilterMenu, FilterSummary, SearchField } from '@/components/ui/filter-bar';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { useIsAdmin, type Overview } from './overview';
import { CourierConnectionDetails } from './shipments';

type AuthMethod = 'MANUAL' | 'COMPANY_MANAGED' | 'FEDERATED';
type ProviderMode = 'NONE' | 'SIMULATED' | 'GATEWAY';
interface Company {
  id: string;
  name: string;
  code: string | null;
  active: boolean;
  auth_method: AuthMethod;
  provider_mode: ProviderMode;
  provider_url: string | null;
  provider_secret_env: string | null;
  can_confirm_assignment: boolean;
  tracking_pattern: string | null;
  idp_mode: 'SIMULATED' | 'OIDC' | null;
  idp_issuer: string | null;
  idp_client_id: string | null;
  idp_client_secret_env: string | null;
  webhook_secret_env: string | null;
  require_mfa: boolean;
  sim_outage: boolean;
  support_name: string | null;
  support_url: string | null;
  support_phone: string | null;
  support_verified_at: string | null;
  provider_checked_at: string | null;
  provider_ok: boolean | null;
  provider_error: string | null;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | null;
  verified_note: string | null;
  agreement_ref: string | null;
  agreement_until: string | null;
  agreement_expired: boolean | null;
  min_assurance: 'HIGH' | 'MEDIUM' | null;
  allow_fallback: boolean | null;
  status_reason: string | null;
  stations: { id: string; name: string }[];
  managers: { userId: string; fullName: string; email: string; status: string }[];
  couriers_active: number;
  couriers_inactive: number;
  deliveries_30d: number;
  history: { action: string; note: string | null; at: string; actor: string | null }[];
}

const STATUS = {
  PENDING: { label: 'Waiting for approval', tone: 'gold' as const },
  ACTIVE: { label: 'Approved', tone: 'success' as const },
  SUSPENDED: { label: 'Suspended', tone: 'warning' as const },
  REVOKED: { label: 'Revoked', tone: 'danger' as const },
};
export const AUTH_LABELS: Record<AuthMethod, string> = {
  MANUAL: 'Couriers approved one by one',
  COMPANY_MANAGED: 'The company manages its couriers',
  FEDERATED: 'Couriers sign in with the company’s sign-in',
};
export const PROVIDER_LABELS: Record<ProviderMode, string> = {
  NONE: 'Shipments not checked (delivery code needed)',
  SIMULATED: 'Shipments checked with a simulated company',
  GATEWAY: 'Shipments checked with the company’s system',
};
const HISTORY_LABELS: Record<string, string> = {
  ONBOARDING_STARTED: 'Onboarding started', APPROVED: 'Approved', TERMS_CHANGED: 'Terms changed', SUSPENDED: 'Suspended', REVOKED: 'Revoked',
  STATIONS_CHANGED: 'Stations changed', REPRESENTATIVE_ADDED: 'Representative added', REPRESENTATIVE_REMOVED: 'Representative removed',
  INTEGRATION_CHANGED: 'Integration changed', COURIER_ADDED: 'Courier added', COURIER_ACTIVE: 'Courier reactivated', COURIER_SUSPENDED: 'Courier suspended',
  COURIER_REVOKED: 'Courier removed', COURIER_RECONFIRMED: 'Courier reconfirmed', AGREEMENT_ENDED: 'Agreement ended',
  SIMULATED_OUTAGE_ON: 'Simulated outage on', SIMULATED_OUTAGE_OFF: 'Simulated outage off',
};

/** Courier companies, approved once per township; their own managers then look after their couriers. */
export function CompaniesTab() {
  const companies = useApi<Company[]>('/admin/couriers/companies');
  const lockerOverview = useApi<Overview>('/admin/lockers');
  const t = useT();
  const [search, setSearch] = useState('');
  const [approvalFilter, setApprovalFilter] = useState('');
  const [stationFilter, setStationFilter] = useState('');
  const [agreementFilter, setAgreementFilter] = useState('');
  const [sort, setSort] = useState('az');
  const stationOptions = (lockerOverview.data?.stations ?? []).map((station) => ({ id: station.id, name: station.name })).sort((a, b) => a.name.localeCompare(b.name));
  const searchTerms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matchingCompanies = (companies.data ?? []).filter((company) => {
    const text = [company.name, company.code, ...company.managers.flatMap((person) => [person.fullName, person.email])].filter(Boolean).join(' ').toLocaleLowerCase();
    return searchTerms.every((term) => text.includes(term))
      && (!approvalFilter || (company.status ?? 'NONE') === approvalFilter)
      && (!stationFilter || (stationFilter === 'NONE' ? company.stations.length === 0 : company.stations.some((station) => station.id === stationFilter)))
      && (!agreementFilter || (agreementFilter === 'NONE' ? !company.agreement_until : agreementFilter === 'EXPIRED' ? Boolean(company.agreement_expired) : Boolean(company.agreement_until) && !company.agreement_expired));
  }).sort((a, b) => {
    const nameOrder = a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || a.id.localeCompare(b.id);
    if (sort === 'za') return -nameOrder;
    if (sort === 'deliveries') return b.deliveries_30d - a.deliveries_30d || nameOrder;
    if (sort === 'couriers') return b.couriers_active - a.couriers_active || nameOrder;
    if (sort === 'agreement') {
      if (!a.agreement_until) return b.agreement_until ? 1 : nameOrder;
      if (!b.agreement_until) return -1;
      return new Date(a.agreement_until).getTime() - new Date(b.agreement_until).getTime() || nameOrder;
    }
    return nameOrder;
  });
  const selectedStationName = stationOptions.find((station) => station.id === stationFilter)?.name;
  const noCompaniesMessage = search
    ? t('No courier companies match your search and filters.')
    : stationFilter === 'NONE'
      ? t('No courier companies are without a locker station.')
      : selectedStationName
        ? t('No courier companies cover {station} yet.', { station: selectedStationName })
        : approvalFilter
          ? t('No courier companies have this approval status.')
          : agreementFilter
            ? t('No courier companies match this agreement filter.')
            : t('Try another search or reset the company filters.');
  const isAdmin = useIsAdmin();
  const [onboarding, setOnboarding] = useState(false);
  const [deciding, setDeciding] = useState<{ company: Company; status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' } | null>(null);
  const [stations, setStations] = useState<Company | null>(null);
  const [inviting, setInviting] = useState<Company | null>(null);
  const [integration, setIntegration] = useState<Company | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const refresh = () => void companies.mutate();
  const removeRep = useAction((companyId: string, userId: string) => api.post(`/admin/couriers/companies/${companyId}/representatives/${userId}/remove`), { success: 'Representative removed.', onSuccess: refresh });
  const outage = useAction((id: string, down: boolean) => api.post(`/admin/couriers/companies/${id}/simulated-outage`, { down }), { onSuccess: refresh });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="font-display text-xl font-bold text-ink-900"><Text>Courier companies</Text></h2>
          <p className="mt-1 text-sm text-ink-500"><Text>Manage each company’s agreement, stations and representatives.</Text></p>
        </div>
        {isAdmin && <Button size="sm" onClick={() => setOnboarding(true)}><Plus className="size-4" aria-hidden /><Text>Onboard a company</Text></Button>}
      </div>
      <FilterBar
        search={<SearchField label="Search courier companies" placeholder="Name, company code or representative" value={search} onChange={setSearch} />}
        chips={<FilterChips label="Approval status" value={approvalFilter} onChange={setApprovalFilter} options={[
          { key: '', label: 'All approval statuses', count: (companies.data ?? []).length },
          ...Object.entries(STATUS).map(([value, status]) => ({ key: value, label: status.label, count: (companies.data ?? []).filter((company) => company.status === value).length, alert: value === 'PENDING' })),
          { key: 'NONE', label: 'Not approved here', count: (companies.data ?? []).filter((company) => !company.status).length },
        ]} />}
        controls={<>
          <FilterMenu label="Area covered (station)" value={stationFilter} onChange={setStationFilter} options={[
            { value: '', label: 'All stations' },
            { value: 'NONE', label: 'No stations yet' },
            ...stationOptions.map((station) => ({ value: station.id, label: station.name, raw: true })),
          ]} />
          <FilterMenu label="Agreement" value={agreementFilter} onChange={setAgreementFilter} options={[
            { value: '', label: 'All agreements' },
            { value: 'VALID', label: 'Agreement not expired' },
            { value: 'EXPIRED', label: 'Agreement ended' },
            { value: 'NONE', label: 'No agreement end date' },
          ]} />
          <FilterMenu label="Sort" value={sort} onChange={setSort} options={[
            { value: 'az', label: 'Name: A–Z' },
            { value: 'za', label: 'Name: Z–A' },
            { value: 'deliveries', label: 'Most deliveries, last 30 days' },
            { value: 'couriers', label: 'Most active couriers' },
            { value: 'agreement', label: 'Agreement ending soonest' },
          ]} />
        </>}
        summary={companies.data && <FilterSummary shown={matchingCompanies.length} total={companies.data.length} noun="courier companies" onClear={search || approvalFilter || stationFilter || agreementFilter || sort !== 'az' ? () => { setSearch(''); setApprovalFilter(''); setStationFilter(''); setAgreementFilter(''); setSort('az'); } : undefined} />}
      />
        <Async state={companies} skeleton={<div className="p-5"><SkeletonList rows={3} /></div>}>
          {(rows) => rows.length === 0 ? (
            <div className="p-5"><EmptyState icon={Building2} title="No courier companies yet"><Text>Onboard the first one.</Text></EmptyState></div>
          ) : matchingCompanies.length === 0 ? (
            <EmptyState icon={Building2} title={search ? 'No matching companies' : 'No courier companies found'}>{noCompaniesMessage}</EmptyState>
          ) : (
            <ul className="space-y-6">
              {matchingCompanies.map((c) => (
                <li key={c.id}>
                <Card className="space-y-4 p-5 sm:p-6">
                  <div className="space-y-4">
                    <div className="min-w-0 space-y-1">
                      <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink-900">
                        {c.name} {c.code && <span className="font-normal text-ink-500">· {c.code}</span>}
                        {c.status ? <Badge tone={STATUS[c.status].tone}><Text>{STATUS[c.status].label}</Text></Badge> : <Badge tone="neutral"><Text>Not approved here</Text></Badge>}
                        {c.agreement_expired && <Badge tone="danger"><Text>Agreement ended</Text></Badge>}
                        {(c.provider_mode === 'SIMULATED' || c.idp_mode === 'SIMULATED') && <Badge tone="neutral"><Text>Simulated</Text></Badge>}
                      </p>
                      <p className="text-sm text-ink-600"><Text>{AUTH_LABELS[c.auth_method]}</Text> · <Text>{PROVIDER_LABELS[c.provider_mode]}</Text>{c.can_confirm_assignment && <> · <Text>confirms which courier carries each shipment</Text></>}</p>
                      <p className="text-sm text-ink-500">
                        <Text>{c.stations.length ? `Stations: ${c.stations.map((s) => s.name).join(', ')}` : 'No stations yet'}</Text>
                        {' · '}<Text>{c.agreement_until ? `Agreement until ${formatDate(c.agreement_until)}` : 'No agreement end date'}</Text>
                        {' · '}<Text>{`${c.couriers_active} active couriers, ${c.deliveries_30d} deliveries in 30 days`}</Text>
                      </p>
                      {c.status_reason && c.status !== 'ACTIVE' && <p className="text-sm text-warning-700"><Text>{c.status_reason}</Text></p>}
                      {c.provider_mode !== 'NONE' && c.provider_checked_at && (
                        <p className={c.provider_ok ? 'text-sm text-success-700' : 'text-sm text-accent-700'}>
                          <Text>{c.provider_ok ? `Shipment checks answering (last ${timeAgo(c.provider_checked_at)})` : `Shipment checks failing: ${c.provider_error ?? ''}`}</Text>
                        </p>
                      )}
                    </div>
                    {isAdmin && (
                      <div className="space-y-3 border-t border-ink-100 pt-4">
                        <div className="flex flex-wrap gap-2">
                        {c.status !== 'ACTIVE' && c.status !== 'REVOKED' && <Button size="sm" onClick={() => setDeciding({ company: c, status: 'ACTIVE' })}><CheckCircle2 className="size-4" aria-hidden /><Text>Approve</Text></Button>}
                        {c.status === 'ACTIVE' && <Button size="sm" variant="secondary" onClick={() => setDeciding({ company: c, status: 'ACTIVE' })}><Text>Terms</Text></Button>}
                        {c.status && <Button size="sm" variant="secondary" onClick={() => setStations(c)}><Warehouse className="size-4" aria-hidden /><Text>Stations</Text></Button>}
                        {c.status === 'ACTIVE' && c.auth_method !== 'MANUAL' && <Button size="sm" variant="secondary" onClick={() => setInviting(c)}><UserPlus className="size-4" aria-hidden /><Text>Add representative</Text></Button>}
                        <Button size="sm" variant="secondary" onClick={() => setIntegration(c)}><Plug className="size-4" aria-hidden /><Text>Integration</Text></Button>
                        </div>
                        {((c.status && c.status !== 'REVOKED') || c.provider_mode === 'SIMULATED') && <details className="rounded-lg border border-ink-100 bg-ink-50/50 p-3">
                          <summary className="cursor-pointer text-sm font-semibold text-ink-600"><Text>Access controls & demo tools</Text></summary>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {c.status === 'ACTIVE' && <Button size="sm" variant="secondary" onClick={() => setDeciding({ company: c, status: 'SUSPENDED' })}><ShieldOff className="size-4" aria-hidden /><Text>Suspend</Text></Button>}
                            {c.status && c.status !== 'REVOKED' && <Button size="sm" variant="danger" onClick={() => setDeciding({ company: c, status: 'REVOKED' })}><XCircle className="size-4" aria-hidden /><Text>Revoke</Text></Button>}
                            {c.provider_mode === 'SIMULATED' && <Button size="sm" variant="secondary" onClick={() => void outage.run(c.id, !c.sim_outage)} disabled={outage.pending}><Text>{c.sim_outage ? 'Bring simulated system back' : 'Simulate an outage'}</Text></Button>}
                          </div>
                        </details>}
                      </div>
                    )}
                  </div>
                  {c.managers.length > 0 && (
                    <p className="flex flex-wrap items-center gap-2 text-sm text-ink-700">
                      <Text>Representatives:</Text>
                      {c.managers.map((m) => (
                        <span key={m.userId} className="inline-flex items-center gap-1 rounded-full bg-ink-50 px-2.5 py-0.5">
                          {m.fullName}{m.status !== 'ACTIVE' && <> · <Text>removed</Text></>}
                          {isAdmin && m.status === 'ACTIVE' && <LocalizedButton type="button" className="text-ink-400 hover:text-accent-700" onClick={() => void removeRep.run(c.id, m.userId)} aria-label={`Remove ${m.fullName}`}>×</LocalizedButton>}
                        </span>
                      ))}
                    </p>
                  )}
                  {c.history.length > 0 && (
                    <div>
                      <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
                        <ChevronDown className={open === c.id ? 'size-4 rotate-180' : 'size-4'} aria-hidden /><Text>Access history</Text>
                      </button>
                      {open === c.id && (
                        <ul className="mt-2 space-y-1 text-sm text-ink-600">
                          {c.history.map((h, i) => <li key={i}><span className="tabular-nums text-ink-500"><Text>{formatDateTime(h.at)}</Text></span> · <Text>{HISTORY_LABELS[h.action] ?? h.action}</Text>{h.note && <> · {h.note}</>}{h.actor && <> · {h.actor}</>}</li>)}
                        </ul>
                      )}
                    </div>
                  )}
                </Card>
                </li>
              ))}
            </ul>
          )}
        </Async>


      <Onboard open={onboarding} onClose={() => setOnboarding(false)} onDone={refresh} />
      {deciding && <Decide key={`${deciding.company.id}-${deciding.status}`} company={deciding.company} status={deciding.status} onClose={() => setDeciding(null)} onDone={refresh} />}
      {stations && <Stations key={stations.id} company={stations} onClose={() => setStations(null)} onDone={refresh} />}
      {inviting && <Representative company={inviting} onClose={() => setInviting(null)} onInvited={(token) => { setLink(`${window.location.origin}/invite#${token}`); refresh(); }} />}
      {integration && <Integration key={integration.id} company={integration} onClose={() => setIntegration(null)} onDone={refresh} />}
      <Modal open={link !== null} onClose={() => setLink(null)} title="Send this link to the representative" description="It works once, for 7 days. Send it only to the person the company named, through a channel you trust.">
        <div className="space-y-3">
          <p className="break-all rounded-md bg-ink-50 p-3 font-mono text-sm text-ink-900">{link}</p>
          <CopyButton size="sm" variant="secondary" text={link ?? ''} label="Copy" />
        </div>
      </Modal>
    </div>
  );
}

function IntegrationFields({ value, onChange }: { value: Partial<Company>; onChange: (v: Partial<Company>) => void }) {
  const set = (patch: Partial<Company>) => onChange({ ...value, ...patch });
  return (
    <>
      <Select label="How couriers get access" value={value.auth_method ?? 'MANUAL'} onChange={(event) => set({ auth_method: event.target.value as AuthMethod })}>
        <option value="MANUAL"><Text>{AUTH_LABELS.MANUAL}</Text></option>
        <option value="COMPANY_MANAGED"><Text>{AUTH_LABELS.COMPANY_MANAGED}</Text></option>
        <option value="FEDERATED"><Text>{AUTH_LABELS.FEDERATED}</Text></option>
      </Select>
      <Select label="How shipments are checked" value={value.provider_mode ?? 'NONE'} onChange={(event) => set({ provider_mode: event.target.value as ProviderMode })}>
        <option value="NONE"><Text>{PROVIDER_LABELS.NONE}</Text></option>
        <option value="SIMULATED"><Text>Simulated company (demo)</Text></option>
        <option value="GATEWAY"><Text>The company’s system, through SimeTown’s signed contract</Text></option>
      </Select>
      {value.provider_mode === 'GATEWAY' && (
        <>
          <Input label="Provider address (https)" value={value.provider_url ?? ''} onChange={(event) => set({ provider_url: event.target.value })} placeholder="https://lockers.courier.example" />
          <Input label="Secret: environment variable name" value={value.provider_secret_env ?? ''} onChange={(event) => set({ provider_secret_env: event.target.value.toUpperCase() })} placeholder="JNT_PROVIDER_SECRET" hint="The secret itself stays in the server’s settings, never here." />
        </>
      )}
      {value.provider_mode !== 'NONE' && <Checkbox label="The provider says which courier carries each shipment" checked={value.can_confirm_assignment ?? false} onChange={(event) => set({ can_confirm_assignment: event.target.checked })} />}
      <Input label="Tracking number pattern (optional)" value={value.tracking_pattern ?? ''} onChange={(event) => set({ tracking_pattern: event.target.value })} placeholder="JT[0-9]{12}" hint="A regular expression. A match only rules out typos; it proves nothing about the shipment." />
      {value.auth_method === 'FEDERATED' && (
        <>
          <Select label="Sign-in provider" value={value.idp_mode ?? 'SIMULATED'} onChange={(event) => set({ idp_mode: event.target.value as 'SIMULATED' | 'OIDC' })}>
            <option value="SIMULATED"><Text>Simulated company sign-in (demo)</Text></option>
            <option value="OIDC"><Text>The company’s OpenID Connect provider</Text></option>
          </Select>
          {value.idp_mode === 'OIDC' && (
            <>
              <Input label="Issuer (https)" value={value.idp_issuer ?? ''} onChange={(event) => set({ idp_issuer: event.target.value })} />
              <Input label="Client id" value={value.idp_client_id ?? ''} onChange={(event) => set({ idp_client_id: event.target.value })} />
              <Input label="Client secret: environment variable name" value={value.idp_client_secret_env ?? ''} onChange={(event) => set({ idp_client_secret_env: event.target.value.toUpperCase() })} />
            </>
          )}
          <Checkbox label="Require a second sign-in step (MFA) at the company" checked={value.require_mfa ?? false} onChange={(event) => set({ require_mfa: event.target.checked })} />
        </>
      )}
      {value.auth_method !== 'MANUAL' && (
        <Input label="Courier status messages: environment variable name (optional)" value={value.webhook_secret_env ?? ''} onChange={(event) => set({ webhook_secret_env: event.target.value.toUpperCase() })} hint="Lets the company suspend couriers here from its own system, with signed messages." />
      )}
    </>
  );
}

const integrationBody = (v: Partial<Company>) => ({
  authMethod: v.auth_method ?? 'MANUAL', providerMode: v.provider_mode ?? 'NONE', providerUrl: v.provider_url || null, providerSecretEnv: v.provider_secret_env || null,
  canConfirmAssignment: v.can_confirm_assignment ?? false, trackingPattern: v.tracking_pattern || null,
  idpMode: v.auth_method === 'FEDERATED' ? v.idp_mode ?? 'SIMULATED' : null, idpIssuer: v.idp_issuer || null, idpClientId: v.idp_client_id || null,
  idpClientSecretEnv: v.idp_client_secret_env || null, webhookSecretEnv: v.webhook_secret_env || null, requireMfa: v.require_mfa ?? false,
});

function Onboard({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState<Partial<Company>>({ auth_method: 'COMPANY_MANAGED', provider_mode: 'NONE' });
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const save = useAction(() => api.post('/admin/couriers/companies', { name: name.trim(), code: code.trim(), ...integrationBody(value) }), {
    success: 'Company added. Approve it once its identity is checked.',
    onSuccess: () => {
      onClose();
      onDone();
    },
  });
  return (
    <Modal open={open} onClose={onClose} title="Onboard a courier company" wide description="It can do nothing until an admin records how its identity was checked and approves it." footer={<><Button variant="secondary" onClick={onClose}><Text>Cancel</Text></Button><Button onClick={() => void save.run()} pending={save.pending} disabled={name.trim().length < 2 || code.trim().length < 2}><Text>Add</Text></Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Company name" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} error={save.fields.name} />
        <Input label="Short code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} maxLength={12} hint="Letters and numbers, such as JNT." error={save.fields.code} />
        <IntegrationFields value={value} onChange={setValue} />
      </div>
    </Modal>
  );
}

function Integration({ company, onClose, onDone }: { company: Company; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState<Partial<Company>>(company);
  const isAdmin = useIsAdmin();
  const save = useAction(() => api.patch(`/admin/couriers/companies/${company.id}/integration`, integrationBody(value)), {
    success: 'Integration saved.',
    onSuccess: () => {
      onClose();
      onDone();
    },
  });
  const [support, setSupport] = useState({ name: company.support_name ?? '', url: company.support_url ?? '', phone: company.support_phone ?? '' });
  const saveSupport = useAction(() => api.post(`/admin/couriers/companies/${company.id}/support`, { name: support.name.trim(), url: support.url.trim() || null, phone: support.phone.trim() || null }), {
    success: 'Support channel recorded.',
    onSuccess: onDone,
  });
  return (
    <Modal open onClose={onClose} title={`${company.name}: integration`} wide description="No courier company’s real system is connected unless it has agreed to integrate and its credentials are in the server’s settings." footer={isAdmin ? <><Button variant="secondary" onClick={onClose}><Text>Cancel</Text></Button><Button onClick={() => void save.run()} pending={save.pending}><Text>Save</Text></Button></> : undefined}>
      <CourierConnectionDetails companyId={company.id} />
      <div className="grid gap-4 sm:grid-cols-2"><IntegrationFields value={value} onChange={setValue} /></div>
      <div className="mt-6 space-y-3 border-t border-ink-100 pt-5">
        <p className="text-sm font-semibold text-ink-900"><Text>Support channel for residents</Text></p>
        <p className="text-sm text-ink-600"><Text>Residents with a delivery problem are sent here. Record only what the company has confirmed to you; SimeTown never guesses a link or a number.</Text>
          {company.support_verified_at && <> <Text>{`Last checked ${formatDate(company.support_verified_at)}.`}</Text></>}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="Name" value={support.name} onChange={(event) => setSupport({ ...support, name: event.target.value })} maxLength={120} placeholder="Customer service" />
          <Input label="Support page (https)" value={support.url} onChange={(event) => setSupport({ ...support, url: event.target.value })} maxLength={300} />
          <Input label="Phone" value={support.phone} onChange={(event) => setSupport({ ...support, phone: event.target.value })} maxLength={30} />
        </div>
        {isAdmin && <Button size="sm" variant="secondary" onClick={() => void saveSupport.run()} pending={saveSupport.pending} disabled={support.name.trim().length < 2}><Text>Record as checked</Text></Button>}
      </div>
    </Modal>
  );
}

function Decide({ company, status, onClose, onDone }: { company: Company; status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED'; onClose: () => void; onDone: () => void }) {
  const decide = useAction((body: Record<string, unknown>) => api.post(`/admin/couriers/companies/${company.id}/decision`, body), {
    success: status === 'ACTIVE' ? 'Saved.' : 'Done. The company’s couriers were signed out at once.',
    onSuccess: () => {
      onClose();
      onDone();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    if (status !== 'ACTIVE') return void decide.run({ status, reason: String(f.get('reason') ?? '').trim() });
    const until = String(f.get('agreementUntil') ?? '');
    void decide.run({
      status, verifiedNote: String(f.get('verifiedNote') ?? '').trim() || undefined, agreementRef: String(f.get('agreementRef') ?? '').trim() || undefined,
      agreementUntil: until || null, minAssurance: f.get('minAssurance') as 'HIGH' | 'MEDIUM', allowFallback: f.get('allowFallback') === 'on',
    });
  };
  const title = status === 'ACTIVE' ? (company.status === 'ACTIVE' ? `${company.name}: terms` : `Approve ${company.name}`) : status === 'SUSPENDED' ? `Suspend ${company.name}` : `Revoke ${company.name}`;
  return (
    <Modal open onClose={onClose} title={title} footer={<><Button variant="secondary" onClick={onClose}><Text>Cancel</Text></Button><Button type="submit" form="decide-company" pending={decide.pending} variant={status === 'ACTIVE' ? 'primary' : 'danger'}><Text>{status === 'ACTIVE' ? 'Save' : status === 'SUSPENDED' ? 'Suspend now' : 'Revoke'}</Text></Button></>}>
      <form method="post" id="decide-company" onSubmit={submit} className="grid gap-4" noValidate>
        {status === 'ACTIVE' ? (
          <>
            <Textarea label="How the company’s identity was checked" name="verifiedNote" defaultValue={company.verified_note ?? ''} maxLength={300} required hint="For example: SSM registration checked, agreement signed by the regional manager." />
            <Input label="Agreement reference (optional)" name="agreementRef" defaultValue={company.agreement_ref ?? ''} maxLength={80} />
            <Input label="Agreement ends (optional)" name="agreementUntil" type="date" defaultValue={company.agreement_until ?? ''} />
            <Select label="Assurance needed without a delivery code" name="minAssurance" defaultValue={company.min_assurance ?? 'MEDIUM'}>
              <option value="MEDIUM"><Text>The company confirms the shipment</Text></option>
              <option value="HIGH"><Text>The company also confirms which courier carries it</Text></option>
            </Select>
            <Checkbox label="When the company’s system is down, couriers may use the resident’s delivery code" name="allowFallback" defaultChecked={company.allow_fallback ?? true} />
          </>
        ) : (
          <>
            <p className="text-[15px] text-ink-700"><Text>{status === 'SUSPENDED' ? 'Every courier of this company is signed out and can do nothing at the lockers until you approve the company again. Parcels already in lockers stay safe.' : 'The company loses access here for good. To work here again it must be onboarded from the start.'}</Text></p>
            <Textarea label="Reason" name="reason" maxLength={300} required />
          </>
        )}
      </form>
    </Modal>
  );
}

function Stations({ company, onClose, onDone }: { company: Company; onClose: () => void; onDone: () => void }) {
  const all = useApi<Overview>('/admin/lockers');
  const [picked, setPicked] = useState<string[]>(company.stations.map((s) => s.id));
  const save = useAction(() => api.post(`/admin/couriers/companies/${company.id}/stations`, { stationIds: picked }), {
    success: 'Stations saved.',
    onSuccess: () => {
      onClose();
      onDone();
    },
  });
  return (
    <Modal open onClose={onClose} title={`Stations for ${company.name}`} description="Every courier the company authorises can deliver at these stations, and only these." footer={<><Button variant="secondary" onClick={onClose}><Text>Cancel</Text></Button><Button onClick={() => void save.run()} pending={save.pending}><Text>Save</Text></Button></>}>
      <div className="space-y-2">
        {all.data?.stations.map((s) => (
          <Checkbox key={s.id} label={`${s.name} · ${s.location}`} checked={picked.includes(s.id)} onChange={() => setPicked((cur) => (cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id]))} />
        ))}
      </div>
    </Modal>
  );
}

function Representative({ company, onClose, onInvited }: { company: Company; onClose: () => void; onInvited: (token: string) => void }) {
  const invite = useAction((body: Record<string, unknown>) => api.post<{ inviteToken: string }>(`/admin/couriers/companies/${company.id}/representatives`, body), {
    onSuccess: (r) => {
      onClose();
      onInvited(r.inviteToken);
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const phone = String(f.get('phone') ?? '').trim();
    void invite.run({ fullName: String(f.get('fullName') ?? '').trim(), email: String(f.get('email') ?? '').trim(), phone: phone || null });
  };
  return (
    <Modal open onClose={onClose} title={`Add a representative for ${company.name}`} description="Only someone the company has named to you in writing. They manage its couriers here and cannot open lockers." footer={<><Button variant="secondary" onClick={onClose}><Text>Cancel</Text></Button><Button type="submit" form="add-rep" pending={invite.pending}><Text>Add</Text></Button></>}>
      <form method="post" id="add-rep" onSubmit={submit} className="grid gap-4" noValidate>
        <Input label="Full name" name="fullName" maxLength={120} required error={invite.fields.fullName} />
        <Input label="Work email" name="email" type="email" maxLength={254} required error={invite.fields.email} />
        <Input label="Phone (optional)" name="phone" type="tel" maxLength={20} error={invite.fields.phone} />
      </form>
    </Modal>
  );
}
