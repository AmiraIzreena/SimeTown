'use client';

import { Text } from '@/components/ui/localized-text';

import { DoorOpen, Droplets, LifeBuoy, Volume2, Wallet, type LucideIcon } from 'lucide-react';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAction, useApi } from '@/lib/hooks';
import { speak, useLang, useT } from '@/lib/i18n';
import type { BanjirOverview } from '@/lib/types';
import { formatPoints, formatRM } from '@/shared/domain';

/**
 * Simple Mode (Akses+): four big buttons, read-aloud, nothing else.
 * Help sends an SOS to the guardhouse after one confirmation.
 */
export function SimpleHome({ onFullApp }: { onFullApp: () => void }) {
  const t = useT();
  const lang = useLang();
  const wallet = useApi<{ totalPoints: number }>('/wallet');
  const flood = useApi<BanjirOverview>('/banjir', { refreshInterval: 15_000 });
  const [asking, setAsking] = useState(false);
  const sos = useAction(() => api.post<{ alreadyOpen: boolean }>('/tamu/sos'), { onSuccess: () => setAsking(false), success: () => t('The guardhouse has been told. Help is coming.') });

  const myZone = flood.data?.zones.find((z) => z.id === flood.data?.myZoneId);
  const floodLine = !myZone || myZone.status === 'NORMAL' ? t('Your area is safe right now.') : myZone.status === 'WARNING' ? t('Flood warning in your area.') : t('Flood danger in your area. Leave by the safe route.');
  const pointsLine = wallet.data ? t('You have {n} points, worth {rm}.', { n: formatPoints(wallet.data.totalPoints), rm: formatRM(wallet.data.totalPoints) }) : '';

  const tiles: { label: string; icon: LucideIcon; href?: string; onClick?: () => void; tone: string }[] = [
    { label: t('Help'), icon: LifeBuoy, onClick: () => setAsking(true), tone: 'bg-accent-600 text-white hover:bg-accent-700' },
    { label: t('Visitors'), icon: DoorOpen, href: '/app/tamu', tone: 'bg-brand-700 text-white hover:bg-brand-800' },
    { label: t('Flood'), icon: Droplets, href: '/app/banjir', tone: myZone && myZone.status !== 'NORMAL' ? 'bg-warning-600 text-white hover:bg-warning-700' : 'bg-[#1f5f8b] text-white hover:bg-[#184b6e]' },
    { label: t('My points'), icon: Wallet, href: '/app/wallet', tone: 'bg-gold-500 text-ink-900 hover:bg-gold-300' },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-bold">{t('Simple Mode')}</h1>
        <div className="flex gap-2">
          <Button variant="secondary" size="lg" onClick={() => speak(`${floodLine} ${pointsLine}`, lang)}>
            <Volume2 className="size-5" aria-hidden />
            {t('Read aloud')}
          </Button>
          <Button variant="ghost" size="lg" onClick={onFullApp}>
            {t('Full app')}
          </Button>
        </div>
      </div>
      <p className="rounded-lg bg-white p-5 text-xl font-medium leading-relaxed text-ink-800 shadow-xs" aria-live="polite">
        <Text>{floodLine}</Text> <Text>{pointsLine}</Text>
      </p>
      <div className="grid grid-cols-2 gap-4">
        {tiles.map((tile) => {
          const body = (
            <>
              <tile.icon className="size-14" aria-hidden />
              <span className="mt-3 text-2xl font-bold"><Text>{tile.label}</Text></span>
            </>
          );
          const classes = cn('flex min-h-48 flex-col items-center justify-center rounded-2xl p-6 text-center shadow-sm transition-colors duration-200', tile.tone);
          return tile.href ? (
            <Link key={tile.label} href={tile.href} className={classes}>
              <Text>{body}</Text>
            </Link>
          ) : (
            <button key={tile.label} type="button" onClick={tile.onClick} className={classes}>
              <Text>{body}</Text>
            </button>
          );
        })}
      </div>
      <ConfirmDialog open={asking} onClose={() => setAsking(false)} onConfirm={() => void sos.run()} title={t('Call the guardhouse now?')} confirmLabel={t('Send SOS')} destructive pending={sos.pending}>
        <p><Text>A guard is told your address at once. In a medical emergency, also call 999.</Text></p>
      </ConfirmDialog>
    </div>
  );
}
