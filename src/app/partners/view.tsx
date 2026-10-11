'use client';

import { Text } from '@/components/ui/localized-text';

import { Award, Handshake } from 'lucide-react';
import { PublicFrame } from '@/components/features/public-frame';
import { Badge, Card } from '@/components/ui/card';
import { Async, EmptyState } from '@/components/ui/feedback';
import { useApi } from '@/lib/hooks';
import { SPONSOR_TIER_INFO, type SponsorTier } from '@/shared/domain';

interface Group {
  tier: SponsorTier;
  label: string;
  sponsors: { name: string; category: string | null; tagline: string | null }[];
}

/** The Partners page every tier includes (proposal section 12). Names and taglines only. */
export function PartnersView() {
  const partners = useApi<Group[]>('/public/partners');
  return (
    <PublicFrame title="Our partners" intro="Brands that fund township challenges, recycling machines and green weeks. Sponsored content in the app is always labelled, and never appears on safety screens.">
      <Async state={partners}>
        {(groups) =>
          groups.length === 0 ? (
            <EmptyState icon={Handshake} title="No partners yet" />
          ) : (
            <div className="space-y-8">
              {groups.map((g) => (
                <section key={g.tier} aria-labelledby={`tier-${g.tier}`}>
                  <h2 id={`tier-${g.tier}`} className="mb-3 flex items-center gap-2 text-xl font-semibold">
                    <Award className="size-5 text-gold-500" aria-hidden />
                    <Text>{g.label}</Text>
                  </h2>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {g.sponsors.map((s) => (
                      <Card key={s.name} className="p-5">
                        <p className="text-[17px] font-semibold text-ink-900">{s.name}</p>
                        {s.category && (
                          <Badge tone="gold" className="mt-2">
                            <Text>{s.category}</Text>
                          </Badge>
                        )}
                        {s.tagline && <p className="mt-3 text-sm text-ink-600"><Text>{s.tagline}</Text></p>}
                      </Card>
                    ))}
                  </div>
                </section>
              ))}
              <Card className="p-5">
                <h2 className="text-base font-semibold"><Text>Become a partner</Text></h2>
                <ul className="mt-3 grid gap-3 text-sm text-ink-700 md:grid-cols-2">
                  {(Object.keys(SPONSOR_TIER_INFO) as SponsorTier[]).map((tier) => (
                    <li key={tier}>
                      <strong><Text>{SPONSOR_TIER_INFO[tier].label}</Text></strong>: <Text>{SPONSOR_TIER_INFO[tier].benefits.slice(-2).join('; ')}</Text>.
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-ink-500"><Text>Tier names and fees are placeholders to test with real brands in the pilot. Sponsors receive grouped totals only, never personal data.</Text></p>
              </Card>
            </div>
          )
        }
      </Async>
    </PublicFrame>
  );
}
