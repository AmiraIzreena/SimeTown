'use client';

import { Text } from '@/components/ui/localized-text';

import { Badge, Card, CardHeader } from '@/components/ui/card';
import { formatKg } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { formatRM, MATERIAL_INFO, MATERIALS } from '@/shared/domain';
import { MaterialIcon } from './materials';
import type { KitarOverview } from './types';

/**
 * Points per kg for each material, with the kg the resident recycled of each
 * this month. A material with no rate, or a rate of 0, earns XP only.
 */
export function RatesList({ overview }: { overview: KitarOverview }) {
  const t = useT();
  const rates = overview.rates;
  if (!rates) return null; // an older server sends no rates
  const byMaterial = new Map(rates.map((r) => [r.material, r]));
  const grams = overview.monthGramsByMaterial ?? {};
  return (
    <Card>
      <CardHeader title="Points per kg, by material" description="Each material earns its own rate for every kg a bin weighs." />
      {rates.length === 0 ? (
        <p className="p-5 text-sm text-ink-500"><Text>Rates are not available yet. Recycling still earns XP.</Text></p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {MATERIALS.map((m) => {
            const rate = byMaterial.get(m);
            const perKg = rate?.pointsPerKg ?? 0;
            const g = grams[m] ?? 0;
            return (
              <li key={m} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <MaterialIcon material={m} />
                    <span className="text-[15px] font-medium text-ink-900"><Text>{MATERIAL_INFO[m].label}</Text></span>
                    {rate?.placeholder && perKg > 0 && <Badge tone="neutral"><Text>Rate to be confirmed</Text></Badge>}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-ink-800">
                    {perKg > 0 ? <Text>{t('{n} points per kg ({rm})', { n: perKg, rm: formatRM(perKg) })}</Text> : <Text>XP only</Text>}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-500"><Text>{t('{kg} this month', { kg: formatKg(g) })}</Text></p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
