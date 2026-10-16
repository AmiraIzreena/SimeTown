'use client';

import { Text } from '@/components/ui/localized-text';
import { Award, Handshake, Megaphone } from 'lucide-react';
import Image from 'next/image';
import { sponsorImage } from '@/components/features/showcase-content';
import { Async, EmptyState } from '@/components/ui/feedback';
import { OverlappingSlider } from '@/components/ui/overlapping-slider';
import { useApi } from '@/lib/hooks';
import { cn } from '@/lib/cn';
import { SPONSOR_TIER_INFO, type SponsorTier } from '@/shared/domain';

interface Group {
  tier: SponsorTier;
  label: string;
  sponsors: { name: string; category: string | null; tagline: string | null }[];
}
interface Sponsor {
  key: string;
  name: string;
  tier: SponsorTier;
  category: string | null;
  tagline: string | null;
  image: string;
}

const DEMO_SUFFIX = /\s*\(demo sponsor\)\s*$/i;

function SponsorCard({ sponsor, active }: { sponsor: Sponsor; active: boolean }) {
  const top = sponsor.tier === 'GREEN_CHAMPION' || sponsor.tier === 'TITLE_PARTNER';
  const challenges = SPONSOR_TIER_INFO[sponsor.tier].challenges;
  return (
    <article className={cn('sponsor-card relative flex h-full w-full flex-col justify-between overflow-hidden rounded-[32px] bg-brand-950 p-5 text-white', active && 'is-active')}>
      <Image src={sponsor.image} alt="" fill sizes="340px" loading="eager" draggable={false} className="sponsor-card-img pointer-events-none object-cover" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgb(20_8_3/0.35)_0%,transparent_28%,transparent_42%,rgb(45_20_7/0.92)_78%,#2d1407_100%)]" />

      <div className="relative flex items-center justify-between gap-2">
        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold backdrop-blur-md', top ? 'bg-gold-300 text-brand-950' : 'border border-white/25 bg-black/25 text-white')}>
          <Award className="size-3.5" aria-hidden />
          <Text>{SPONSOR_TIER_INFO[sponsor.tier].label}</Text>
        </span>
      </div>

      <div className="relative">
        {sponsor.category && <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold-300"><Text>{sponsor.category}</Text></p>}
        <h3 className="mt-1.5 text-2xl font-bold leading-tight tracking-tight text-white">{sponsor.name}</h3>
        {sponsor.tagline && <p className="mt-2 text-sm leading-relaxed text-white/80"><Text>{sponsor.tagline}</Text></p>}
        <div className="mt-4 flex items-center gap-2 border-t border-white/15 pt-4 text-sm">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10"><Megaphone className="size-4 text-gold-300" aria-hidden /></span>
          <span className="font-semibold">
            <Text>{challenges === null ? 'Unlimited challenges' : challenges === 1 ? 'One challenge a year' : `${challenges} challenges a year`}</Text>
          </span>
        </div>
      </div>
    </article>
  );
}

/** The township's current sponsors (the public Partners data), highest tier first, as an overlapping slider. */
export function SponsorSlider() {
  const partners = useApi<Group[]>('/public/partners');
  return (
    <Async state={partners}>
      {(groups) => {
        const sponsors: Sponsor[] = groups.flatMap((g) => g.sponsors.map((s, i) => ({
          key: `${g.tier}-${s.name}`,
          name: s.name.replace(DEMO_SUFFIX, ''),
          tier: g.tier,
          category: s.category,
          tagline: s.tagline,
          image: sponsorImage(s.category, i),
        })));
        return sponsors.length === 0 ? (
          <div className="px-5 py-10 sm:px-8"><EmptyState icon={Handshake} title="No sponsors yet" /></div>
        ) : (
          <OverlappingSlider label="Our sponsors" items={sponsors} getKey={(s) => s.key} renderItem={(s, _i, active) => <SponsorCard sponsor={s} active={active} />} cardWidth={320} cardHeight={440} />
        );
      }}
    </Async>
  );
}
