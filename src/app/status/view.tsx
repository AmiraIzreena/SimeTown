'use client';

import { Text } from '@/components/ui/localized-text';

import { Clock, MapPin, Megaphone, Navigation } from 'lucide-react';
import { FloodBadge, LevelGauge } from '@/components/features/flood';
import { PublicFrame } from '@/components/features/public-frame';
import { Card } from '@/components/ui/card';
import { Async, EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { formatDateTime, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface StatusZone {
  id: string;
  name: string;
  status: 'NORMAL' | 'WARNING' | 'DANGER';
  level_pct: number;
  safe_route: string;
  assembly_point: string;
  updated_at: string;
  message_kind: string | null;
  what: string | null;
  where_text: string | null;
  todo: string | null;
  next_update_at: string | null;
  sent_at: string | null;
}

/**
 * The one official status page (proposal 6.5, "Update"): the single source of
 * truth during a flood, readable without the app or an account. It shows
 * zones and official messages only, never anything about a person.
 */
export function StatusView() {
  const status = useApi<{ id: string; name: string; warningPct: number; dangerPct: number; zones: StatusZone[] }[]>('/public/flood-status', { refreshInterval: 30_000 });
  return (
    <PublicFrame title="Flood status" intro="The official status of every flood zone, updated every 15 minutes while an alert is open. Share this link in WhatsApp groups instead of forwarding rumours.">
      <Async state={status}>
        {(townships) =>
          townships.length === 0 ? (
            <EmptyState title="No townships yet" />
          ) : (
            <div className="space-y-8">
              {townships.map((t) => (
                <section key={t.id} aria-labelledby={`t-${t.id}`}>
                  <h2 id={`t-${t.id}`} className="mb-3 text-xl font-semibold">
                    {t.name}
                  </h2>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {t.zones.map((z) => (
                      <Card key={z.id} className={cn('p-5', z.status === 'DANGER' && 'border-accent-200 bg-accent-50/60', z.status === 'WARNING' && 'border-warning-600/30 bg-warning-50/60')}>
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-[17px] font-semibold">{z.name}</h3>
                          <FloodBadge status={z.status} />
                        </div>
                        <p className="mt-3 font-display text-4xl font-bold tabular-nums"><Text>{z.level_pct}</Text>%</p>
                        <div className="mt-3">
                          <LevelGauge level={z.level_pct} status={z.status} warningPct={t.warningPct} dangerPct={t.dangerPct} />
                        </div>
                        {z.what && (
                          <div className="mt-4 space-y-1 border-t border-ink-100 pt-3 text-sm">
                            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
                              <Megaphone className="size-3.5" aria-hidden /><Text>Official message · </Text><Text>{z.sent_at ? formatDateTime(z.sent_at) : ''}</Text>
                            </p>
                            <p className="font-semibold text-ink-900"><Text>{z.what}</Text></p>
                            <p className="text-ink-700"><Text>{z.todo}</Text></p>
                            {z.next_update_at && (
                              <p className="flex items-center gap-1.5 text-ink-600">
                                <Clock className="size-3.5" aria-hidden /><Text>Next update by </Text><Text>{new Date(z.next_update_at).toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })}</Text>
                              </p>
                            )}
                          </div>
                        )}
                        <ul className="mt-4 space-y-1.5 text-sm text-ink-700">
                          <li className="flex gap-2">
                            <Navigation className="mt-0.5 size-4 shrink-0 text-ink-500" aria-hidden />
                            <Text>{z.safe_route}</Text>
                          </li>
                          <li className="flex gap-2">
                            <MapPin className="mt-0.5 size-4 shrink-0 text-ink-500" aria-hidden />
                            <Text>{z.assembly_point}</Text>
                          </li>
                        </ul>
                        <p className="mt-3 text-xs text-ink-500"><Text>Updated </Text><Text>{timeAgo(z.updated_at)}</Text></p>
                      </Card>
                    ))}
                  </div>
                </section>
              ))}
              <p className="text-sm text-ink-500"><Text>In an emergency call 999. Warnings are raised from drain sensors and camera readings; two signals must agree before the highest alert goes out by itself, and a person checks the rest.</Text></p>
            </div>
          )
        }
      </Async>
    </PublicFrame>
  );
}
