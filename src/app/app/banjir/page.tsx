'use client';

import { Text } from '@/components/ui/localized-text';

import { CountUp } from '@/components/ui/count-up';
import { BadgeCheck, Clock, ExternalLink, HeartPulse, MapPin, Megaphone, Navigation, ShieldCheck, TrendingUp } from 'lucide-react';
import { AksesPage, AksesReadAloud, useAksesMode } from '@/components/features/akses-mode';
import { FloodBadge, LevelGauge, LevelHistory, useVerifiedText } from '@/components/features/flood';
import { FloodTrend } from '@/components/features/flood-trend';
import { Button } from '@/components/ui/button';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { Async, EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import type { BanjirOverview } from '@/lib/types';

/** The last six hours of one zone's water level. */
function ZoneHistory({ zoneId, warningPct, dangerPct }: { zoneId: string; warningPct: number; dangerPct: number }) {
  const history = useApi<{ points: { at: string; pct: number }[] }>(`/banjir/zones/${zoneId}/history?hours=6`, { refreshInterval: 60_000 });
  if (!history.data) return null;
  return (
    <div className="mt-4">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Last 6 hours</Text></p>
      <LevelHistory points={history.data.points} warningPct={warningPct} dangerPct={dangerPct} />
    </div>
  );
}

export default function BanjirPage() {
  const t = useT();
  const verified = useVerifiedText();
  const akses = useAksesMode();
  const overview = useApi<BanjirOverview>('/banjir', { refreshInterval: 15_000 });
  const checkin = useAction((status: 'SAFE' | 'NEED_HELP') => api.post('/banjir/checkin', { status }), {
    onSuccess: () => void overview.mutate(),
    success: 'Thank you. The township team can see your answer.',
  });
  const mine = overview.data?.zones.find((z) => z.id === overview.data?.myZoneId);
  return (
    <AksesPage>
      <PageHeader
        title="Banjir"
        description="Water levels by zone, from drain sensors and camera readings checked by the Banjir agent. Two signals must agree before the highest alert goes out by itself."
        action={
          <Button href="/status" newTab variant="secondary">
            <ExternalLink className="size-4" aria-hidden />
            {t('Official status page')}
          </Button>
        }
      />
      {!akses.simple && mine && mine.status !== 'NORMAL' && (
        <Card className={cn('mb-5 p-5', mine.status === 'DANGER' ? 'border-accent-200 bg-accent-50' : 'border-warning-600/30 bg-warning-50')}>
          <p className="font-display text-lg font-bold text-ink-900"><Text>{overview.data?.myCheckin ? (overview.data.myCheckin === 'SAFE' ? 'You checked in safe.' : 'You asked for help. The team has been told.') : 'Let the township team know how you are.'}</Text></p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => void checkin.run('SAFE')} pending={checkin.pending} variant={overview.data?.myCheckin === 'SAFE' ? 'secondary' : 'primary'}>
              <ShieldCheck className="size-4" aria-hidden />
              {t("I'm safe")}
            </Button>
            <Button onClick={() => void checkin.run('NEED_HELP')} disabled={checkin.pending} variant="danger">
              <HeartPulse className="size-4" aria-hidden />
              {t('I need help')}
            </Button>
          </div>
        </Card>
      )}
      <Async state={overview}>
        {(o) =>
          o.zones.length === 0 ? (
            <EmptyState title="No flood zones set up"><Text>The township team has not added any zones yet.</Text></EmptyState>
          ) : akses.simple ? (
            <div className="space-y-4">
              {[...o.zones]
                .sort((a, b) => Number(b.id === o.myZoneId) - Number(a.id === o.myZoneId))
                .map((zone) => {
                  const isMine = zone.id === o.myZoneId;
                  const statusText = zone.status === 'DANGER' ? 'Flood danger in your area. Leave by the safe route.' : zone.status === 'WARNING' ? 'Flood warning in your area.' : 'Your area is safe right now.';
                  const checkinText = o.myCheckin === 'SAFE' ? 'You checked in safe.' : o.myCheckin === 'NEED_HELP' ? 'You asked for help. The team has been told.' : 'Let the township team know how you are.';
                  const spoken = `${isMine ? t(statusText) : `${zone.name}: ${t(zone.status)}`}. ${t('Safe route')}: ${zone.safe_route}. ${t('Assembly point')}: ${zone.assembly_point}.`;
                  return (
                    <Card key={zone.id} className={cn('space-y-4 p-6', zone.status === 'DANGER' && 'border-accent-300 bg-accent-50', zone.id === o.myZoneId && zone.status !== 'DANGER' && 'border-brand-300')} aria-live={isMine ? 'polite' : undefined}>
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-2xl font-bold">{zone.name}</h2>
                        {isMine && <Badge tone="brand"><Text>Your zone</Text></Badge>}
                        <FloodBadge status={zone.status} />
                      </div>
                      <p className="text-xl font-semibold text-ink-900"><Text>{isMine ? statusText : zone.status === 'DANGER' ? 'Flood danger' : zone.status === 'WARNING' ? 'Flood warning' : 'Normal'}</Text></p>
                      <p className="font-display text-4xl font-bold tabular-nums text-ink-900"><CountUp value={zone.level_pct} format={(n) => `${n}%`} /></p>
                      {zone.rising_fast && <p className="text-xl font-semibold text-accent-700"><Text>The water is rising fast. Get ready to move.</Text></p>}
                      {isMine && <p className="text-base text-ink-600">{verified(zone)}</p>}
                      <p><strong><Text>Safe route</Text>:</strong> <Text>{zone.safe_route}</Text></p>
                      <p><strong><Text>Assembly point</Text>:</strong> <Text>{zone.assembly_point}</Text></p>
                      {isMine && zone.status !== 'NORMAL' && (
                        <div className="space-y-3 border-t border-ink-200 pt-4">
                          <p className="font-semibold"><Text>{checkinText}</Text></p>
                          <div className="flex flex-wrap gap-3">
                            <Button size="lg" onClick={() => void checkin.run('SAFE')} pending={checkin.pending} variant={o.myCheckin === 'SAFE' ? 'secondary' : 'primary'}>
                              <ShieldCheck className="size-5" aria-hidden />{t("I'm safe")}
                            </Button>
                            <Button size="lg" onClick={() => void checkin.run('NEED_HELP')} disabled={checkin.pending} variant="danger">
                              <HeartPulse className="size-5" aria-hidden /><Text>I need help</Text>
                            </Button>
                          </div>
                        </div>
                      )}
                      {isMine && <AksesReadAloud profile={akses.profile} text={spoken} />}
                    </Card>
                  );
                })}
              <p className="text-sm text-ink-600"><Text>Updates every few seconds.</Text></p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-ink-500"><Text>Warning at </Text><Text>{o.warningPct}</Text><Text>% · Danger at </Text><Text>{o.dangerPct}</Text><Text>% · updates every few seconds</Text></p>
              <div className="grid gap-4 md:grid-cols-2">
                {[...o.zones]
                  .sort((a, b) => Number(b.id === o.myZoneId) - Number(a.id === o.myZoneId))
                  .map((zone) => (
                    <Card key={zone.id} className={cn('p-5', zone.status === 'DANGER' && 'border-accent-200 bg-accent-50/50', zone.id === o.myZoneId && zone.status !== 'DANGER' && 'border-brand-300')}>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[17px] font-semibold">{zone.name}</h2>
                        {zone.id === o.myZoneId && <Badge tone="brand"><Text>Your zone</Text></Badge>}
                        <span className="ml-auto">
                          <FloodBadge status={zone.status} />
                        </span>
                      </div>
                      <p className="mt-3 font-display text-4xl font-bold tabular-nums text-ink-900"><CountUp value={zone.level_pct} format={(n) => `${n}%`} /></p>
                      <div className="mt-3">
                        <LevelGauge level={zone.level_pct} status={zone.status} warningPct={o.warningPct} dangerPct={o.dangerPct} />
                      </div>
                      {zone.rising_fast && (
                        <p role="status" className="mt-3 flex items-start gap-2 rounded-lg bg-accent-50 px-3 py-2.5 text-sm font-medium text-accent-700">
                          <TrendingUp className="mt-0.5 size-4 shrink-0" aria-hidden />
                          <Text>The water is rising fast here. Get ready to move: charge your phone and move valuables up.</Text>
                        </p>
                      )}
                      <FloodTrend trend={zone.trend} className="mt-3" />
                      <ZoneHistory zoneId={zone.id} warningPct={o.warningPct} dangerPct={o.dangerPct} />
                      <ul className="mt-4 space-y-2 border-t border-ink-100 pt-3 text-sm text-ink-700">
                        <li className="flex gap-2">
                          <Navigation className="mt-0.5 size-4 shrink-0 text-ink-500" aria-hidden />
                          <span>
                            <span className="sr-only"><Text>Safe route: </Text></span>
                            <Text>{zone.safe_route}</Text>
                          </span>
                        </li>
                        <li className="flex gap-2">
                          <MapPin className="mt-0.5 size-4 shrink-0 text-ink-500" aria-hidden />
                          <span>
                            <span className="sr-only"><Text>Assembly point: </Text></span>
                            <Text>{zone.assembly_point}</Text>
                          </span>
                        </li>
                      </ul>
                      {zone.what && (
                        <div className="mt-4 space-y-1.5 rounded-lg bg-ink-50 p-3.5 text-sm">
                          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
                            <Megaphone className="size-3.5" aria-hidden /><Text>Latest official message · </Text><Text>{zone.sent_at ? formatDateTime(zone.sent_at) : ''}</Text>
                          </p>
                          <p className="font-semibold text-ink-900"><Text>{zone.what}</Text></p>
                          <p className="text-ink-700"><Text>{zone.where_text}</Text></p>
                          <p className="text-ink-700"><Text>{zone.todo}</Text></p>
                          {zone.next_update_at && (
                            <p className="flex items-center gap-1.5 text-ink-600">
                              <Clock className="size-3.5" aria-hidden />
                              {t('Next update')}<Text> by </Text><Text>{new Date(zone.next_update_at).toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })}</Text>
                            </p>
                          )}
                        </div>
                      )}
                      <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-500">
                        <BadgeCheck className="size-3.5" aria-hidden />
                        {verified(zone)}
                      </p>
                    </Card>
                  ))}
              </div>
            </div>
          )
        }
      </Async>
    </AksesPage>
  );
}
