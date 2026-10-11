'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedImg } from '@/components/ui/localized-elements';

import { Accessibility, Bird, Check, ImageIcon, Leaf, Trash2, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState } from '@/components/ui/feedback';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { PLACE_KIND_LABELS, WILDLIFE_KIND_LABELS, type PlaceKind, type WildlifeKind } from '@/shared/domain';

interface Sighting {
  id: string;
  kind: WildlifeKind;
  species: string;
  location: string;
  note: string | null;
  created_at: string;
  has_photo: boolean;
}
interface Place {
  id: string;
  name: string;
  kind: PlaceKind;
  location: string;
  status: 'VERIFIED' | 'REPORTED' | 'BLOCKED';
  note: string | null;
  updated_at: string;
}
type Tab = 'sightings' | 'places';

/** Staff confirm wildlife sightings (Taman) and accessible places (Akses+). A confirmed update earns the resident Impact XP. */
export default function NaturePage() {
  const [tab, setTab] = useState<Tab>('sightings');
  const sightings = useApi<Sighting[]>('/admin/taman/sightings');
  const places = useApi<Place[]>('/access-places');
  const [photo, setPhoto] = useState<Sighting | null>(null);
  const decide = useAction((id: string, confirm: boolean) => api.post(`/admin/taman/sightings/${id}`, { confirm }), { onSuccess: () => void sightings.mutate(), success: 'Saved.' });
  const review = useAction((id: string, decision: 'VERIFIED' | 'BLOCKED' | 'REMOVE') => api.post(`/admin/access-places/${id}/review`, { decision }), { onSuccess: () => void places.mutate(), success: 'Saved.' });
  const waiting = places.data?.filter((p) => p.status !== 'VERIFIED').length ?? 0;

  return (
    <>
      <PageHeader title="Nature & access" description="Confirm the wildlife residents log in Taman, and check accessible places and blocked ramps reported in Akses+." />
      <Tabs<Tab>
        label="Sections"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'sightings', label: 'Wildlife sightings', count: sightings.data?.length },
          { key: 'places', label: 'Accessible places', count: waiting },
        ]}
      />
      <TabPanel>
        {tab === 'sightings' ? (
          <Async state={sightings}>
            {(list) =>
              list.length === 0 ? (
                <EmptyState icon={Leaf} title="Nothing to confirm"><Text>New sightings from residents appear here.</Text></EmptyState>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {list.map((s) => (
                    <Card key={s.id} className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <span className="grid size-10 place-items-center rounded-md bg-success-50 text-success-700">
                          <Bird className="size-5" aria-hidden />
                        </span>
                        <span className="text-xs text-ink-500"><Text>{timeAgo(s.created_at)}</Text></span>
                      </div>
                      <p className="mt-3 text-[17px] font-semibold text-ink-900"><Text>{s.species}</Text></p>
                      <p className="text-sm text-ink-600">
                        <Text>{WILDLIFE_KIND_LABELS[s.kind]}</Text> · <Text>{s.location}</Text>
                      </p>
                      {s.note && <p className="mt-1 text-sm text-ink-600">{s.note}</p>}
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => void decide.run(s.id, true)} disabled={decide.pending}>
                          <Check className="size-4" aria-hidden /><Text>Confirm</Text></Button>
                        <Button size="sm" variant="secondary" onClick={() => void decide.run(s.id, false)} disabled={decide.pending}>
                          <X className="size-4" aria-hidden /><Text>Not confirmed</Text></Button>
                        {s.has_photo && (
                          <Button size="sm" variant="ghost" onClick={() => setPhoto(s)}>
                            <ImageIcon className="size-4" aria-hidden /><Text>Photo</Text></Button>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              )
            }
          </Async>
        ) : (
          <Async state={places}>
            {(list) =>
              list.length === 0 ? (
                <EmptyState icon={Accessibility} title="No places yet" />
              ) : (
                <Card>
                  <CardHeader title="Places" description="Blocked and newly suggested places first." />
                  <ul className="divide-y divide-ink-100">
                    {list.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                        <div className="min-w-0">
                          <p className="text-[15px] font-semibold text-ink-900">{p.name}</p>
                          <p className="text-sm text-ink-500">
                            <Text>{PLACE_KIND_LABELS[p.kind]}</Text> · <Text>{p.location}</Text> · <Text>{timeAgo(p.updated_at)}</Text>
                          </p>
                          {p.note && p.status === 'BLOCKED' && (
                            <p className="flex items-center gap-1.5 text-sm text-accent-700">
                              <TriangleAlert className="size-3.5" aria-hidden />
                              {p.note}
                            </p>
                          )}
                        </div>
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge tone={p.status === 'VERIFIED' ? 'success' : p.status === 'BLOCKED' ? 'danger' : 'gold'}><Text>{p.status === 'VERIFIED' ? 'Checked' : p.status === 'BLOCKED' ? 'Blocked' : 'New'}</Text></Badge>
                          {p.status !== 'VERIFIED' && (
                            <Button size="sm" onClick={() => void review.run(p.id, 'VERIFIED')} disabled={review.pending}>
                              <Text>{p.status === 'BLOCKED' ? 'Cleared' : 'Confirm'}</Text>
                            </Button>
                          )}
                          {p.status === 'VERIFIED' && (
                            <Button size="sm" variant="secondary" onClick={() => void review.run(p.id, 'BLOCKED')} disabled={review.pending}><Text>Mark blocked</Text></Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => void review.run(p.id, 'REMOVE')} disabled={review.pending} aria-label={`Remove ${p.name}`}>
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
        )}
      </TabPanel>
      <Modal open={photo !== null} onClose={() => setPhoto(null)} title={photo?.species ?? ''} wide>
        {photo && <LocalizedImg src={`/api/v1/taman/sightings/${photo.id}/photo`} alt={`Photo of ${photo.species}`} className="mx-auto max-h-[60vh] rounded-lg" />}
      </Modal>
    </>
  );
}
