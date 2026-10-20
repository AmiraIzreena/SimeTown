
import { Text } from '@/components/ui/localized-text';
import { LocalizedSvg } from '@/components/ui/localized-elements';
import { cn } from '@/lib/cn';

// Hand-drawn vector of the SimeTown mark (replaces the auto-traced icon that left dark specks).
// Three squircles (superellipse, n = 4): yellow and orange trail behind the red face.
const YELLOW = 'M136 51L135.9 65.4L135.5 71.3L134.9 75.8L134.1 79.5L133 82.6L131.7 85.3L130.1 87.6L128.2 89.7L126 91.4L123.5 92.9L120.6 94.2L117.3 95.2L113.4 96L108.6 96.6L102.3 96.9L87 97L71.7 96.9L65.4 96.6L60.6 96L56.7 95.2L53.4 94.2L50.5 92.9L48 91.4L45.8 89.7L43.9 87.6L42.3 85.3L41 82.6L39.9 79.5L39.1 75.8L38.5 71.3L38.1 65.4L38 51L38.1 36.6L38.5 30.7L39.1 26.2L39.9 22.5L41 19.4L42.3 16.7L43.9 14.4L45.8 12.3L48 10.6L50.5 9.1L53.4 7.8L56.7 6.8L60.6 6L65.4 5.4L71.7 5.1L87 5L102.3 5.1L108.6 5.4L113.4 6L117.3 6.8L120.6 7.8L123.5 9.1L126 10.6L128.2 12.3L130.1 14.4L131.7 16.7L133 19.4L134.1 22.5L134.9 26.2L135.5 30.7L135.9 36.6Z';
const ORANGE = 'M123 51L122.9 66.3L122.5 72.6L121.9 77.4L121 81.3L119.9 84.6L118.5 87.5L116.8 90L114.9 92.2L112.6 94.1L110 95.7L107 97L103.5 98.1L99.5 98.9L94.5 99.5L88 99.9L72 100L56 99.9L49.5 99.5L44.5 98.9L40.5 98.1L37 97L34 95.7L31.4 94.1L29.1 92.2L27.2 90L25.5 87.5L24.1 84.6L23 81.3L22.1 77.4L21.5 72.6L21.1 66.3L21 51L21.1 35.7L21.5 29.4L22.1 24.6L23 20.7L24.1 17.4L25.5 14.5L27.2 12L29.1 9.8L31.4 7.9L34 6.3L37 5L40.5 3.9L44.5 3.1L49.5 2.5L56 2.1L72 2L88 2.1L94.5 2.5L99.5 3.1L103.5 3.9L107 5L110 6.3L112.6 7.9L114.9 9.8L116.8 12L118.5 14.5L119.9 17.4L121 20.7L121.9 24.6L122.5 29.4L122.9 35.7Z';
const RED = 'M104 51L103.9 67L103.5 73.5L102.9 78.5L102 82.5L100.8 86L99.4 89L97.7 91.6L95.7 93.9L93.4 95.8L90.8 97.5L87.7 98.9L84.2 100L80 100.9L75 101.5L68.3 101.9L52 102L35.7 101.9L29 101.5L24 100.9L19.8 100L16.3 98.9L13.2 97.5L10.6 95.8L8.3 93.9L6.3 91.6L4.6 89L3.2 86L2 82.5L1.1 78.5L0.5 73.5L0.1 67L0 51L0.1 35L0.5 28.5L1.1 23.5L2 19.5L3.2 16L4.6 13L6.3 10.4L8.3 8.1L10.6 6.2L13.2 4.5L16.3 3.1L19.8 2L24 1.1L29 0.5L35.7 0.1L52 0L68.3 0.1L75 0.5L80 1.1L84.2 2L87.7 3.1L90.8 4.5L93.4 6.2L95.7 8.1L97.7 10.4L99.4 13L100.8 16L102 19.5L102.9 23.5L103.5 28.5L103.9 35Z';

/** The SimeTown mark on its own, as crisp vector art at any size. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <LocalizedSvg viewBox="0 0 136 102" role="img" aria-label="SimeTown logo" className={cn('h-7 w-auto shrink-0', className)}>
      <path d={YELLOW} fill="#fbcd28" />
      <path d={ORANGE} fill="#fc6e02" />
      <path d={RED} fill="#d60e1a" />
      <path d="M9 30C13 16 24 7 42 5" fill="none" stroke="#fff" strokeOpacity={0.28} strokeWidth={2} strokeLinecap="round" />
      <text
        x="67"
        y="59.5"
        textAnchor="middle"
        textLength="116"
        lengthAdjust="spacingAndGlyphs"
        fontWeight={800}
        fontSize={26}
        fill="#fff"
        style={{ fontFamily: 'var(--font-display)' }}
        aria-hidden
      >
        <Text>SimeTown</Text>
      </text>
    </LocalizedSvg>
  );
}

/** The SimeTown wordmark: our own mark, not Sime Darby Property's. */
export function Logo({ tone = 'dark', className }: { tone?: 'dark' | 'light'; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-display text-xl font-extrabold tracking-tight', tone === 'light' ? 'text-white' : 'text-brand-800', className)}>
      <LogoMark />
      <span><Text>SimeTown</Text></span>
    </span>
  );
}
