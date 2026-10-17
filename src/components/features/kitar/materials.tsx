import { Beer, Droplet, Milk, Newspaper, Shirt, ShoppingBag, Smartphone, Wine, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Material } from '@/shared/domain';

/**
 * One colour and one icon for each material, used everywhere the Kitar page
 * shows a material. The colour follows the material, never its rank.
 *
 * - `chart`: the donut slice. The eight were checked as a set with the dataviz
 *   palette validator (lightness, chroma, colour-blind separation, 3:1 against
 *   the page). Paper and glass sit side by side at a colour-blind distance that
 *   needs a second cue, so a name always appears beside the colour.
 * - `fg` on `bg`: the round icon. Every pair is at least 4.5:1 (WCAG AA).
 *
 * The hues come from Tailwind's palette, which the app already ships; the
 * aluminium slate is shifted towards blue so it does not read as grey.
 */
export const MATERIAL_STYLE: Record<Material, { icon: LucideIcon; chart: string; fg: string; bg: string }> = {
  PLASTIC_PET: { icon: Milk, chart: '#2563eb', fg: '#1d4ed8', bg: '#dbeafe' },
  PLASTIC_OTHER: { icon: ShoppingBag, chart: '#0d9488', fg: '#0f766e', bg: '#ccfbf1' },
  PAPER: { icon: Newspaper, chart: '#d27a00', fg: '#92400e', bg: '#fef3c7' },
  GLASS: { icon: Wine, chart: '#15803d', fg: '#15803d', bg: '#dcfce7' },
  ALUMINIUM: { icon: Beer, chart: '#3a68a6', fg: '#2f5587', bg: '#dbe5f1' },
  E_WASTE: { icon: Smartphone, chart: '#9333ea', fg: '#7e22ce', bg: '#f3e8ff' },
  TEXTILE: { icon: Shirt, chart: '#db2777', fg: '#be185d', bg: '#fce7f3' },
  COOKING_OIL: { icon: Droplet, chart: '#a47b00', fg: '#854d0e', bg: '#fef9c3' },
};

/** A material's round coloured icon. Decorative: the material's name is always shown beside it. */
export function MaterialIcon({ material, size = 'md', className }: { material: Material; size?: 'sm' | 'md'; className?: string }) {
  const style = MATERIAL_STYLE[material];
  if (!style) return null; // a material this page does not know: the name still shows
  const Icon = style.icon;
  return (
    <span aria-hidden className={cn('grid shrink-0 place-items-center rounded-full', size === 'sm' ? 'size-7' : 'size-9', className)} style={{ backgroundColor: style.bg, color: style.fg }}>
      <Icon className={size === 'sm' ? 'size-3.5' : 'size-[18px]'} />
    </span>
  );
}
