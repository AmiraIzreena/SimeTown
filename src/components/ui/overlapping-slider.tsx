'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { LocalizedButton, LocalizedDiv } from '@/components/ui/localized-elements';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/cn';

/**
 * Overlapping card slider, adapted from uselayouts.com's OverlappingSlider:
 * drag, swipe, arrow keys or the buttons move it; cards that leave on the left
 * recede into a stack. Transforms are written straight to the DOM while
 * dragging so the page never re-renders per frame.
 */
export function sliderStep(cardWidth: number, overlapFactor: number, cardGap: number) {
  return Math.round(cardWidth - cardWidth * overlapFactor + cardGap);
}

export function snapSliderIndex(offsetX: number, step: number, velocity: number, total: number) {
  if (total <= 1) return 0;
  let index = -offsetX / step;
  if (velocity < -350) index = Math.ceil(index);
  else if (velocity > 350) index = Math.floor(index);
  else index = Math.round(index);
  return Math.max(0, Math.min(index, total - 1));
}

/** diff = index − activeExact. Cards to the left recede; the rest stay put. */
export function cardLeave(diff: number) {
  const t = Math.min(1, Math.max(0, -diff));
  return { scale: 1 - t * 0.16, y: t * 36 };
}

interface Props<T> {
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T, index: number, isActive: boolean) => ReactNode;
  /** Card size on wide screens; on narrow screens the card shrinks to fit. */
  cardWidth?: number;
  cardHeight?: number;
  overlapFactor?: number;
  cardGap?: number;
  label: string;
  className?: string;
}

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

export function OverlappingSlider<T>({ items, getKey, renderItem, cardWidth: maxWidth = 340, cardHeight: maxHeight = 460, overlapFactor = 0.04, cardGap = 18, label, className }: Props<T>) {
  const t = useT();
  const total = items.length;
  const frameRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const dragRef = useRef({ down: false, startX: 0, origin: 0, lastX: 0, lastT: 0, velocity: 0, moved: 0 });
  const [activeIndex, setActiveIndex] = useState(0);
  const [cardWidth, setCardWidth] = useState(maxWidth);
  const cardHeight = Math.round((maxHeight * cardWidth) / maxWidth);
  const step = sliderStep(cardWidth, overlapFactor, cardGap);

  // Fit the card to narrow screens.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? maxWidth;
      setCardWidth(Math.min(maxWidth, Math.max(240, Math.round(width - 72))));
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [maxWidth]);

  const apply = (x: number, animate: boolean) => {
    offsetRef.current = x;
    const track = trackRef.current;
    if (!track) return;
    const transition = animate ? `transform 520ms ${EASE}` : 'none';
    track.style.transition = transition;
    track.style.setProperty('--ox', `${x}px`);
    const activeExact = -x / step;
    for (let i = 0; i < track.children.length; i++) {
      const card = track.children[i] as HTMLElement;
      const leave = cardLeave(i - activeExact);
      card.style.transition = animate ? `transform 520ms ${EASE}, filter 520ms ${EASE}` : 'none';
      card.style.setProperty('--y', `${leave.y}px`);
      card.style.setProperty('--s', String(leave.scale));
      card.style.setProperty('--dim', String(Math.min(1, Math.max(0, -(i - activeExact)))));
    }
  };

  const goTo = (index: number) => {
    const next = Math.max(0, Math.min(index, total - 1));
    setActiveIndex(next);
    apply(-next * step, true);
  };

  useLayoutEffect(() => {
    apply(-activeIndex * step, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-place the track only when the card size or count changes
  }, [step, total]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const drag = dragRef.current;
    Object.assign(drag, { down: true, startX: e.clientX, origin: offsetRef.current, lastX: e.clientX, lastT: e.timeStamp, velocity: 0, moved: 0 });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.down) return;
    const now = e.timeStamp;
    drag.velocity = ((e.clientX - drag.lastX) / Math.max(1, now - drag.lastT)) * 1000;
    drag.lastX = e.clientX;
    drag.lastT = now;
    drag.moved = Math.max(drag.moved, Math.abs(e.clientX - drag.startX));
    // Resist past either end, like a native scroller.
    let x = drag.origin + (e.clientX - drag.startX);
    const min = -(total - 1) * step;
    if (x > 0) x = x / 3;
    if (x < min) x = min + (x - min) / 3;
    apply(x, false);
    const predicted = Math.max(0, Math.min(Math.round(-x / step), total - 1));
    if (predicted !== activeIndex) setActiveIndex(predicted);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.down) return;
    drag.down = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    goTo(snapSliderIndex(offsetRef.current, step, drag.velocity, total));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(activeIndex + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(activeIndex - 1); }
  };

  return (
    <LocalizedDiv className={cn('relative w-full select-none', className)} role="region" aria-roledescription="carousel" aria-label={label}>
      <div
        ref={frameRef}
        tabIndex={0}
        className="flex w-full cursor-grab touch-pan-y items-center overflow-hidden rounded-3xl py-10 outline-none focus-visible:ring-2 focus-visible:ring-brand-500 active:cursor-grabbing"
        style={{ minHeight: cardHeight + 80 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <div ref={trackRef} className="flex items-end pl-6 sm:pl-10" style={{ transform: 'translate3d(var(--ox, 0px), 0, 0)' }}>
          {items.map((item, index) => (
            <div
              key={getKey(item)}
              className="slider-card shrink-0"
              aria-hidden={index !== activeIndex}
              style={{
                width: cardWidth,
                height: cardHeight,
                marginRight: cardGap - cardWidth * overlapFactor,
                zIndex: index,
                transformOrigin: '50% 90%',
                transform: 'translateY(var(--y, 0px)) scale(var(--s, 1))',
              }}
              onClick={() => { if (dragRef.current.moved < 8) goTo(index); }}
            >
              {renderItem(item, index, activeIndex === index)}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 flex w-full items-center gap-4 px-6 sm:px-10">
        <div className="flex items-center gap-2">
          <LocalizedButton type="button" aria-label="Previous" disabled={activeIndex === 0} onClick={() => goTo(activeIndex - 1)} className="slider-arrow">
            <ChevronLeft className="size-4" strokeWidth={2.25} aria-hidden />
          </LocalizedButton>
          <LocalizedButton type="button" aria-label="Next" disabled={activeIndex === total - 1} onClick={() => goTo(activeIndex + 1)} className="slider-arrow">
            <ChevronRight className="size-4" strokeWidth={2.25} aria-hidden />
          </LocalizedButton>
        </div>
        <p className="text-sm font-medium tabular-nums text-ink-500" aria-live="polite">
          {String(activeIndex + 1).padStart(2, '0')} <span className="text-ink-300">/ {String(total).padStart(2, '0')}</span>
        </p>
        <div className="ml-auto flex items-center gap-2">
          {items.map((item, i) => (
            <button
              key={getKey(item)}
              type="button"
              onClick={() => goTo(i)}
              className={cn('h-2 rounded-full transition-[width,background-color] duration-300', activeIndex === i ? 'w-8 bg-brand-600' : 'w-2 bg-ink-300 hover:bg-ink-400')}
              aria-label={t('Go to slide {n}', { n: i + 1 })}
              aria-current={activeIndex === i ? 'true' : undefined}
            />
          ))}
        </div>
      </div>
    </LocalizedDiv>
  );
}
