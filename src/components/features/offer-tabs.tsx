'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedNav } from '@/components/ui/localized-elements';
import { useEffect, useState } from 'react';

const OFFER_SECTIONS = [
  { id: 'people', label: 'People' },
  { id: 'planet', label: 'Planet' },
  { id: 'business', label: 'Business' },
  { id: 'points', label: 'How points work' },
  { id: 'who', label: 'Who it is for' },
];

/** Sticky section tabs for the "What we offer" page. The tab for the section in view lights up. */
export function OfferTabs({ sections = OFFER_SECTIONS }: { sections?: { id: string; label: string }[] }) {
  const [active, setActive] = useState(sections[0]!.id);

  // The section in view is the last one whose top has passed just under the two sticky bars.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = sections[0]!.id;
      for (const section of sections) {
        const element = document.getElementById(section.id);
        if (element && element.getBoundingClientRect().top <= 180) current = section.id;
      }
      setActive(current);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, [sections]);

  return (
    <div className="offer-tabs sticky top-[72px] z-30 border-b border-ink-100">
      <LocalizedNav aria-label="Sections" className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-5 py-3 sm:px-8">
        {sections.map((section) => (
          <a key={section.id} href={`#${section.id}`} className="offer-tab" aria-current={active === section.id ? 'true' : undefined}>
            <Text>{section.label}</Text>
          </a>
        ))}
      </LocalizedNav>
    </div>
  );
}
