'use client';

import { LocalizedDiv } from '@/components/ui/localized-elements';
import { cn } from '@/lib/cn';
import type { CSSProperties } from 'react';

type Status = 'NORMAL' | 'WARNING' | 'DANGER';
const WORD: Record<Status, string> = { NORMAL: 'Normal', WARNING: 'Warning', DANGER: 'Danger' };

/**
 * A drain gauge drawn as a column of water: two layered waves drift across the
 * surface, the fill rises to the level on first paint, and the warning and
 * danger lines are marked on the side.
 */
export function WaterColumn({ level, status, warningPct, dangerPct, className }: { level: number; status: Status; warningPct: number; dangerPct: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, level));
  return (
    <LocalizedDiv
      role="meter"
      aria-label="Water level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={`${pct}%, ${WORD[status]}`}
      className={cn('water-col relative w-16 shrink-0 overflow-hidden rounded-2xl border border-ink-200 bg-ink-50', `is-${status.toLowerCase()}`, className)}
    >
      <div className="water-fill absolute inset-x-0 bottom-0" style={{ '--level': `${pct}%` } as CSSProperties}>
        <svg aria-hidden className="water-wave water-wave-back absolute -top-3 left-0 h-4 w-[200%]" viewBox="0 0 200 16" preserveAspectRatio="none">
          <path d="M0 8 Q 12.5 0 25 8 T 50 8 T 75 8 T 100 8 T 125 8 T 150 8 T 175 8 T 200 8 V16 H0 Z" />
        </svg>
        <svg aria-hidden className="water-wave water-wave-front absolute -top-2 left-0 h-3 w-[200%]" viewBox="0 0 200 12" preserveAspectRatio="none">
          <path d="M0 6 Q 12.5 12 25 6 T 50 6 T 75 6 T 100 6 T 125 6 T 150 6 T 175 6 T 200 6 V12 H0 Z" />
        </svg>
      </div>
      {[[dangerPct, 'danger'], [warningPct, 'warning']].map(([p, kind]) => (
        <span key={kind} aria-hidden className={cn('absolute inset-x-0 border-t border-dashed', kind === 'danger' ? 'border-accent-500' : 'border-warning-600')} style={{ bottom: `${p}%` }}>
          <span className={cn('absolute -top-2 right-1 text-[9px] font-bold', kind === 'danger' ? 'text-accent-600' : 'text-warning-700')}>{p}</span>
        </span>
      ))}
    </LocalizedDiv>
  );
}
