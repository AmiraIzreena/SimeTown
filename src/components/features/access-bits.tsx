'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedInput } from '@/components/ui/localized-elements';

import { Camera, CircleCheck, CircleDashed, CircleHelp, Clock3, OctagonAlert, ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX, TriangleAlert, Wrench } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/field';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { shrinkPhoto } from '@/lib/image';
import {
  ACCESS_CATEGORY_INFO, ACCESS_STATUS_LABELS, AVAILABILITY_HINTS, AVAILABILITY_LABELS, VERIFICATION_LABELS,
  type AccessCategory, type AccessIncidentStatus, type Availability, type Verification,
} from '@/shared/akses';
import { PLACE_KIND_LABELS, type PlaceKind } from '@/shared/domain';
import { PRIORITY_LABELS, type Priority } from '@/shared/incidents';

/**
 * Akses+ building blocks shared by the resident page, the console and the
 * guard screen. Every status pairs its colour with an icon and words, so it
 * never depends on colour alone.
 */

const VERIFICATION_STYLE: Record<Verification, { tone: 'success' | 'gold' | 'warning' | 'neutral'; icon: typeof ShieldCheck }> = {
  VERIFIED: { tone: 'success', icon: ShieldCheck },
  PENDING_VERIFICATION: { tone: 'gold', icon: ShieldQuestion },
  VERIFICATION_REQUIRED: { tone: 'warning', icon: ShieldAlert },
  NOT_VERIFIED: { tone: 'neutral', icon: ShieldX },
};
export function VerificationBadge({ value }: { value: Verification }) {
  const { tone, icon: Icon } = VERIFICATION_STYLE[value];
  return <Badge tone={tone}><Icon className="size-3.5" aria-hidden /><Text>{VERIFICATION_LABELS[value]}</Text></Badge>;
}

const AVAILABILITY_STYLE: Record<Availability, { tone: 'success' | 'warning' | 'danger' | 'brand' | 'neutral'; icon: typeof CircleCheck }> = {
  AVAILABLE: { tone: 'success', icon: CircleCheck },
  REPORTED_BLOCKED: { tone: 'warning', icon: TriangleAlert },
  CONFIRMED_BLOCKED: { tone: 'danger', icon: OctagonAlert },
  RESOLUTION_PENDING: { tone: 'brand', icon: Clock3 },
  UNKNOWN: { tone: 'neutral', icon: CircleHelp },
};
export function AvailabilityBadge({ value }: { value: Availability }) {
  const { tone, icon: Icon } = AVAILABILITY_STYLE[value];
  return <Badge tone={tone}><Icon className="size-3.5" aria-hidden /><Text>{AVAILABILITY_LABELS[value]}</Text></Badge>;
}
export const availabilityHint = (value: Availability) => AVAILABILITY_HINTS[value];

const STATUS_TONE: Record<AccessIncidentStatus, 'neutral' | 'brand' | 'gold' | 'success' | 'warning' | 'danger'> = {
  REPORTED: 'neutral', TRIAGED: 'neutral', ASSIGNED: 'brand', IN_PROGRESS: 'brand', RESOLUTION_SUBMITTED: 'gold',
  VERIFICATION_PENDING: 'gold', RESOLVED: 'success', REOPENED: 'warning', ESCALATED: 'danger',
};
export function IncidentStatusBadge({ value }: { value: AccessIncidentStatus }) {
  return <Badge tone={STATUS_TONE[value]}><CircleDashed className="size-3.5" aria-hidden /><Text>{ACCESS_STATUS_LABELS[value]}</Text></Badge>;
}

const PRIORITY_TONE: Record<Priority, 'danger' | 'warning' | 'neutral' | 'brand'> = { CRITICAL: 'danger', HIGH: 'warning', NORMAL: 'brand', LOW: 'neutral' };
export function PriorityBadge({ value }: { value: Priority }) {
  return <Badge tone={PRIORITY_TONE[value]}><Text>{PRIORITY_LABELS[value]}</Text></Badge>;
}

export const categoryLabel = (c: AccessCategory) => ACCESS_CATEGORY_INFO[c]?.label ?? c;
export const kindLabel = (k: PlaceKind) => PLACE_KIND_LABELS[k];

/** A photo picker that shows the chosen file's name. The photo is shrunk before upload. */
export function PhotoField({ label, onChange, name }: { label: string; onChange: (file: File | null) => void; name: string | null }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-ink-300 px-4 py-3 text-[15px] text-ink-700 hover:border-brand-500 hover:bg-brand-50/40 focus-within:ring-2 focus-within:ring-brand-500">
      <Camera className="size-5 shrink-0 text-ink-500" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{name ?? <Text>{label}</Text>}</span>
      <LocalizedInput type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" aria-label={label} onChange={(event) => onChange(event.target.files?.[0] ?? null)} />
    </label>
  );
}

/** A multipart form with text fields and an optional photo, ready for api.post. */
export async function formWith(fields: Record<string, string | undefined>, photo: File | null): Promise<FormData> {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== '') data.set(k, v);
  if (photo) data.set('photo', await shrinkPhoto(photo), 'photo.jpg');
  return data;
}

export interface WorkIncident {
  id: string;
  reference: string;
  category: AccessCategory;
  priority: Priority;
  status: AccessIncidentStatus;
  place_name: string;
  place_location: string;
  party_name: string;
  acknowledged_at: string | null;
  resolution_submitted_at: string | null;
  ack_due_at: string | null;
  resolve_due_at: string | null;
  created_at: string;
  reports: { description: string | null; photo_id: string | null; at: string }[] | null;
}

/**
 * The work routed to the teams the signed-in person belongs to: a guard on the
 * security team, a facilities officer. Acknowledge, then submit the fix with a
 * photo; residents or staff verify it before the place shows as available.
 */
export function AccessWorkCard() {
  const work = useApi<{ parties: { id: string; name: string }[]; incidents: WorkIncident[] }>('/access-work', { refreshInterval: 60_000 });
  const [fixing, setFixing] = useState<WorkIncident | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const ack = useAction((id: string) => api.post(`/access-work/${id}/acknowledge`), { onSuccess: () => void work.mutate(), success: 'Acknowledged. Residents are told it is being fixed.' });
  const resolve = useAction(async (id: string, actionTaken: string) => api.post(`/access-work/${id}/resolve`, await formWith({ actionTaken }, photo)), {
    onSuccess: () => {
      setFixing(null);
      setPhoto(null);
      void work.mutate();
    },
    success: 'Fix submitted. It shows as fixed once it is confirmed.',
  });
  if (work.data && work.data.parties.length === 0) return null;
  return (
    <Card id="access">
      <CardHeader title="Accessibility issues for your team" description="Sent to your team by the assignment rules, or because you are the default team. Acknowledge, fix, then add a photo of the result." />
      <Async state={work}>
        {(w) =>
          w.incidents.length === 0 ? (
            <div className="p-5"><EmptyState icon={CircleCheck} title="Nothing open for your team" /></div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {w.incidents.map((i) => {
                const overdue = i.resolve_due_at && new Date(i.resolve_due_at) < new Date() && !i.resolution_submitted_at;
                return (
                  <li key={i.id} className="space-y-2 px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-ink-500">{i.reference}</span>
                      <PriorityBadge value={i.priority} />
                      <IncidentStatusBadge value={i.status} />
                      {overdue && <Badge tone="danger"><Text>Overdue</Text></Badge>}
                    </div>
                    <p className="text-[15px] font-semibold text-ink-900"><Text>{categoryLabel(i.category)}</Text>: {i.place_name}</p>
                    <p className="text-sm text-ink-500">{i.place_location} · <Text>{timeAgo(i.created_at)}</Text></p>
                    {i.reports?.filter((r) => r.description).slice(0, 3).map((r, n) => (
                      <p key={n} className="text-sm text-ink-700">“{r.description}”</p>
                    ))}
                    {i.reports?.some((r) => r.photo_id) && (
                      <div className="flex flex-wrap gap-2">
                        {i.reports.filter((r) => r.photo_id).slice(0, 3).map((r) => (
                          <a key={r.photo_id} href={`/api/v1/access-photos/${r.photo_id}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand-700 underline"><Text>Reported photo</Text></a>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {!i.acknowledged_at && !i.resolution_submitted_at && (
                        <Button size="sm" onClick={() => void ack.run(i.id)} disabled={ack.pending}><Text>Acknowledge</Text></Button>
                      )}
                      {!i.resolution_submitted_at && (
                        <Button size="sm" variant="secondary" onClick={() => setFixing(i)}><Wrench className="size-4" aria-hidden /><Text>Submit fix</Text></Button>
                      )}
                      {i.resolution_submitted_at && <p className="text-sm text-ink-600"><Text>Fix submitted. Waiting for confirmation.</Text></p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        }
      </Async>
      <Modal
        open={fixing !== null}
        onClose={() => setFixing(null)}
        title="Submit the fix"
        description="Residents or staff confirm it before the place shows as available again."
        footer={<Button type="submit" form="access-fix" pending={resolve.pending}><Text>Submit</Text></Button>}
      >
        <form
          id="access-fix"
          method="post"
          className="space-y-4"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            if (fixing) void resolve.run(fixing.id, String(new FormData(event.currentTarget).get('actionTaken') ?? ''));
          }}
        >
          <Textarea name="actionTaken" label="What was done?" required minLength={5} maxLength={500} rows={3} error={resolve.fields.actionTaken} placeholder="e.g. Motorcycles moved; owners warned; cones placed" />
          <PhotoField label="Photo of the result" name={photo?.name ?? null} onChange={setPhoto} />
          {resolve.fields.photo && <p className="text-sm text-accent-700"><Text>{resolve.fields.photo}</Text></p>}
        </form>
      </Modal>
    </Card>
  );
}
