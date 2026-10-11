'use client';

import { Text } from '@/components/ui/localized-text';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Fades content up into place the first time it enters the viewport. One
 * IntersectionObserver per element, no scroll listeners. `index` staggers a
 * group of cards. Used on the landing page only.
 */
export function Reveal({ children, index = 0, className }: { children: ReactNode; index?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    // Content is visible by default, so it still shows without JavaScript or when printed.
    // Only what starts below the fold is hidden, then revealed as it scrolls into view.
    if (!element || element.getBoundingClientRect().top < window.innerHeight) return;
    element.dataset.visible = 'false';
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          element.dataset.visible = 'true';
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.1 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className={cn('reveal', className)} style={{ '--i': index } as CSSProperties}>
      <Text>{children}</Text>
    </div>
  );
}
