'use client';

import { Text } from '@/components/ui/localized-text';

import { useEffect, useRef, useState } from 'react';

/** Counts up to a number once, when first shown. Later changes, and reduced-motion users, get the value at once. */
export function CountUp({ value, format = (n) => n.toLocaleString('en-MY') }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const played = useRef(false);

  useEffect(() => {
    if (played.current || value === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      played.current = true;
      setShown(value);
      return;
    }
    played.current = true;
    const started = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - started) / 600);
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <><Text>{format(shown)}</Text></>;
}
