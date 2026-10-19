'use client';

import { Text } from '@/components/ui/localized-text';
import { Accessibility, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { Async, EmptyState } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { PLACE_KIND_LABELS, type PlaceKind } from '@/shared/domain';

interface Place {
  id: string;
  name: string;
  kind: PlaceKind;
  location: string;
  status: 'VERIFIED' | 'REPORTED' | 'BLOCKED';
  note: string | null;
  updated_at: string;
}

/** Staff check accessible places and blocked ramps reported through Akses+. */
export default function AccessPlacesPage() {
  const places = useApi<Place[]>('/access-places');
  const review = useAction((id: string, decision: 'VERIFIED' | 'BLOCKED' | 'REMOVE') => api.post(`/admin/access-places/${id}/review`, { decision }), {
    onSuccess: () => void places.mutate(),
    success: 'Saved.',
  });

  return (
    <>
      <PageHeader title="Access places" description="Check accessible places and blocked ramps reported in Akses+." />
      <Async state={places}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState icon={Accessibility} title="No places yet" />
          ) : (
            <Card>
              <CardHeader title="Places" description="Blocked and newly suggested places first." />
              <ul className="divide-y divide-ink-100">
                {list.map((place) => (
                  <li key={place.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-ink-900">{place.name}</p>
                      <p className="text-sm text-ink-500">
                        <Text>{PLACE_KIND_LABELS[place.kind]}</Text> · <Text>{place.location}</Text> · <Text>{timeAgo(place.updated_at)}</Text>
                      </p>
                      {place.note && place.status === 'BLOCKED' && (
                        <p className="flex items-center gap-1.5 text-sm text-accent-700">
                          <TriangleAlert className="size-3.5" aria-hidden />
                          {place.note}
                        </p>
                      )}
                    </div>
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={place.status === 'VERIFIED' ? 'success' : place.status === 'BLOCKED' ? 'danger' : 'gold'}>
                        <Text>{place.status === 'VERIFIED' ? 'Checked' : place.status === 'BLOCKED' ? 'Blocked' : 'New'}</Text>
                      </Badge>
                      {place.status !== 'VERIFIED' && (
                        <Button size="sm" onClick={() => void review.run(place.id, 'VERIFIED')} disabled={review.pending}>
                          <Text>{place.status === 'BLOCKED' ? 'Cleared' : 'Confirm'}</Text>
                        </Button>
                      )}
                      {place.status === 'VERIFIED' && (
                        <Button size="sm" variant="secondary" onClick={() => void review.run(place.id, 'BLOCKED')} disabled={review.pending}>
                          <Text>Mark blocked</Text>
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => void review.run(place.id, 'REMOVE')} disabled={review.pending} aria-label={`Remove ${place.name}`}>
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )
        }
      </Async>
    </>
  );
}
