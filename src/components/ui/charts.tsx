
import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv } from '@/components/ui/localized-elements';
import { cn } from '@/lib/cn';

/**
 * Small, dependency-free charts. Each has a text alternative for screen
 * readers, and bars grow once when first drawn.
 */

export function BarChart({ data, series, label }: {
  data: { label: string; values: number[] }[];
  series: { name: string; className: string }[];
  label: string;
}) {
  const max = Math.max(1, ...data.flatMap((d) => d.values));
  return (
    <figure>
      <figcaption className="mb-3 flex flex-wrap gap-4 text-xs font-medium text-ink-600">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn('size-2.5 rounded-sm', s.className)} />
            {s.name}
          </span>
        ))}
      </figcaption>
      <LocalizedDiv role="img" aria-label={`${label}. ${data.map((d) => `${d.label}: ${d.values.map((v, i) => `${v} ${series[i]!.name}`).join(', ')}`).join('; ')}`} className="flex h-44 items-end gap-1.5 border-b border-ink-200 sm:gap-2.5">
        {data.map((d, index) => (
          <LocalizedDiv key={d.label} className="group flex h-full min-w-0 flex-1 items-end justify-center gap-0.5" title={`${d.label}: ${d.values.join(' / ')}`}>
            {d.values.map((value, i) => (
              <div key={i} className={cn('w-full max-w-4 origin-bottom animate-grow rounded-t-sm transition-opacity duration-200 group-hover:opacity-80', series[i]!.className)} style={{ height: `${Math.max(value > 0 ? 3 : 0, (value / max) * 100)}%`, animationDelay: `${Math.min(index, 8) * 35}ms` }} />
            ))}
          </LocalizedDiv>
        ))}
      </LocalizedDiv>
      <div aria-hidden className="mt-1.5 flex gap-1.5 text-[11px] text-ink-500 sm:gap-2.5">
        {data.map((d, i) => (
          <span key={d.label} className={cn('min-w-0 flex-1 whitespace-nowrap text-center', i % 2 === 1 && 'max-sm:invisible')}>
            <Text>{d.label}</Text>
          </span>
        ))}
      </div>
    </figure>
  );
}

/** Horizontal bars for a ranked list. */
export function RankBars({ rows, format = (n) => n.toLocaleString('en-MY'), tone = 'bg-brand-600', max: scale }: { rows: { label: string; value: number; highlight?: boolean }[]; format?: (n: number) => string; tone?: string; /** Share one scale across several lists shown side by side. */ max?: number }) {
  const max = Math.max(1, scale ?? 0, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((row, index) => (
        <li key={row.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className={cn('truncate', row.highlight ? 'font-semibold text-brand-700' : 'text-ink-700')}><Text>{row.label}</Text></span>
            <span className="shrink-0 font-semibold text-ink-900 tabular-nums"><Text>{format(row.value)}</Text></span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-ink-100">
            <div className={cn('rank-bar-fill h-full rounded-full transition-[width] duration-500 ease-soft', tone)} style={{ width: `${(row.value / max) * 100}%`, animationDelay: `${Math.min(index, 8) * 45}ms` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
