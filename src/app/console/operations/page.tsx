'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui/card';
import { ConsoleParcelWalkthrough } from '@/components/features/parcel-walkthroughs';
import { Text } from '@/components/ui/localized-text';
import { SubNav } from '@/components/ui/sub-nav';
import { Tabs, TabPanel } from '@/components/ui/tabs';
import Loading from './loading';
import './parcel-workspace.css';
import { CounterDropOffs } from '@/components/features/counter-parcels';
import { GuardhouseHandover, GuardhouseOverview, GuardhouseRegister } from '@/components/features/guardhouse-register';
import { useApi } from '@/lib/hooks';
import type { Me } from '@/lib/types';
import { TodayTab } from '../lockers/today';
import { OverviewTab } from '../lockers/overview';
import { ParcelsTab } from '../lockers/parcels';
import { StorageLocationsTab } from '../lockers/counter';
import { SecurityTab } from '../lockers/security';
import { StationsTab } from '../lockers/stations';
import { CompaniesTab } from '../lockers/companies';
import { CouriersTab } from '../lockers/couriers';
import { ShipmentsTab, SimulatedCompanies } from '../lockers/shipments';
import { PolicyTab } from '../lockers/policy';
import { Deadlines } from '../incidents/deadlines';

const TABS = [
  { key: 'performance', label: 'Performance' }, { key: 'today', label: 'Today' },
  { key: 'guardhouse', label: 'Guardhouse' }, { key: 'lockers', label: 'Smart lockers' },
  { key: 'manage', label: 'Manage' },
] as const;
type Tab = typeof TABS[number]['key'];
const LOCKERS = [
  { key: 'parcels', label: 'Parcels' }, { key: 'access', label: 'Door access' },
] as const;
const MANAGE = [
  { key: 'stations', label: 'Stations' }, { key: 'storage', label: 'Guardhouses' }, { key: 'companies', label: 'Courier companies' },
  { key: 'accounts', label: 'Courier accounts' },
  { key: 'shipments', label: 'Parcel check history' },
  { key: 'policy', label: 'Locker policy' }, { key: 'deadlines', label: 'Case deadlines' },
  { key: 'simulated', label: 'Simulated courier companies' },
] as const;

/** Parcel and locker cases are worked in Lapor, with every other report. */
const CASES = '/console/reports?tab=parcels';

export default function OperationsPage() {
  return <Suspense fallback={<Loading />}><Operations /></Suspense>;
}

function Operations() {
  const search = useSearchParams();
  const router = useRouter();
  const requestedTab = search.get('tab');
  const requestedView = search.get('view');
  // Old addresses: cases moved to Lapor; the locker "parcel counter" and "storage" views are the guardhouse now.
  const toCases = requestedTab === 'cases' || requestedView === 'cases';
  const toGuardhouse = requestedTab === 'lockers' && (requestedView === 'storage' || requestedView === 'move' || requestedView === 'collect');
  useEffect(() => {
    if (toCases) {
      const params = new URLSearchParams();
      for (const key of ['ref', 'disputed', 'overdue']) { const value = search.get(key); if (value) params.set(key, value); }
      router.replace(`${CASES}${params.size ? `&${params.toString()}` : ''}`);
    } else if (toGuardhouse) {
      router.replace('/console/operations?tab=guardhouse');
    }
  }, [toCases, toGuardhouse, search, router]);

  const tab: Tab = toGuardhouse ? 'guardhouse' : TABS.find((item) => item.key === requestedTab)?.key ?? 'performance';
  const locker = LOCKERS.find((item) => item.key === requestedView)?.key ?? 'parcels';
  const manage = MANAGE.find((item) => item.key === requestedView)?.key ?? 'stations';
  const navigate = (next: Tab, view?: string) => {
    const params = new URLSearchParams({ tab: next });
    if (view) params.set('view', view);
    router.push('/console/operations?' + params.toString(), { scroll: false });
  };
  if (toCases) return <Loading />;
  return <div className="parcel-workspace">
    <PageHeader action={<ConsoleParcelWalkthrough />} title="Parcels" description="Smart lockers and the guardhouse: today’s work, every parcel held at the guardhouse, and locker performance. Parcel cases are in Lapor." />
    <Tabs<Tab> label="Parcels" value={tab} onChange={(next) => navigate(next)} items={[...TABS]} />
    <TabPanel>
      <div className="parcel-view" key={`${tab}:${tab === 'lockers' ? locker : tab === 'manage' ? manage : ''}`}>
      {tab === 'today' && <TodayTab
        onPerformance={() => navigate('performance')}
        onGuardhouse={() => navigate('guardhouse')}
        onParcels={() => navigate('lockers')}
        onStations={() => navigate('manage', 'stations')}
        casesHref={CASES}
      />}
      {tab === 'guardhouse' && <GuardhouseTab />}
      {tab === 'performance' && <section className="space-y-5">
        <div><h2 className="font-display text-xl font-bold text-ink-900"><Text>Performance & station details</Text></h2>
          <p className="mt-1 text-sm text-ink-500"><Text>Every locker bank and the guardhouse: doors in use, waiting times and collections.</Text></p></div>
        <OverviewTab showAlerts={false} />
      </section>}
      {tab === 'lockers' && <>
        <SubNav label="Smart lockers" value={locker} items={LOCKERS} hrefOf={(view) => `/console/operations?tab=lockers&view=${view}`} className="mb-6" />
        {locker === 'parcels' && <ParcelsTab />}
        {locker === 'access' && <SecurityTab />}
      </>}
      {tab === 'manage' && <div className="min-w-0 space-y-6">
        <SubNav label="Manage" sticky value={manage} items={MANAGE} hrefOf={(view) => `/console/operations?tab=manage&view=${view}`} />
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

/** Everything held at the guardhouse: parcels on their way, handing over, the figures and the register. */
function GuardhouseTab() {
  const me = useApi<Me>('/me');
  // HQ reads every township's guardhouse; handing over happens at the township's own.
  const canHandOver = me.data ? me.data.role !== 'HQ_ADMIN' : false;
  return <div className="space-y-6">
    <GuardhouseOverview />
    <CounterDropOffs />
    {canHandOver && <GuardhouseHandover />}
    <GuardhouseRegister />
  </div>;
}
