'use client';

import { Text } from '@/components/ui/localized-text';

import { CountUp } from '@/components/ui/count-up';
import { BadgeCheck, CheckCircle2, Clock, ExternalLink, HeartPulse, MapPin, Megaphone, Navigation, ShieldCheck, Siren, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { AksesPage, AksesReadAloud, useAksesMode } from '@/components/features/akses-mode';
import { FloodBadge, LevelHistory, useVerifiedText } from '@/components/features/flood';
import { WaterColumn } from '@/components/features/water-column';
import { FloodTrend } from '@/components/features/flood-trend';
import { Button } from '@/components/ui/button';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { ResidentFloodWalkthrough } from '@/components/features/banjir-walkthroughs';
import { Async, EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import { formatDateTime, timeAgo } from '@/lib/format';
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

type Zone = BanjirOverview['zones'][number];

/** What each colour means, once at the top: green is safe, red-orange is a warning, deep red is danger. */
function LevelLegend({ warningPct, dangerPct }: { warningPct: number; dangerPct: number }) {
  const items = [
    { tone: 'bg-brand-500', label: 'Normal', note: `below ${warningPct}%` },
    { tone: 'bg-accent-500', label: 'Warning', note: `from ${warningPct}%` },
    { tone: 'bg-[#800d1c]', label: 'Danger', note: `from ${dangerPct}%` },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-600">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-2 rounded-full border border-ink-100 bg-white/80 px-3 py-1 shadow-xs">
          <span aria-hidden className={cn('size-2.5 rounded-full', i.tone)} />
          <span className="font-semibold text-ink-800"><Text>{i.label}</Text></span>
          <span className="text-ink-500"><Text>{i.note}</Text></span>
        </span>
      ))}
      <span className="text-ink-500"><Text>Updates every few seconds.</Text></span>
    </div>
  );
}

const ALERT: Record<'WARNING' | 'DANGER', { title: string; action: string }> = {
  WARNING: { title: 'Flood warning', action: 'Get ready to move. Check your safe route now.' },
  DANGER: { title: 'Flood danger', action: 'Move to your meeting point now.' },
};
/** The time now, refreshed every `ms`, so an "overdue" check stays right while the page is left open. */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
  return now;
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' });

/**
 * One zone, coloured by what it means (the same design as the public status page): deep red for danger and
 * red-orange for a warning, with the one thing to do in the band on top; calm green while normal. The
 * official message takes the alert's colour, or green for the all clear. The safe route and meeting point
 * are green, the colour of emergency exits. The estimate is dashed, so it never reads as an alert.
 */
function ZoneCard({ zone, mine, warningPct, dangerPct, index }: { zone: Zone; mine: boolean; warningPct: number; dangerPct: number; index: number }) {
  const verified = useVerifiedText();
  const alert = zone.status === 'NORMAL' ? null : ALERT[zone.status];
  const danger = zone.status === 'DANGER';
  // The alert holds until two separate checks agree it is safe, so the water can fall below the line first. Say so.
  const line = danger ? dangerPct : warningPct;
  const dropped = alert !== null && zone.level_pct < line;
  const now = useNow(30_000);
  const overdue = alert !== null && zone.next_update_at !== null && Date.parse(zone.next_update_at) < now;
  const allClear = zone.message_kind === 'ALL_CLEAR';
  return (
    <article
      id={mine ? 'my-zone' : undefined}
      tabIndex={mine ? -1 : undefined}
      className={cn(
        'zone-card banjir-zone relative flex flex-col overflow-hidden rounded-3xl border bg-white shadow-sm scroll-mt-28 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
        danger && 'is-danger is-alert border-accent-300',
        zone.status === 'WARNING' && 'is-warning is-alert border-accent-200',
        !alert && 'is-normal border-white/80',
        mine && 'is-mine',
      )}
      style={{ '--i': index } as CSSProperties}
    >
      {alert ? (
        <div className="zone-alert-band relative flex items-start gap-3 overflow-hidden px-5 py-3.5 text-white sm:px-6" role="status">
          <span className="zone-alert-icon relative grid size-9 shrink-0 place-items-center rounded-full bg-white/15">
            {danger ? <Siren className="size-4.5" aria-hidden /> : <TriangleAlert className="size-4.5" aria-hidden />}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.12em]"><Text>{alert.title}</Text><span className="zone-alert-dot" aria-hidden /></span>
            <span className="mt-0.5 block text-sm font-medium text-white/90"><Text>{alert.action}</Text></span>
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 bg-brand-50 px-5 py-2.5 text-sm font-semibold text-brand-800 sm:px-6">
          <ShieldCheck className="size-4" aria-hidden /><Text>No flood alert. The water is at a safe level.</Text>
        </div>
      )}

      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold leading-snug">{zone.name}</h2>
            {mine && <Badge tone="brand"><Text>Your zone</Text></Badge>}
          </div>
          {alert ? (
            <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold text-white', danger ? 'bg-accent-700' : 'bg-accent-600')}>
              <TriangleAlert className="size-3.5" aria-hidden /><Text>{danger ? 'Danger' : 'Warning'}</Text>
            </span>
          ) : <Badge tone="brand"><Text>Normal</Text></Badge>}
        </div>

        <div className="mt-5 flex items-stretch gap-5">
          <WaterColumn level={zone.level_pct} status={zone.status} warningPct={warningPct} dangerPct={dangerPct} className="h-32" />
          <div className="flex min-w-0 flex-1 flex-col justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500"><Text>Water level</Text></p>
              <p className={cn('font-display text-5xl font-bold tabular-nums leading-none', danger ? 'text-accent-700' : alert ? 'text-accent-600' : 'text-brand-700')}>
                <CountUp value={zone.level_pct} format={(n) => `${n}%`} />
              </p>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-ink-500"><Clock className="size-3.5" aria-hidden /><Text>Updated </Text><Text>{timeAgo(zone.updated_at)}</Text></p>
          </div>
        </div>

        {zone.rising_fast && (
          <p role="status" className="mt-4 flex items-start gap-2 rounded-xl bg-accent-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm">
            <TrendingUp className="mt-0.5 size-4 shrink-0" aria-hidden />
            <Text>The water is rising fast here. Get ready to move: charge your phone and move valuables up.</Text>
          </p>
        )}
        <FloodTrend trend={zone.trend} className="mt-4" />
        <ZoneHistory zoneId={zone.id} warningPct={warningPct} dangerPct={dangerPct} />

        {zone.what && (
          <div className={cn('zone-message mt-5 rounded-2xl border-l-4 p-4 text-sm', allClear ? 'border-success-600 bg-success-50' : danger ? 'border-accent-700 bg-accent-100/70' : alert ? 'border-accent-600 bg-accent-50' : 'border-warning-600 bg-warning-50')}>
            <p className={cn('flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide', allClear ? 'text-success-700' : alert ? 'text-accent-700' : 'text-warning-700')}>
              {allClear ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Megaphone className="size-3.5" aria-hidden />}
              <Text>{allClear ? 'All clear · ' : 'Official message · '}</Text><Text>{zone.sent_at ? formatDateTime(zone.sent_at) : ''}</Text>
            </p>
            <p className="mt-1.5 font-semibold text-ink-900"><Text>{zone.what}</Text></p>
            {zone.where_text && <p className="mt-1 text-ink-700"><Text>{zone.where_text}</Text></p>}
            {zone.todo && <p className="mt-1 text-ink-700"><Text>{zone.todo}</Text></p>}
            {dropped && (
              <p className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-white/80 px-2.5 py-2 text-ink-700">
                <TrendingDown className="mt-0.5 size-3.5 shrink-0 text-success-600" aria-hidden />
                <Text>{`Since this message, the water has dropped to ${zone.level_pct}%, below the ${line}% ${danger ? 'danger' : 'warning'} line. The ${danger ? 'danger alert' : 'warning'} stays until two separate checks confirm it is safe.`}</Text>
              </p>
            )}
            {zone.next_update_at && (overdue ? (
              <p className="mt-2 flex items-center gap-1.5 font-semibold text-accent-700">
                <Clock className="size-3.5" aria-hidden /><Text>Update overdue (was due by </Text><Text>{timeOf(zone.next_update_at)}</Text><Text>). If you are in danger, call 999.</Text>
              </p>
            ) : (
              <p className="mt-2 flex items-center gap-1.5 text-ink-600">
                <Clock className="size-3.5" aria-hidden /><Text>Next update by </Text><Text>{timeOf(zone.next_update_at)}</Text>
              </p>
            ))}
          </div>
        )}

        <ul className="mt-5 space-y-2 text-sm text-ink-700">
          <li className={cn('zone-safe flex gap-3 rounded-xl px-3 py-2.5', alert ? 'bg-success-700 text-white shadow-sm' : 'bg-success-50')}>
            <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', alert ? 'bg-white/20 text-white' : 'bg-success-600 text-white')}><Navigation className="size-4" aria-hidden /></span>
            <span><span className={cn('block text-xs font-bold uppercase tracking-wide', alert ? 'text-white' : 'text-success-700')}><Text>Safe route</Text></span><Text>{zone.safe_route}</Text></span>
          </li>
          <li className="zone-safe flex gap-3 rounded-xl bg-success-50 px-3 py-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white text-success-700 ring-1 ring-success-600/30"><MapPin className="size-4" aria-hidden /></span>
            <span><span className="block text-xs font-bold uppercase tracking-wide text-success-700"><Text>Assembly point</Text></span><Text>{zone.assembly_point}</Text></span>
          </li>
        </ul>

        <p className="mt-4 flex items-center gap-1.5 text-xs text-success-700"><BadgeCheck className="size-3.5" aria-hidden />{verified(zone)}</p>
      </div>
    </article>
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
        action={<>
          <ResidentFloodWalkthrough />
          <Button href="/status" newTab variant="secondary">
            <ExternalLink className="size-4" aria-hidden />
            {t('Official status page')}
          </Button>
        </>}
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
                    <Card key={zone.id} id={isMine ? 'my-zone' : undefined} tabIndex={isMine ? -1 : undefined} className={cn('scroll-mt-28 space-y-4 p-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',zone.status === 'DANGER' && 'border-accent-300 bg-accent-50', zone.id === o.myZoneId && zone.status !== 'DANGER' && 'border-brand-300')} aria-live={isMine ? 'polite' : undefined}>
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
              <LevelLegend warningPct={o.warningPct} dangerPct={o.dangerPct} />
              <div className="grid gap-5 md:grid-cols-2">
                {[...o.zones]
                  .sort((a, b) => Number(b.id === o.myZoneId) - Number(a.id === o.myZoneId))
                  .map((zone, index) => <ZoneCard key={zone.id} zone={zone} mine={zone.id === o.myZoneId} warningPct={o.warningPct} dangerPct={o.dangerPct} index={index} />)}
              </div>
            </div>
          )
        }
      </Async>
    </AksesPage>
  );
}
