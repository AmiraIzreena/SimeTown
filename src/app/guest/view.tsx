'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedAside } from '@/components/ui/localized-elements';

import { DoorOpen, Droplets, Recycle, UserPlus } from 'lucide-react';
import { PublicFrame } from '@/components/features/public-frame';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useApi } from '@/lib/hooks';

interface StatusTownship {
  zones: { id: string; name: string; status: 'NORMAL' | 'WARNING' | 'DANGER'; level_pct: number }[];
}
interface Group {
  label: string;
  sponsors: { name: string; tagline: string | null }[];
}

/**
 * Guest mode (proposal section 5, SimeTown ID): what a visitor or a resident who
 * has not joined can do without an account. Guests are not tracked.
 */
export function GuestView() {
  const status = useApi<StatusTownship[]>('/public/flood-status', { refreshInterval: 60_000 });
  const partners = useApi<Group[]>('/public/partners');
  const zones = status.data?.flatMap((t) => t.zones) ?? [];
  const alerts = zones.filter((z) => z.status !== 'NORMAL');
  const title = partners.data?.find((g) => g.label === 'Title Partner')?.sponsors[0] ?? partners.data?.[0]?.sponsors[0];

  return (
    <PublicFrame title="Visiting City of Elmina" intro="No account needed. Check the flood status, recycle as a guest at a smart machine, and use the visitor pass your host sends you.">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <span className={alerts.length ? 'grid size-11 place-items-center rounded-md bg-warning-50 text-warning-700' : 'grid size-11 place-items-center rounded-md bg-success-50 text-success-700'}>
            <Droplets className="size-5" aria-hidden />
          </span>
          <h2 className="mt-3 text-[17px] font-semibold"><Text>Flood status</Text></h2>
          <p className="mt-1 text-sm text-ink-600"><Text>{status.data ? (alerts.length ? `${alerts.length} zone${alerts.length === 1 ? '' : 's'} under a flood alert: ${alerts.map((a) => a.name).join(', ')}.` : 'All zones are normal right now.') : 'Loading…'}</Text></p>
          <Button href="/status" variant="secondary" size="sm" className="mt-4"><Text>Open the status page</Text></Button>
        </Card>
        <Card className="p-5">
          <span className="grid size-11 place-items-center rounded-md bg-brand-50 text-brand-700">
            <Recycle className="size-5" aria-hidden />
          </span>
          <h2 className="mt-3 text-[17px] font-semibold"><Text>Recycle as a guest</Text></h2>
          <p className="mt-1 text-sm text-ink-600"><Text>Tap “Recycle as guest” on any smart machine. You get a claim code: join SimeTown within 14 days to claim the Impact XP. Guests earn no points and are not tracked.</Text></p>
        </Card>
        <Card className="p-5">
          <span className="grid size-11 place-items-center rounded-md bg-gold-50 text-gold-700">
            <DoorOpen className="size-5" aria-hidden />
          </span>
          <h2 className="mt-3 text-[17px] font-semibold"><Text>Visitor pass</Text></h2>
          <p className="mt-1 text-sm text-ink-600"><Text>Your host sends you a link by WhatsApp or SMS. Open it and show the QR code at the main gate. No app, and no identity card.</Text></p>
        </Card>
      </div>
      {title && (
        <LocalizedAside aria-label="Sponsored" className="mt-6 flex items-center justify-between gap-4 rounded-lg border border-gold-300/60 bg-gold-50 px-4 py-3">
          <p className="text-[15px] text-ink-800">
            <strong>{title.name}</strong>
            <Text>{title.tagline && ` · ${title.tagline}`}</Text>
          </p>
          <span className="shrink-0 rounded-full border border-gold-300 bg-white px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-gold-700"><Text>Sponsored</Text></span>
        </LocalizedAside>
      )}
      <Card className="mt-6 flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <h2 className="text-[17px] font-semibold"><Text>Live in the township?</Text></h2>
          <p className="text-sm text-ink-600"><Text>Join with your address to earn points at local shops, get flood alerts for your street, and send visitor passes.</Text></p>
        </div>
        <Button href="/register">
          <UserPlus className="size-4" aria-hidden /><Text>Create a resident account</Text></Button>
      </Card>
      <p className="mt-6 text-sm text-ink-500"><Text>See all our </Text><a href="/partners" className="font-semibold text-brand-700 underline underline-offset-2"><Text>partners</Text></a>.
      </p>
    </PublicFrame>
  );
}
