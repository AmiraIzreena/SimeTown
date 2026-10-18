'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedImg } from '@/components/ui/localized-elements';

import { CheckCircle2, Flag, Package, PackageOpen, Share2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { LockerParcels } from '@/components/features/locker-parcels';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ReportProblemDialog } from '@/components/features/report-problem';
import { Async, EmptyState, SkeletonList } from '@/components/ui/feedback';
import { QrCode } from '@/components/ui/qr';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { formatDateTime, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

interface Parcel {
  id: string;
  courier: string;
  trackingNo: string | null;
  shelf: string;
  note: string | null;
  hasPhoto: boolean;
  status: 'WAITING' | 'COLLECTED' | 'RETURNED';
  code: string | null;
  loggedAt: string;
  collectedAt: string | null;
  collectedBy: string | null;
  problemReported: boolean;
}

type Tab = 'lockers' | 'guardhouse';

export default function ParcelsPage() {
  const parcels = useApi<{ parcels: Parcel[] }>('/parcels', { refreshInterval: 30_000 });
  const lockers = useApi<{ parcels: { state: string }[] }>('/lockers/my-parcels', { refreshInterval: 5_000 });
  const [chosen, setChosen] = useState<Tab | null>(null);
  const atGuardhouse = parcels.data?.parcels.filter((p) => p.status === 'WAITING').length ?? 0;
  const inLockers = lockers.data?.parcels.filter((p) => !['COLLECTED', 'RETURNED'].includes(p.state)).length ?? 0;
  // Until the resident picks a tab, open the one with something waiting.
  const tab: Tab = chosen ?? (inLockers === 0 && atGuardhouse > 0 ? 'guardhouse' : 'lockers');
  const toast = useToast();
  const t = useT();
  // Which guardhouse parcel is being reported, and from where; or a parcel that has not arrived at all.
  const [problem, setProblem] = useState<{ parcel: Parcel; context: 'GUARD_WAITING' | 'GUARD_DONE' } | null>(null);
  const [missing, setMissing] = useState(false);

  const share = async (p: Parcel) => {
    const text = t('Collection code {code} for the parcel from {courier}, shelf {shelf} at the guardhouse.', { code: p.code!, courier: p.courier, shelf: p.shelf });
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        toast.show(t('Code copied'), 'success');
      }
    } catch {
      /* the person closed the share sheet */
    }
  };

  return (
    <>
      <PageHeader
        title="Parcels"
        description="Parcels in the smart lockers and at the guardhouse for your home. Each has a one-time code that works only for that parcel. Someone collecting for you? Share the code with them."
        action={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setMissing(true)}><PackageOpen className="size-4" aria-hidden /><Text>A parcel hasn’t arrived?</Text></Button>
            <Button size="sm" variant="ghost" href="/app/reports"><Flag className="size-4" aria-hidden /><Text>My reports</Text></Button>
          </div>
        }
      />
      <Tabs<Tab>
        label="Where the parcel is"
        value={tab}
        onChange={setChosen}
        items={[
          { key: 'lockers', label: 'Parcel lockers', count: inLockers || undefined },
          { key: 'guardhouse', label: 'Guardhouse', count: atGuardhouse || undefined },
        ]}
      />
      <TabPanel>
      {tab === 'lockers' && <LockerParcels />}
      {tab === 'guardhouse' && <Async state={parcels} skeleton={<SkeletonList rows={2} />}>
        {(data) => {
          const waiting = data.parcels.filter((p) => p.status === 'WAITING');
          const past = data.parcels.filter((p) => p.status !== 'WAITING');
          return (
            <div className="space-y-6">
              <p className="text-[15px] text-ink-600"><Text>Parcels the guard keeps on a shelf. Show the code to the guard to collect.</Text></p>
              {waiting.length === 0 ? (
                <EmptyState icon={Package} title="Nothing at the guardhouse"><Text>When a courier leaves a parcel at the guardhouse, you are told at once and the code appears here.</Text></EmptyState>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {waiting.map((p) => (
                    <Card key={p.id} className="overflow-hidden">
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 p-5">
                        <div>
                          <p className="font-display text-lg font-bold text-ink-900"><Text>{`From ${p.courier}`}</Text></p>
                          <p className="text-sm text-ink-500"><Text>{`Arrived ${timeAgo(p.loggedAt)}`}</Text>{p.trackingNo && ` · ${p.trackingNo}`}</p>
                        </div>
                        <Badge tone="gold"><Text>{`Shelf ${p.shelf}`}</Text></Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-5 p-5">
                        <QrCode value={`KITAPARCEL:${p.code}`} size={132} label="Collection code as a QR code" />
                        <div className="min-w-0 flex-1 space-y-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Collection code</Text></p>
                            <p className="parcel-code text-3xl font-bold text-ink-900">{p.code}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="secondary" onClick={() => void share(p)}>
                              <Share2 className="size-4" aria-hidden /><Text>Share the code</Text></Button>
                            <Button size="sm" variant="ghost" onClick={() => setProblem({ parcel: p, context: 'GUARD_WAITING' })}><Flag className="size-4" aria-hidden /><Text>Report a problem</Text></Button>
                          </div>
                        </div>
                      </div>
                      {(p.hasPhoto || p.note) && (
                        <div className="space-y-3 border-t border-ink-100 p-5">
                          {p.note && <p className="text-sm text-ink-700">{p.note}</p>}
                          {p.hasPhoto && <LocalizedImg src={`/api/v1/parcels/${p.id}/photo`} alt="Photo of the parcel taken at the guardhouse" loading="lazy" className="max-h-48 w-full rounded-md border border-ink-200 object-cover" />}
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              )}

              {past.length > 0 && (
                <Card>
                  <CardHeader title="Collected from the guardhouse" description="The last 30 days. Told that a parcel was collected, but it was not you? Tell us the same day." />
                  <ul className="divide-y divide-ink-100">
                    {past.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                        <div className="flex min-w-0 items-start gap-3">
                          {p.status === 'COLLECTED' ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success-700" aria-hidden /> : <Undo2 className="mt-0.5 size-5 shrink-0 text-ink-400" aria-hidden />}
                          <div className="min-w-0">
                            <p className="text-[15px] font-semibold text-ink-900"><Text>{`From ${p.courier}`}</Text></p>
                            <p className="text-sm text-ink-500">
                              <Text>{p.status === 'COLLECTED' ? 'Collected' : 'Returned to the courier'}</Text>
                              {p.collectedAt && <> · <Text>{formatDateTime(p.collectedAt)}</Text></>}
                              {p.collectedBy && <> · <Text>by </Text>{p.collectedBy}</>}
                            </p>
                          </div>
                        </div>
                        {p.status === 'COLLECTED' &&
                          (p.problemReported ? (
                            <Badge tone="warning"><Text>Being looked into</Text></Badge>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => setProblem({ parcel: p, context: 'GUARD_DONE' })}>
                              <Flag className="size-4" aria-hidden /><Text>Report</Text></Button>
                          ))}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          );
        }}
      </Async>}
      </TabPanel>

      <ReportProblemDialog
        open={problem !== null}
        onClose={() => setProblem(null)}
        context={problem?.context ?? 'GUARD_DONE'}
        guardParcelId={problem?.parcel.id}
        subtitle={problem ? `${problem.parcel.courier} · ${t('shelf')} ${problem.parcel.shelf}` : undefined}
        onFiled={() => void parcels.mutate()}
      />
      <ReportProblemDialog open={missing} onClose={() => setMissing(false)} context="NOT_ARRIVED" subtitle="Tell us the tracking number. If it is already here, we will tell you where." />
    </>
  );
}
