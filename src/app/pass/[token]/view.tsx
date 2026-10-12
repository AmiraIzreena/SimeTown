'use client';

import { Text } from '@/components/ui/localized-text';

import { CalendarClock, Car, MapPin, Navigation, ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/shell/logo';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { Async, EmptyState } from '@/components/ui/feedback';
import { QrCode } from '@/components/ui/qr';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface PublicPass {
  status: 'ACTIVE' | 'NOT_YET' | 'USED' | 'EXPIRED' | 'CANCELLED';
  typeLabel: string;
  visitorName: string;
  vehicleNo: string | null;
  code: string | null;
  validFrom: string;
  validUntil: string;
  township: string;
  street: string;
  gate: { name: string; lat: number; lng: number } | null;
}

const WORDS: Record<PublicPass['status'], { label: string; tone: 'success' | 'brand' | 'neutral' | 'warning'; text: string }> = {
  ACTIVE: { label: 'Valid now', tone: 'success', text: 'Show this QR code to the guard at the main gate.' },
  NOT_YET: { label: 'Not valid yet', tone: 'brand', text: 'Your pass starts later. You can show it at the gate from the start time.' },
  USED: { label: 'Already used', tone: 'neutral', text: 'This pass has been used. Ask your host for a new one.' },
  EXPIRED: { label: 'Expired', tone: 'neutral', text: 'This pass has expired. Ask your host for a new one.' },
  CANCELLED: { label: 'Cancelled', tone: 'warning', text: 'Your host cancelled this pass.' },
};

/**
 * What the visitor sees from their link. No sign-in and no app. Only the
 * street is shown, never the house number or the host's name.
 */
export function PassView({ token }: { token: string | null }) {
  const pass = useApi<PublicPass>(token ? `/passes/${token}` : null);
  return (
    <div className="min-h-dvh bg-gradient-to-b from-brand-900 to-brand-950 px-4 py-8">
      <div className="mx-auto max-w-md">
        <Logo tone="light" />
        <div className="mt-6">
          {!token ? (
            <EmptyState title="This link is not complete"><Text>Ask your host to send the pass again.</Text></EmptyState>
          ) : (
            <Async state={pass}>
              {(p) => {
                const w = WORDS[p.status];
                return (
                  <Card className="overflow-hidden">
                    <div className="border-b border-ink-100 px-6 py-5 text-center">
                      <p className="text-sm font-medium text-ink-500"><Text>{p.township}</Text></p>
                      <h1 className="mt-1 text-2xl font-bold"><Text>Visitor pass</Text></h1>
                      <Badge tone={w.tone} className="mt-2">
                        <Text>{w.label}</Text>
                      </Badge>
                    </div>
                    <div className="flex flex-col items-center gap-3 px-6 py-6">
                      {p.code ? (
                        <>
                          <QrCode value={`KITAPASS:${p.code}`} size={240} label={`Visitor pass code ${p.code}`} />
                          <p className="font-display text-3xl font-bold tracking-[0.2em] text-ink-900"><Text>{p.code}</Text></p>
                        </>
                      ) : null}
                      <p className="text-center text-[15px] text-ink-700"><Text>{w.text}</Text></p>
                    </div>
                    <dl className="space-y-3 border-t border-ink-100 px-6 py-5 text-[15px]">
                      <div className="flex gap-3">
                        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
                        <div>
                          <dt className="text-xs font-medium text-ink-500"><Text>Visitor</Text></dt>
                          <dd className="font-semibold text-ink-900">
                            {p.visitorName} · <Text>{p.typeLabel}</Text>
                          </dd>
                        </div>
                      </div>
                      {p.vehicleNo && (
                        <div className="flex gap-3">
                          <Car className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
                          <div>
                            <dt className="text-xs font-medium text-ink-500"><Text>Vehicle</Text></dt>
                            <dd className="font-semibold text-ink-900">{p.vehicleNo}</dd>
                          </div>
                        </div>
                      )}
                      <div className="flex gap-3">
                        <CalendarClock className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
                        <div>
                          <dt className="text-xs font-medium text-ink-500"><Text>Valid</Text></dt>
                          <dd className="text-ink-900">
                            <Text>{formatDateTime(p.validFrom)}</Text><Text> to </Text><Text>{formatDateTime(p.validUntil)}</Text>
                          </dd>
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <MapPin className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
                        <div>
                          <dt className="text-xs font-medium text-ink-500"><Text>Going to</Text></dt>
                          <dd className="text-ink-900">
                            <Text>{p.street}</Text>
                            <Text>{p.gate && `, through the ${p.gate.name}`}</Text>
                          </dd>
                        </div>
                      </div>
                    </dl>
                    {p.gate && (
                      <div className="grid gap-2 border-t border-ink-100 bg-ink-25 px-6 py-4 sm:grid-cols-2">
                        <Button href={`https://waze.com/ul?ll=${p.gate.lat},${p.gate.lng}&navigate=yes`}>
                          <Navigation className="size-4" aria-hidden /><Text>Open in Waze</Text></Button>
                        <Button href={`https://www.google.com/maps/dir/?api=1&destination=${p.gate.lat},${p.gate.lng}`} variant="secondary">
                          <MapPin className="size-4" aria-hidden /><Text>Google Maps</Text></Button>
                      </div>
                    )}
                  </Card>
                );
              }}
            </Async>
          )}
          <p className="mt-6 text-center text-xs text-brand-100/80"><Text>SimeTown does not ask for or keep any identity card. The guard records your name, vehicle number and the house you visit only.</Text></p>
        </div>
      </div>
    </div>
  );
}
