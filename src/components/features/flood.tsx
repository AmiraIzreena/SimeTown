import { Badge } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import type { Zone } from '@/lib/types';

const TONE = { NORMAL: 'success', WARNING: 'warning', DANGER: 'danger' } as const;
const WORD = { NORMAL: 'Normal', WARNING: 'Warning', DANGER: 'Danger' } as const;
const FILL = { NORMAL: 'bg-brand-500', WARNING: 'bg-warning-600', DANGER: 'bg-accent-600' } as const;

export const FloodBadge = ({ status }: { status: Zone['status'] }) => <Badge tone={TONE[status]}>{WORD[status]}</Badge>;

/** A water-level gauge with the warning and danger lines marked on it. */
export function LevelGauge({ level, status, warningPct, dangerPct }: { level: number; status: Zone['status']; warningPct: number; dangerPct: number }) {
  return (
    <div>
      <div role="meter" aria-label="Water level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={level} aria-valuetext={`${level}%, ${WORD[status]}`} className="relative h-3 rounded-full bg-ink-100">
        <div className={cn('h-full rounded-full transition-[width,background-color] duration-500 ease-soft', FILL[status])} style={{ width: `${level}%` }} />
        <span aria-hidden className="absolute -top-1 h-5 w-0.5 bg-warning-600" style={{ left: `${warningPct}%` }} />
        <span aria-hidden className="absolute -top-1 h-5 w-0.5 bg-accent-600" style={{ left: `${dangerPct}%` }} />
      </div>
      <div aria-hidden className="relative mt-1.5 h-4 text-[11px] font-medium text-ink-500">
        <span className="absolute -translate-x-1/2" style={{ left: `${warningPct}%` }}>
          {warningPct}%
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: `${dangerPct}%` }}>
          {dangerPct}%
        </span>
      </div>
    </div>
  );
}
