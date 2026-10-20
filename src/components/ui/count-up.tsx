'use client';

import { Text } from '@/components/ui/localized-text';

import { CountingNumber } from '@animate-ui/react/primitives/texts/counting-number';
import { useEffect, useRef, useState } from 'react';
import { useSignedInMotion } from '@/lib/use-min-loading';

/** The console's easing curve (--ease-soft): a quick start and a gentle finish. */
const EASE_SOFT = [0.22, 1, 0.36, 1] as const;
/** A live figure that changes after the first count settles quickly instead of replaying the full count. */
const UPDATE_MS = 600;

/**
 * A headline number. On signed-in screens it uses Animate UI's CountingNumber: the digits count in
 * 1s (1.4s for the hero figure) on the console's easing curve when the card comes into view; a later
 * value settles from where the count is in 0.6s, and a changed live figure tints briefly. Prefix and suffix from `format` stay put (RM, kg, %), so only
 * the digits move, with the same decimals as the formatted value. Screen readers hear the final
 * value once; reduced motion shows it at once. Public pages before login keep the simpler count.
 */
export function CountUp({ value, format = (n) => n.toLocaleString('en-MY'), duration = 1000, delay = 0 }: {
  value: number;
  format?: (n: number) => string;
  /** First count in ms: 1000 for tiles and cards, 1400 for the one hero figure. */
  duration?: number;
  /** Start later in ms, so tiles in a row count in a 60ms cascade. */
  delay?: number;
}) {
  return useSignedInMotion() ? <SpringCount value={value} format={format} duration={duration} delay={delay} /> : <SimpleCount value={value} format={format} duration={Math.min(duration, 600)} />;
}

/** Splits "RM2,954.00" into "RM", 2954 with 2 decimals, and "": the digits count, the rest stays. */
function splitFormatted(text: string) {
  const match = /^(.*?)(-?\d[\d,]*(?:\.(\d+))?)(.*)$/.exec(text);
  if (!match) return null;
  return { prefix: match[1]!, number: Number(match[2]!.replace(/,/g, '')), decimals: match[3]?.length ?? 0, suffix: match[4]! };
}

function SpringCount({ value, format, duration, delay }: { value: number; format: (n: number) => string; duration: number; delay: number }) {
  const changed = useChangeTint(value);
  const text = format(value);
  const parts = splitFormatted(text);
  return (
    <span className="relative inline-block">
      {changed > 0 && <span key={changed} aria-hidden className="value-changed absolute inset-y-0 -inset-x-1 rounded" />}
      <span className="relative">
        {parts ? (
          <>
            {parts.prefix && <Text>{parts.prefix}</Text>}
            <CountingNumber
              number={parts.number}
              decimalPlaces={parts.decimals}
              thousandSeparator=","
              inView
              delay={changed > 0 ? 0 : delay}
              transition={{ duration: (changed > 0 ? UPDATE_MS : duration) / 1000, ease: EASE_SOFT }}
            />
            {parts.suffix && <Text>{parts.suffix}</Text>}
          </>
        ) : (
          <Text>{text}</Text>
        )}
      </span>
    </span>
  );
}

/** Counts up once when first shown; later changes appear at once. Used before login. */
function SimpleCount({ value, format, duration }: { value: number; format: (n: number) => string; duration: number }) {
  const [shown, setShown] = useState(value);
  const played = useRef(false);
  const changed = useChangeTint(value);

  useEffect(() => {
    if (played.current || value === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      played.current = true;
      setShown(value);
      return;
    }
    played.current = true;
    const started = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - started) / duration);
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return changed ? (
    <span key={changed} className="value-changed -mx-1 rounded px-1"><Text>{format(shown)}</Text></span>
  ) : (
    <><Text>{format(shown)}</Text></>
  );
}

/** Counts real changes after the first value, so a live figure that moves can tint briefly. */
function useChangeTint(value: number) {
  const previous = useRef(value);
  const [changed, setChanged] = useState(0);
  useEffect(() => {
    if (value !== previous.current) setChanged((n) => n + 1);
    previous.current = value;
  }, [value]);
  return changed;
}
