
import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv } from '@/components/ui/localized-elements';
import { Badge } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { Zone } from '@/lib/types';
import { WARNING_SOURCE_LABELS, type WarningSource } from '@/shared/domain';

const TONE = { NORMAL: 'success', WARNING: 'warning', DANGER: 'danger' } as const;
const WORD = { NORMAL: 'Normal', WARNING: 'Warning', DANGER: 'Danger' } as const;
const FILL = { NORMAL: 'bg-brand-500', WARNING: 'bg-warning-600', DANGER: 'bg-accent-600' } as const;

export const FloodBadge = ({ status }: { status: Zone['status'] }) => <Badge tone={TONE[status]}><Text>{WORD[status]}</Text></Badge>;

/** A water-level gauge with the warning and danger lines marked on it. */
export function LevelGauge({ level, status, warningPct, dangerPct }: { level: number; status: Zone['status']; warningPct: number; dangerPct: number }) {
  return (
    <div>
      <LocalizedDiv role="meter" aria-label="Water level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={level} aria-valuetext={`${level}%, ${WORD[status]}`} className="relative h-3 rounded-full bg-ink-100">
        <div className={cn('water-level-fill h-full rounded-full transition-[width,background-color] duration-500 ease-soft', FILL[status])} style={{ width: `${level}%` }} />
        <span aria-hidden className="absolute -top-1 h-5 w-0.5 bg-warning-600" style={{ left: `${warningPct}%` }} />
        <span aria-hidden className="absolute -top-1 h-5 w-0.5 bg-accent-600" style={{ left: `${dangerPct}%` }} />
      </LocalizedDiv>
      <div aria-hidden className="relative mt-1.5 h-4 text-[11px] font-medium text-ink-500">
        <span className="absolute -translate-x-1/2" style={{ left: `${warningPct}%` }}>
          <Text>{warningPct}</Text>%
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: `${dangerPct}%` }}>
          <Text>{dangerPct}</Text>%
        </span>
      </div>
    </div>
  );
}

/** Where a zone's level was last confirmed (Appendix E.1): a healthy sensor's reading, or the duty officer. */
export interface Verified {
  verified_at: string | null;
  verified_by: 'SENSOR' | 'MANUAL' | null;
  sensors_ok: number | null;
  /** What backed the latest warning (Appendix E.1); null while the zone is normal. */
  sources?: WarningSource[] | null;
}

/**
 * "Last verified 2 min ago by 2 drain sensors · Source: water-level sensor + CCTV",
 * shown on every warning and zone: when the level was last confirmed, and what the warning came from.
 */
export function useVerifiedText() {
  const t = useT();
  const verifiedText = (v: Verified) => {
    if (!v.verified_at) return t('No sensor reading yet');
    const time = t(timeAgo(v.verified_at));
    if (v.verified_by === 'MANUAL') return t('Last verified {time} by the duty officer', { time });
    return (v.sensors_ok ?? 0) > 1 ? t('Last verified {time} by {n} drain sensors', { time, n: v.sensors_ok! }) : t('Last verified {time} by a drain sensor', { time });
  };
  return (v: Verified) => {
    const verified = verifiedText(v);
    if (!v.sources?.length) return verified;
    return `${verified} · ${t('Source: {sources}', { sources: v.sources.map((x) => t(WARNING_SOURCE_LABELS[x])).join(' + ') })}`;
  };
}

/**
 * A zone's water level over the last hours, with the warning and danger lines.
 * Drawn in the page; the numbers are also given as text for screen readers.
 */
export function LevelHistory({ points, warningPct, dangerPct, className }: { points: { at: string; pct: number }[]; warningPct: number; dangerPct: number; className?: string }) {
  const t = useT();
  if (points.length < 2) return <p className={cn('text-xs text-ink-500', className)}>{t('Not enough readings yet to draw the last hours.')}</p>;
  const W = 300;
  const H = 72;
  const start = new Date(points[0]!.at).getTime();
  const span = Math.max(1, new Date(points.at(-1)!.at).getTime() - start);
  const x = (at: string) => ((new Date(at).getTime() - start) / span) * W;
  const y = (pct: number) => H - (pct / 100) * H;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)} ${y(p.pct).toFixed(1)}`).join(' ');
  const peak = Math.max(...points.map((p) => p.pct));
  const last = points.at(-1)!;
  return (
    <figure className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-16 w-full overflow-visible" role="img" aria-label={t('Water level over the last hours: now {now}%, highest {peak}%.', { now: last.pct, peak })}>
        <line x1={0} x2={W} y1={y(warningPct)} y2={y(warningPct)} className="stroke-warning-600" strokeDasharray="4 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <line x1={0} x2={W} y1={y(dangerPct)} y2={y(dangerPct)} className="stroke-accent-600" strokeDasharray="4 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <path d={`${line} L${W} ${H} L0 ${H} Z`} className="fill-brand-500/15" />
        <path d={line} className="fill-none stroke-brand-600" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <figcaption className="mt-1 flex justify-between text-[11px] text-ink-500">
        <span>{t('{n} hours ago', { n: Math.round(span / 3_600_000) || 1 })}</span>
        <span>{t('Highest {peak}%', { peak })}</span>
        <span>{t('Now')}</span>
      </figcaption>
    </figure>
  );
}
