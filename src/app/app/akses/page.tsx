'use client';

import { Text } from '@/components/ui/localized-text';

import { Accessibility, HeartHandshake, Lock, MapPin, Plus, Trash2, TriangleAlert, UserRound, Volume2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { Async, EmptyState } from '@/components/ui/feedback';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { speak, useLang } from '@/lib/i18n';
import { ACCESS_NEEDS, ACCESS_NEED_LABELS, PLACE_KINDS, PLACE_KIND_LABELS, type AccessNeed, type PlaceKind } from '@/shared/domain';

interface Profile {
  needs: AccessNeed[];
  simpleMode: boolean;
  readAloud: boolean;
  flashAlerts: boolean;
  priorityHelp: boolean;
  priorityNote: string | null;
  consentAt: string | null;
}
interface Carers {
  myCarers: { id: string; status: 'PENDING' | 'ACTIVE'; full_name: string }[];
  caringFor: { id: string; status: 'PENDING' | 'ACTIVE'; full_name: string; zone_name?: string; zone_status?: string; checked_in?: string | null }[];
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

const PLACE_STATUS = { VERIFIED: { label: 'Checked', tone: 'success' as const }, REPORTED: { label: 'Waiting for a check', tone: 'neutral' as const }, BLOCKED: { label: 'Reported blocked', tone: 'danger' as const } };

/** Akses+ (proposal 6.6): tell the app your access needs once, and every feature adapts. */
export default function AksesPage() {
  const lang = useLang();
  const profile = useApi<Profile>('/me/access');
  const carers = useApi<Carers>('/carers');
  const places = useApi<Place[]>('/access-places');
  const [draft, setDraft] = useState<Profile | null>(null);
  const [consent, setConsent] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [blocked, setBlocked] = useState<Place | null>(null);
  const [carerCode, setCarerCode] = useState('');

  const p = draft ?? profile.data;
  const edit = (change: Partial<Profile>) => p && setDraft({ ...p, ...change });
  const save = useAction(
    () =>
      api.post<Profile>('/me/access', {
        needs: p!.needs,
        simpleMode: p!.simpleMode,
        readAloud: p!.readAloud,
        flashAlerts: p!.flashAlerts,
        priorityHelp: p!.priorityHelp,
        priorityNote: p!.priorityNote || undefined,
        consent: consent || Boolean(profile.data?.consentAt),
      }),
    {
      onSuccess: (saved) => {
        setDraft(null);
        void profile.mutate(saved, { revalidate: false });
      },
      success: 'Saved. The app now adapts to you.',
    },
  );
  const remove = useAction(() => api.post<Profile>('/me/access/delete'), {
    onSuccess: (cleared) => {
      setDraft(null);
      setConfirmDelete(false);
      setConsent(false);
      void profile.mutate(cleared, { revalidate: false });
    },
    success: 'Your access needs are deleted.',
  });
  const invite = useAction(() => api.post<{ status: string }>('/carers', { memberCode: carerCode.trim() }), {
    onSuccess: () => {
      setCarerCode('');
      void carers.mutate();
    },
    success: 'Invitation sent. They need to accept it.',
  });
  const respond = useAction((id: string, accept: boolean) => api.post(`/carers/${id}/respond`, { accept }), { onSuccess: () => void carers.mutate(), success: 'Saved.' });
  const end = useAction((id: string) => api.post(`/carers/${id}/end`), { onSuccess: () => void carers.mutate(), success: 'The link has ended.' });
  const suggest = useAction((body: Record<string, string>) => api.post('/access-places', body), {
    onSuccess: () => {
      setSuggesting(false);
      void places.mutate();
    },
    success: 'Thank you. Staff will check it; a confirmed update earns Impact XP.',
  });
  const report = useAction((id: string, note: string) => api.post(`/access-places/${id}/blocked`, { note }), {
    onSuccess: () => {
      setBlocked(null);
      void places.mutate();
    },
    success: 'Reported. The township team has been told.',
  });

  const needsConsent = Boolean(p && (p.needs.length > 0 || p.priorityHelp) && !profile.data?.consentAt);

  return (
    <>
      <PageHeader title="Akses+" description="Tell the app what helps you, once. Every feature adapts: Simple Mode, read-aloud, flashing alerts, step-free places, and a priority help list for floods." />
      <div className="space-y-6">
        <Async state={profile}>
          {() =>
            p && (
              <Card>
                <CardHeader
                  title="My access needs"
                  description="Private. Seen only by you, and by duty staff during an emergency if you join the priority list. Deleted whenever you ask."
                  action={
                    <Badge tone="brand">
                      <Lock className="size-3.5" aria-hidden /><Text>Private</Text></Badge>
                  }
                />
                <div className="grid gap-6 p-5 lg:grid-cols-2">
                  <fieldset className="space-y-2.5">
                    <legend className="mb-2 text-[15px] font-semibold text-ink-900"><Text>What applies to you? (optional)</Text></legend>
                    {ACCESS_NEEDS.map((need) => (
                      <Checkbox key={need} label={ACCESS_NEED_LABELS[need]} checked={p.needs.includes(need)} onChange={(event) => edit({ needs: event.target.checked ? [...p.needs, need] : p.needs.filter((n) => n !== need) })} />
                    ))}
                  </fieldset>
                  <div className="space-y-3 divide-y divide-ink-100">
                    <Switch label="Simple Mode" hint="Four big buttons on your home screen: Help, Visitors, Flood, My points." checked={p.simpleMode} onChange={(v) => edit({ simpleMode: v })} />
                    <div className="pt-3">
                      <Switch label="Read alerts aloud" hint="Flood warnings and Simple Mode are read out by your phone’s own voice." checked={p.readAloud} onChange={(v) => edit({ readAloud: v })} />
                      <Button variant="ghost" size="sm" className="mt-1" onClick={() => speak(lang === 'ms' ? 'Ini contoh suara KITA+.' : 'This is how KITA+ sounds when it reads aloud.', lang)}>
                        <Volume2 className="size-4" aria-hidden /><Text>Try it</Text></Button>
                    </div>
                    <div className="pt-3">
                      <Switch label="Flash and vibrate for alerts" hint="For deaf and hard-of-hearing residents. One flash a second, within the safe limit." checked={p.flashAlerts} onChange={(v) => edit({ flashAlerts: v })} />
                    </div>
                    <div className="pt-3">
                      <Switch label="Priority help list for floods" hint="In a flood warning, staff phone homes on this list first." checked={p.priorityHelp} onChange={(v) => edit({ priorityHelp: v })} />
                      {p.priorityHelp && (
                        <Input label="Anything staff should know (optional)" value={p.priorityNote ?? ''} onChange={(event) => edit({ priorityNote: event.target.value })} maxLength={200} className="mt-3" placeholder="e.g. Uses a walking frame; lives alone" />
                      )}
                    </div>
                  </div>
                </div>
                <div className="space-y-4 border-t border-ink-100 p-5">
                  {needsConsent && (
                    <Checkbox
                      label="I agree that KITA+ keeps these access needs to adapt the app for me, and shows my name, address and note to duty staff during a flood alert if I join the priority list. I can delete them at any time."
                      checked={consent}
                      onChange={(event) => setConsent(event.target.checked)}
                      error={save.fields.consent}
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void save.run()} pending={save.pending} disabled={!draft || (needsConsent && !consent)}><Text>Save</Text></Button>
                    {profile.data?.consentAt && (
                      <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                        <Trash2 className="size-4" aria-hidden /><Text>Delete my access needs</Text></Button>
                    )}
                  </div>
                </div>
              </Card>
            )
          }
        </Async>

        <Card>
          <CardHeader title="Carers" description="A family member who is also a resident can be your carer. They hear about flood alerts in your area and see whether you have checked in safe. Never your access needs." />
          <div className="grid gap-6 p-5 lg:grid-cols-2">
            <div className="space-y-3">
              <form
                method="post"
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event: FormEvent) => {
                  event.preventDefault();
                  void invite.run();
                }}
              >
                <Input label="Their member code" value={carerCode} onChange={(event) => setCarerCode(event.target.value.toUpperCase())} maxLength={12} autoComplete="off" className="min-w-0 flex-1 basis-40" error={invite.fields.memberCode} hint="They find it under Points & XP, “Show my code”." />
                <Button type="submit" pending={invite.pending} disabled={carerCode.trim().length < 6} className="mb-[26px]">
                  <HeartHandshake className="size-4" aria-hidden /><Text>Ask</Text></Button>
              </form>
              <Async state={carers}>
                {(c) => (
                  <ul className="space-y-2">
                    {c.myCarers.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-ink-200 p-3 text-[15px]">
                        <span className="flex items-center gap-2">
                          <UserRound className="size-4 text-ink-500" aria-hidden />
                          {m.full_name}
                        </span>
                        <span className="flex items-center gap-2">
                          <Badge tone={m.status === 'ACTIVE' ? 'success' : 'gold'}><Text>{m.status === 'ACTIVE' ? 'Your carer' : 'Waiting'}</Text></Badge>
                          <Button size="sm" variant="ghost" onClick={() => end.run(m.id)} disabled={end.pending}><Text>End</Text></Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Async>
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold text-ink-900"><Text>People you care for</Text></p>
              <Async state={carers}>
                {(c) =>
                  c.caringFor.length === 0 ? (
                    <p className="text-sm text-ink-500"><Text>Nobody yet.</Text></p>
                  ) : (
                    <ul className="space-y-2">
                      {c.caringFor.map((r) => (
                        <li key={r.id} className="rounded-lg border border-ink-200 p-3 text-[15px]">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium">{r.full_name}</span>
                            {r.status === 'PENDING' ? (
                              <span className="flex gap-2">
                                <Button size="sm" onClick={() => respond.run(r.id, true)} disabled={respond.pending}><Text>Accept</Text></Button>
                                <Button size="sm" variant="secondary" onClick={() => respond.run(r.id, false)} disabled={respond.pending}><Text>Decline</Text></Button>
                              </span>
                            ) : (
                              <Badge tone={r.zone_status === 'NORMAL' ? 'success' : r.zone_status === 'DANGER' ? 'danger' : 'warning'}><Text>{r.zone_name}</Text>: <Text>{r.zone_status === 'NORMAL' ? 'normal' : r.zone_status?.toLowerCase()}</Text></Badge>
                            )}
                          </div>
                          {r.status === 'ACTIVE' && r.zone_status !== 'NORMAL' && <p className="mt-1 text-sm text-ink-600"><Text>{r.checked_in ? (r.checked_in === 'SAFE' ? 'Checked in safe.' : 'Asked for help.') : 'Has not checked in yet.'}</Text></p>}
                        </li>
                      ))}
                    </ul>
                  )
                }
              </Async>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Step-free and accessible places"
            description="Checked by residents and staff. Say when something is blocked."
            action={
              <Button size="sm" variant="secondary" onClick={() => setSuggesting(true)}>
                <Plus className="size-4" aria-hidden /><Text>Add a place</Text></Button>
            }
          />
          <Async state={places}>
            {(list) =>
              list.length === 0 ? (
                <div className="p-5">
                  <EmptyState icon={Accessibility} title="No places listed yet" />
                </div>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {list.map((place) => (
                    <li key={place.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold text-ink-900">{place.name}</p>
                        <p className="flex items-center gap-1.5 text-sm text-ink-500">
                          <MapPin className="size-3.5" aria-hidden />
                          <Text>{PLACE_KIND_LABELS[place.kind]}</Text> · <Text>{place.location}</Text>
                        </p>
                        {place.status === 'BLOCKED' && place.note && <p className="text-sm text-accent-700">{place.note}</p>}
                      </div>
                      <span className="flex items-center gap-2">
                        <Badge tone={PLACE_STATUS[place.status].tone}><Text>{PLACE_STATUS[place.status].label}</Text></Badge>
                        {place.status !== 'BLOCKED' && (
                          <Button size="sm" variant="ghost" onClick={() => setBlocked(place)}>
                            <TriangleAlert className="size-4" aria-hidden /><Text>Blocked?</Text></Button>
                        )}
                        <span className="text-xs text-ink-500"><Text>{timeAgo(place.updated_at)}</Text></span>
                      </span>
                    </li>
                  ))}
                </ul>
              )
            }
          </Async>
        </Card>
      </div>

      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={() => void remove.run()} title="Delete your access needs?" confirmLabel="Delete" destructive pending={remove.pending}>
        <p><Text>Your needs, choices and place on the priority help list are deleted at once. You can add them again later.</Text></p>
      </ConfirmDialog>

      <Modal
        open={suggesting}
        onClose={() => setSuggesting(false)}
        title="Add an accessible place"
        footer={
          <Button type="submit" form="suggest-place" pending={suggest.pending}><Text>Send for checking</Text></Button>
        }
      >
        <form
          id="suggest-place"
          method="post"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
            void suggest.run({ name: form.name!, kind: form.kind!, location: form.location!, ...(form.note ? { note: form.note } : {}) });
          }}
        >
          <Input name="name" label="Name" required maxLength={100} error={suggest.fields.name} />
          <Select name="kind" label="Kind" defaultValue="RAMP">
            {PLACE_KINDS.map((k) => (
              <option key={k} value={k}>
                <Text>{PLACE_KIND_LABELS[k]}</Text>
              </option>
            ))}
          </Select>
          <Input name="location" label="Where it is" required maxLength={160} error={suggest.fields.location} />
          <Textarea name="note" label="Anything useful (optional)" maxLength={300} rows={2} />
        </form>
      </Modal>

      <Modal
        open={blocked !== null}
        onClose={() => setBlocked(null)}
        title={`Is ${blocked?.name ?? ''} blocked?`}
        footer={
          <Button type="submit" form="report-blocked" variant="danger" pending={report.pending}><Text>Report it</Text></Button>
        }
      >
        <form
          id="report-blocked"
          method="post"
          onSubmit={(event) => {
            event.preventDefault();
            const note = String(new FormData(event.currentTarget).get('note') ?? '');
            if (blocked) void report.run(blocked.id, note);
          }}
        >
          <Textarea name="note" label="What is in the way?" required minLength={5} maxLength={300} rows={3} error={report.fields.note} placeholder="e.g. Motorcycles parked across the ramp" />
        </form>
      </Modal>
    </>
  );
}
