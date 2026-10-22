'use client';

import { Text } from '@/components/ui/localized-text';

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A single-series line chart in the style of Spell UI's chart: gradient fill under a 2px line,
 * tick labels along the bottom, and a cursor that snaps to the nearest point with a dot and a
 * tooltip card. The line draws itself once; the cursor glides between points. Built on plain SVG
 * at the real pixel size (no stretching, so the line never breaks) and CSS motion, with no extra
 * library. Arrow keys move the cursor for keyboard users; reduced motion turns the motion off.
 */
export function LineChart({
  data,
  labels,
  name,
  color = '#FFB06A',
  formatValue = (v) => v.toLocaleString('en-MY'),
  defaultIndex,
  tickCount = 6,
  height = 168,
  showFill = true,
  tone = 'light',
  label,
  className,
}: {
  data: number[];
  /** One label per point (for ticks and the tooltip). */
  labels?: string[];
  /** Series name shown in the tooltip. */
  name: string;
  /** Line, dot and fill colour. */
  color?: string;
  formatValue?: (value: number, index: number) => ReactNode;
  /** The point shown before anyone hovers; the latest by default. */
  defaultIndex?: number;
  tickCount?: number;
  height?: number;
  showFill?: boolean;
  /** `dark` for charts on the brand hero band. */
  tone?: 'light' | 'dark';
  /** What the chart shows, for screen readers. */
  label: string;
  className?: string;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const path = useRef<SVGPathElement>(null);
  const [width, setWidth] = useState(0);
  const [length, setLength] = useState(0);
  const last = Math.max(0, data.length - 1);
  const [active, setActive] = useState(defaultIndex ?? last);

  // Measure the real width, so the SVG is drawn 1:1 and the line stays crisp and unbroken.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const top = 12;
  const axis = 26;
  const plotH = height - top - axis;
  const max = Math.max(1, ...data);
  const min = Math.min(0, ...data);
  const x = (i: number) => (last === 0 ? width / 2 : (i / last) * width);
  const y = (v: number) => top + plotH - ((v - min) / (max - min || 1)) * plotH;
  const line = data.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(last).toFixed(1)},${top + plotH} L${x(0).toFixed(1)},${top + plotH} Z`;

  // The drawn length feeds the one-time draw animation.
  useEffect(() => {
    if (path.current && width > 0) setLength(path.current.getTotalLength());
  }, [width, line]);

  if (data.length < 2) return null;
  const ticks = Array.from(new Set(Array.from({ length: Math.min(tickCount, data.length) }, (_, n) => Math.round((n / Math.max(1, Math.min(tickCount, data.length) - 1)) * last))));
  const pick = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setActive(Math.max(0, Math.min(last, Math.round(((clientX - rect.left) / rect.width) * last))));
  };
  const onKey = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (event.key === 'Home') setActive(0);
    else if (event.key === 'End') setActive(last);
    else if (step) setActive((i) => Math.max(0, Math.min(last, i + step)));
    else return;
    event.preventDefault();
  };
  const dark = tone === 'dark';
  const cx = x(active);
  const cy = y(data[active]!);
  // Keep the tooltip inside the chart: flip it to the left of the cursor near the right edge.
  const flip = cx > width * 0.62;

  return (
    <div
      ref={box}
      role="img"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKey}
      onPointerMove={(event) => pick(event.clientX)}
      onPointerDown={(event) => pick(event.clientX)}
      onPointerLeave={() => setActive(defaultIndex ?? last)}
      className={cn('line-chart relative select-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60', className)}
      style={{ height }}
    >
      {width > 0 && (
        <svg width={width} height={height} className="block overflow-visible" aria-hidden>
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={dark ? 0.32 : 0.22} />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Recessive baseline. */}
          <line x1={0} x2={width} y1={top + plotH} y2={top + plotH} stroke={dark ? 'rgb(255 255 255 / 0.12)' : 'var(--color-ink-100)'} />
          {showFill && <path className="line-chart-area" d={area} fill={`url(#${id}-fill)`} />}
          <path
            ref={path}
            className="line-chart-line"
            d={line}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            style={length ? { strokeDasharray: length, ['--len' as string]: length } : undefined}
          />
          {/* Cursor: a thin vertical guide and a dot with a surface ring, gliding between points. */}
          <g className="line-chart-cursor" style={{ transform: `translateX(${cx}px)` }}>
            <line x1={0} x2={0} y1={top - 4} y2={top + plotH} stroke={dark ? 'rgb(255 255 255 / 0.35)' : 'var(--color-ink-300)'} strokeWidth={1} />
          </g>
          <circle className="line-chart-dot" cx={0} cy={0} r={5} fill={color} stroke={dark ? 'rgb(45 20 7)' : '#fff'} strokeWidth={2} style={{ transform: `translate(${cx}px, ${cy}px)` }} />
          {ticks.map((i) => (
            <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'} className={cn('text-[11px]', dark ? 'fill-white/55' : 'fill-ink-500')}>
              <Text>{labels?.[i] ?? String(i + 1)}</Text>
            </text>
          ))}
        </svg>
      )}
      {width > 0 && (
        <div
          aria-live="polite"
          className={cn(
            'line-chart-tip pointer-events-none absolute top-0 min-w-28 rounded-lg border px-3 py-2 text-xs shadow-lg backdrop-blur-md',
            dark ? 'border-white/10 bg-ink-900/85 text-white' : 'border-ink-100 bg-white/95 text-ink-900',
          )}
          style={{ transform: `translate(${flip ? cx - 12 : cx + 12}px, ${Math.max(0, cy - 44)}px) translateX(${flip ? '-100%' : '0'})` }}
        >
          <p className="font-semibold"><Text>{labels?.[active] ?? String(active + 1)}</Text></p>
          <p className="mt-1 flex items-center gap-2">
            <span aria-hidden className="size-2.5 rounded-sm" style={{ background: color }} />
            <span className={dark ? 'text-white/65' : 'text-ink-500'}><Text>{name}</Text></span>
            <span className="ml-auto font-semibold tabular-nums">{formatValue(data[active]!, active)}</span>
          </p>
        </div>
      )}
    </div>
  );
}
