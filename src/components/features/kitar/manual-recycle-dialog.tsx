'use client';

import { Text } from '@/components/ui/localized-text';

import { Cpu, MapPin } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/feedback';
import { MATERIAL_INFO, MATERIALS, type Material } from '@/shared/domain';
import { MaterialIcon } from './materials';
import { choice, sitesOf, STATUS } from './recycle-sheet';
import { TestEntryPanel } from './test-entry-panel';
import { isMaterial, materialLabel, type KitarOverview, type WalletSummary } from './types';

/**
 * "Manual recycle (practice)": Kitar test mode for local demos, in its own dialog so
 * "Recycle now" stays the bin flow. The Transaction tab shows the button only when
 * GET /kitar offers test mode (a pglite database in development); the server checks
 * again on every save. The resident picks the kiosk, the bin and the material, types
 * a weight and sees what it will earn before saving.
 */
export function ManualRecycleDialog({ open, onClose, overview, wallet, onSaved }: {
  open: boolean;
  onClose: () => void;
  overview: KitarOverview;
  wallet?: WalletSummary;
  onSaved: () => Promise<unknown>;
}) {
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [binId, setBinId] = useState<string | null>(null);
  const [material, setMaterial] = useState<Material | null>(null);

  const sites = sitesOf(overview.machines);
  const site = sites.find((s) => s.key === siteKey) ?? (sites.length === 1 ? sites[0] : undefined);
  const bin = site?.bins.find((b) => b.id === binId);
  const binMaterial = bin && isMaterial(bin.material) ? bin.material : null;
  const chosen = binMaterial ?? material;

  const close = () => {
    setSiteKey(null);
    setBinId(null);
    setMaterial(null);
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title="Manual recycle (practice)" description="Test mode" footer={<Button variant="secondary" onClick={close}><Text>Close</Text></Button>}>
      <div className="space-y-6">
        <p className="rounded-md border border-dashed border-warning-600/60 bg-warning-50 px-3.5 py-2.5 text-sm text-warning-700">
          <Text>For demos only. Nothing is weighed: you type the weight. The entry is saved and labelled as a test entry.</Text>
        </p>

        {sites.length === 0 ? (
          <EmptyState icon={MapPin} title="No bins in your township yet" />
        ) : (
          <>
            <fieldset>
              <legend className="mb-2 text-[15px] font-semibold text-ink-900"><Text>Choose the kiosk</Text></legend>
              <div className="space-y-2">
                {sites.map((s) => (
                  <button key={s.key} type="button" aria-pressed={site?.key === s.key} className={choice(site?.key === s.key)} onClick={() => { setSiteKey(s.key); setBinId(null); setMaterial(null); }}>
                    <MapPin className="size-5 shrink-0 text-brand-700" aria-hidden />
                    <span className="min-w-0">
                      <span className="block font-semibold"><Text>{s.name}</Text></span>
                      <span className="block truncate text-sm text-ink-500"><Text>{s.location}</Text></span>
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>

            {site && (
              <fieldset>
                <legend className="mb-2 text-[15px] font-semibold text-ink-900"><Text>Choose the bin</Text></legend>
                <div className="space-y-2">
                  {site.bins.map((b) => (
                    <button key={b.id} type="button" aria-pressed={bin?.id === b.id} className={choice(bin?.id === b.id)} onClick={() => { setBinId(b.id); setMaterial(isMaterial(b.material) ? b.material : null); }}>
                      <Cpu className="size-5 shrink-0 text-brand-700" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold"><Text>{b.name}</Text></span>
                        <span className="block text-sm text-ink-500"><Text>{b.material ? materialLabel(b.material) : 'Any material'}</Text></span>
                      </span>
                      <Badge tone={(STATUS[b.status] ?? STATUS.OFFLINE).tone}><Text>{(STATUS[b.status] ?? STATUS.OFFLINE).label}</Text></Badge>
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {bin && (
              <fieldset>
                <legend className="mb-2 text-[15px] font-semibold text-ink-900"><Text>Choose the material</Text></legend>
                {binMaterial ? (
                  <p className="flex items-center gap-2 text-[15px] font-medium text-ink-900">
                    <MaterialIcon material={binMaterial} size="sm" />
                    <Text>{MATERIAL_INFO[binMaterial].label}</Text>
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
                    {MATERIALS.map((m) => (
                      <button key={m} type="button" aria-pressed={material === m} className={choice(material === m)} onClick={() => setMaterial(m)}>
                        <MaterialIcon material={m} size="sm" />
                        <Text>{MATERIAL_INFO[m].label}</Text>
                      </button>
                    ))}
                  </div>
                )}
              </fieldset>
            )}

            {bin && chosen && overview.testEntry && (
              <TestEntryPanel
                key={`${bin.id}-${chosen}`}
                binId={bin.id}
                material={chosen}
                rate={overview.rates?.find((r) => r.material === chosen)}
                limits={overview.limits}
                status={overview.points?.status}
                xpPerTrip={overview.testEntry.xp}
                wallet={wallet}
                onSaved={onSaved}
              />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
