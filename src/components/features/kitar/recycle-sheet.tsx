'use client';

import { Text } from '@/components/ui/localized-text';

import { Cpu, MapPin, QrCode as QrIcon, Recycle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { formatRM, MATERIAL_INFO, MATERIALS, type Material } from '@/shared/domain';
import { MaterialIcon } from './materials';
import { isMaterial, materialLabel, type KitarLimits, type KitarMachine, type KitarRate } from './types';

export const STATUS = { ONLINE: { label: 'Open', tone: 'success' as const }, FULL: { label: 'Full', tone: 'warning' as const }, OFFLINE: { label: 'Offline', tone: 'neutral' as const } };

interface Site {
  key: string;
  name: string;
  location: string;
  bins: KitarMachine[];
}

/** The bins grouped by their kiosk. An older server sends no kiosk, so the location stands in for it. */
export function sitesOf(machines: KitarMachine[]): Site[] {
  const sites = new Map<string, Site>();
  for (const m of machines) {
    const key = m.kiosk_id ?? m.location;
    const site = sites.get(key) ?? { key, name: m.kiosk ?? m.location, location: m.location, bins: [] };
    site.bins.push(m);
    sites.set(key, site);
  }
  return [...sites.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const choice = (selected: boolean) =>
  cn(
    'flex min-h-12 w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left text-[15px] transition-[border-color,background-color] duration-200',
    selected ? 'border-brand-600 bg-brand-50 text-brand-900' : 'border-ink-200 bg-white text-ink-800 hover:border-ink-300',
  );

/**
 * "Recycle now", as in the prototype: pick a site, pick a bin, then scan the code
 * on the bin's screen. The material shown here only helps the resident: nothing
 * is sent from this sheet. The bin weighs, checks and signs every item (BR23).
 */
export function RecycleSheet({ open, onClose, machines, rates, limits, initialSite }: {
  open: boolean;
  onClose: () => void;
  machines: KitarMachine[];
  /** The kiosk name to start on, from "Recycle here" on the Map tab. The resident can still pick another site. */
  initialSite?: string | null;
  rates?: KitarRate[];
  limits?: KitarLimits;
}) {
  const t = useT();
  const [step, setStep] = useState<1 | 2>(1);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [binId, setBinId] = useState<string | null>(null);
  const [material, setMaterial] = useState<Material | null>(null);

  const sites = sitesOf(machines);
  const site = sites.find((s) => s.key === siteKey) ?? (siteKey === null ? sites.find((s) => s.name === initialSite) : undefined) ?? (sites.length === 1 ? sites[0] : undefined);
  const bin = site?.bins.find((b) => b.id === binId);
  const binMaterial = bin && isMaterial(bin.material) ? bin.material : null;
  const chosen = binMaterial ?? material;
  const rate = chosen ? rates?.find((r) => r.material === chosen) : undefined;
  const dayUsed = limits ? limits.tripsToday >= limits.tripsPerDay : false;
  const monthUsed = limits ? limits.homeTripsMonth >= limits.homeTripsPerMonth : false;

  const close = () => {
    setStep(1);
    setSiteKey(null);
    setBinId(null);
    setMaterial(null);
    onClose();
  };
  const pickBin = (b: KitarMachine) => {
    setBinId(b.id);
    // The bin's own material is chosen for the resident; a bin that takes any material asks.
    setMaterial(isMaterial(b.material) ? b.material : null);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Recycle now"
      description={step === 1 ? 'Step 1 of 2' : 'Step 2 of 2'}
      footer={
        step === 1 ? (
          <>
            <Button variant="secondary" onClick={close}><Text>Cancel</Text></Button>
            <Button onClick={() => setStep(2)} disabled={!bin || bin.status !== 'ONLINE' || !chosen}><Text>Next</Text></Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setStep(1)}><Text>Back</Text></Button>
            <Button onClick={close}><Text>Done</Text></Button>
          </>
        )
      }
    >
      {(dayUsed || monthUsed) && (
        <p role="status" className="mb-4 rounded-md bg-warning-50 px-3.5 py-2.5 text-sm text-warning-700">
          <Text>{dayUsed ? t('You have used {used} of {max} trips today. More trips today earn no XP or points.', { used: limits!.tripsToday, max: limits!.tripsPerDay }) : t('Your home has used {used} of {max} trips this month. More trips this month earn no XP or points.', { used: limits!.homeTripsMonth, max: limits!.homeTripsPerMonth })}</Text>
        </p>
      )}

      {step === 1 ? (
        sites.length === 0 ? (
          <EmptyState icon={Recycle} title="No bins in your township yet"><Text>Bins with a scale will be listed here once the township sets them up.</Text></EmptyState>
        ) : (
          <div className="space-y-6">
            <fieldset>
              <legend className="mb-2 text-[15px] font-semibold text-ink-900"><Text>Choose the site</Text></legend>
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
                    <button key={b.id} type="button" aria-pressed={bin?.id === b.id} className={choice(bin?.id === b.id)} onClick={() => pickBin(b)}>
                      <Cpu className="size-5 shrink-0 text-brand-700" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold"><Text>{b.name}</Text></span>
                        <span className="block text-sm text-ink-500"><Text>{b.material ? materialLabel(b.material) : 'Any material'}</Text></span>
                      </span>
                      <Badge tone={(STATUS[b.status] ?? STATUS.OFFLINE).tone}><Text>{(STATUS[b.status] ?? STATUS.OFFLINE).label}</Text></Badge>
                    </button>
                  ))}
                </div>
                {bin && bin.status !== 'ONLINE' && (
                  <p role="status" className="mt-2 text-sm text-warning-700"><Text>This bin cannot be used right now. Choose another bin.</Text></p>
                )}
              </fieldset>
            )}

            {bin && bin.status === 'ONLINE' && (
              binMaterial ? (
                <p className="rounded-md bg-brand-50 px-3.5 py-2.5 text-[15px] text-brand-900">
                  <Text>{t('This bin takes {material} only.', { material: t(MATERIAL_INFO[binMaterial].label) })}</Text>
                </p>
              ) : (
                <fieldset>
                  <legend className="mb-2 text-[15px] font-semibold text-ink-900"><Text>This bin takes any material. What are you recycling?</Text></legend>
                  <div className="grid grid-cols-2 gap-2">
                    {MATERIALS.map((m) => (
                      <button key={m} type="button" aria-pressed={material === m} className={choice(material === m)} onClick={() => setMaterial(m)}>
                        <MaterialIcon material={m} size="sm" />
                        <Text>{MATERIAL_INFO[m].label}</Text>
                      </button>
                    ))}
                  </div>
                </fieldset>
              )
            )}
          </div>
        )
      ) : (
        <div className="space-y-4 text-[15px] text-ink-700">
          {chosen && (
            <p className="rounded-md bg-brand-50 px-3.5 py-2.5 text-brand-900">
              <strong className="font-semibold"><Text>{MATERIAL_INFO[chosen].label}</Text></strong>
              {' · '}
              <Text>{rate && rate.pointsPerKg > 0 ? t('{n} points per kg ({rm})', { n: rate.pointsPerKg, rm: formatRM(rate.pointsPerKg) }) : 'XP only'}</Text>
            </p>
          )}
          <h3 className="flex items-center gap-2 text-lg font-semibold text-ink-900">
            <QrIcon className="size-5 text-brand-700" aria-hidden />
            <Text>Scan the code on the bin’s screen</Text>
          </h3>
          <ol className="list-decimal space-y-2 pl-5">
            <li><Text>Open your phone camera and point it at the code on the bin’s screen. The code changes every 30 seconds, so scan it at the bin.</Text></li>
            <li><Text>Put your items in the bin. Its scale weighs them and sends the weight by itself. You never type a weight.</Text></li>
            <li><Text>Your result appears on this page when the bin finishes.</Text></li>
          </ol>
          <p className="text-sm text-ink-500"><Text>Nothing is weighed on your phone. Only the weight the bin’s scale sends counts.</Text></p>
        </div>
      )}
    </Modal>
  );
}
