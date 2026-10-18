'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui/card';
import { Text } from '@/components/ui/localized-text';
import { Tabs, TabPanel } from '@/components/ui/tabs';
import Loading from './loading';
import './parcel-workspace.css';
import { IncidentBoard } from '@/components/features/incident-board';
import GuardhouseSummary from '../parcels/summary';
import { TodayTab } from '../lockers/today';
import { OverviewTab } from '../lockers/overview';
import { ParcelsTab } from '../lockers/parcels';
import { RelocationsTab } from '../lockers/relocations';
import { CounterTab, DirectCounterDeliveries, StorageLocationsTab } from '../lockers/counter';
import { SecurityTab } from '../lockers/security';
import { StationsTab } from '../lockers/stations';
import { CompaniesTab } from '../lockers/companies';
import { CouriersTab } from '../lockers/couriers';
import { ShipmentsTab, SimulatedCompanies } from '../lockers/shipments';
import { PolicyTab } from '../lockers/policy';
import { Deadlines } from '../incidents/deadlines';

const TABS = [
  { key: 'performance', label: 'Performance' }, { key: 'today', label: 'Today' },
  { key: 'guardhouse', label: 'Guardhouse parcels' }, { key: 'lockers', label: 'Smart lockers' },
  { key: 'manage', label: 'Manage' },
] as const;
type Tab = typeof TABS[number]['key'];
const GUARDHOUSE = [
  { key: 'overview', label: 'Overview' }, { key: 'cases', label: 'Cases & reports' },
] as const;
const LOCKERS = [
  { key: 'parcels', label: 'Parcels' }, { key: 'storage', label: 'Parcel storage' },
  { key: 'access', label: 'Emergency door access' },
  { key: 'cases', label: 'Cases & reports' },
] as const;
const STORAGE_MODES = [
  { key: 'movement', label: 'Transfer to storage' },
  { key: 'collection', label: 'Resident collection' },
] as const;
const MANAGE = [
  { key: 'stations', label: 'Stations' }, { key: 'storage', label: 'Storage locations' }, { key: 'companies', label: 'Courier companies' },
  { key: 'accounts', label: 'Courier accounts' },
  { key: 'shipments', label: 'Parcel check history' },
  { key: 'policy', label: 'Locker policy' }, { key: 'deadlines', label: 'Case deadlines' },
  { key: 'simulated', label: 'Simulated courier companies' },
] as const;

export default function OperationsPage() {
  return <Suspense fallback={<Loading />}><Operations /></Suspense>;
}

function Operations() {
  const search = useSearchParams();
  const router = useRouter();
  const legacyCases = search.get('tab') === 'cases';
  const legacyGuardhouseCases = legacyCases && search.get('area') === 'PARCELS';
  const tab = legacyCases ? (legacyGuardhouseCases ? 'guardhouse' : 'lockers') : TABS.find((item) => item.key === search.get('tab'))?.key ?? 'performance';
  const guardhouse = legacyGuardhouseCases ? 'cases' : GUARDHOUSE.find((item) => item.key === search.get('view'))?.key ?? 'overview';
  const requestedLockerView = search.get('view');
  const legacyStorageView = requestedLockerView === 'move' || requestedLockerView === 'collect';
  const locker = legacyCases && !legacyGuardhouseCases ? 'cases' : legacyStorageView ? 'storage' : LOCKERS.find((item) => item.key === requestedLockerView)?.key ?? 'parcels';
  const storageMode = (legacyStorageView ? (requestedLockerView === 'collect' ? 'collection' : 'movement') : STORAGE_MODES.find((item) => item.key === search.get('mode'))?.key) ?? 'movement';
  const manage = MANAGE.find((item) => item.key === search.get('view'))?.key ?? 'stations';
  const navigate = (next: Tab, view?: string, task?: string, mode?: string) => {
    const params = new URLSearchParams({ tab: next });
    if (view) params.set('view', view);
    if (task) params.set('task', task);
    if (mode) params.set('mode', mode);
    router.push('/console/operations?' + params.toString(), { scroll: false });
  };
  const reference = search.get('ref');
  return <div className="parcel-workspace">
    <PageHeader title="Parcels" description="Manage guardhouse parcels, smart lockers and parcel-related cases." />
    <Tabs<Tab> label="Parcels" value={tab} onChange={(next) => navigate(next)} items={[...TABS]} />
    <TabPanel>
      <div className="parcel-view" key={`${tab}:${tab === 'lockers' ? `${locker}:${storageMode}` : tab === 'manage' ? manage : guardhouse}`}>
      {tab === 'today' && <TodayTab allCases
        onPerformance={() => navigate('performance')}
        onMove={(id) => navigate('lockers', 'storage', id, 'movement')}
        onParcels={() => navigate('lockers')}
        onStations={() => navigate('manage', 'stations')}
      />}
      {tab === 'guardhouse' && <>
        <Tabs label="Guardhouse parcels" value={guardhouse} onChange={(view) => navigate('guardhouse', view)} items={[...GUARDHOUSE]} />
        {guardhouse === 'overview' && <GuardhouseSummary />}
        {guardhouse === 'cases' && <section className="space-y-5">
          <div><h2 className="font-display text-xl font-bold text-ink-900"><Text>Guardhouse parcel cases</Text></h2>
            <p className="mt-1 text-sm text-ink-500"><Text>Only reports about parcels logged and handed over at the guardhouse.</Text></p></div>
          <IncidentBoard key={search.toString()} modules={['PARCELS']}
            openRef={reference && /^INC-\d+$/.test(reference) ? reference : null}
            initialDisputed={search.get('disputed') === '1'} initialOverdue={search.get('overdue') === '1'} />
        </section>}
      </>}
      {tab === 'performance' && <section className="space-y-5">
        <div><h2 className="font-display text-xl font-bold text-ink-900"><Text>Performance & station details</Text></h2>
          <p className="mt-1 text-sm text-ink-500"><Text>Locker capacity, collection performance and station activity.</Text></p></div>
        <OverviewTab showAlerts={false} />
      </section>}
      {tab === 'lockers' && <>
        <Tabs label="Smart lockers" value={locker} onChange={(view) => navigate('lockers', view)} items={[...LOCKERS]} />
        {locker === 'parcels' && <ParcelsTab />}
        {locker === 'storage' && <section>
          <Tabs label="Parcel storage" value={storageMode} onChange={(mode) => navigate('lockers', 'storage', undefined, mode)} items={[...STORAGE_MODES]} />
          {storageMode === 'movement' && <div className="space-y-6">
            <DirectCounterDeliveries />
            <RelocationsTab taskId={search.get('task')} onClearTask={() => navigate('lockers', 'storage', undefined, 'movement')} />
          </div>}
          {storageMode === 'collection' && <CounterTab />}
        </section>}
        {locker === 'access' && <SecurityTab />}
        {locker === 'cases' && <section className="space-y-5">
          <div><h2 className="font-display text-xl font-bold text-ink-900"><Text>Smart locker cases</Text></h2>
            <p className="mt-1 text-sm text-ink-500"><Text>Only smart-locker and courier-platform cases.</Text></p></div>
          <IncidentBoard key={search.toString()} modules={['LOCKERS', 'COURIERS']}
            openRef={reference && /^INC-\d+$/.test(reference) ? reference : null}
            initialOverdue={search.get('overdue') === '1'} />
        </section>}
      </>}
      {tab === 'manage' && <div className="min-w-0 space-y-6">
        <div className="sticky top-16 z-20 rounded-xl border border-ink-200 bg-white/95 p-2 shadow-sm backdrop-blur-md">
          <nav className="flex gap-1 overflow-x-auto">
            {MANAGE.map((item) => <Link key={item.key} href={`/console/operations?tab=manage&view=${item.key}`} scroll={false} aria-current={manage === item.key ? 'page' : undefined}
              className={`block shrink-0 whitespace-nowrap rounded-lg px-4 py-3 text-sm font-semibold transition-colors focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand-600 ${manage === item.key ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900'}`}>
              <Text>{item.label}</Text>
            </Link>)}
          </nav>
        </div>
        <div className="min-w-0">
        {manage === 'stations' && <StationsTab />}
        {manage === 'storage' && <StorageLocationsTab />}
        {manage === 'companies' && <CompaniesTab />}
        {manage === 'accounts' && <CouriersTab />}
        {manage === 'shipments' && <ShipmentsTab />}
        {manage === 'simulated' && <SimulatedCompanies />}
        {manage === 'policy' && <PolicyTab />}
        {manage === 'deadlines' && <Deadlines />}
        </div>
      </div>}
      </div>
    </TabPanel>
  </div>;
}
