'use client';

import { Text } from '@/components/ui/localized-text';

import { Accessibility, Bell, BellOff, HeartHandshake, Lock, MapPin, Plus, Trash2, TriangleAlert, UserRound, Volume2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AvailabilityBadge, IncidentStatusBadge, PhotoField, VerificationBadge, availabilityHint, categoryLabel, formWith } from '@/components/features/access-bits';
import { AksesWizard, useAksesMode, type AksesProfile } from '@/components/features/akses-mode';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { Async, EmptyState } from '@/components/ui/feedback';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { speak, useLang } from '@/lib/i18n';
import { ACCESS_CATEGORIES, ACCESS_CATEGORY_INFO, type AccessCategory, type AccessIncidentStatus, type Availability, type Verification } from '@/shared/akses';
import { ACCESS_NEEDS, ACCESS_NEED_LABELS, PLACE_KINDS, PLACE_KIND_LABELS, type PlaceKind } from '@/shared/domain';

interface Carers {
  myCarers: { id: string; status: 'PENDING' | 'ACTIVE'; full_name: string }[];
  caringFor: { id: string; status: 'PENDING' | 'ACTIVE'; full_name: string; zone_name?: string; zone_status?: string; checked_in?: string | null }[];
}
interface PlaceIncident {
  reference: string;
  category: AccessCategory;
  status: AccessIncidentStatus;
  blocks: boolean;
  reporters: number;
  since: string;
  confirmed: boolean;
  mine: boolean;
  can_confirm: boolean;
}
interface Place {
  id: string;
  name: string;
  kind: PlaceKind;
  location: string;
  note: string | null;
  verification: Verification;
  availability: Availability;
  availability_changed_at: string | null;
  last_verified_at: string | null;
  party_name: string | null;
  following: boolean;
  incidents: PlaceIncident[];
}
interface MyReport {
  reference: string;
  category: AccessCategory;
  status: AccessIncidentStatus;
  created_at: string;
  resolved_at: string | null;
  place_name: string;
  place_location: string;
  party_name: string | null;
  fix_photo_id: string | null;
  can_confirm: boolean;
  steps: { kind: string; body: string | null; at: string }[];
}

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

/** Akses+ (proposal 6.6): tell the app your access needs once, and every feature adapts. */
export default function AksesPage() {
  const lang = useLang();
  const profile = useApi<AksesProfile>('/me/access');
  const carers = useApi<Carers>('/carers');
  const places = useApi<Place[]>('/access-places');
  const reports = useApi<MyReport[]>('/me/access-reports');
  const [draft, setDraft] = useState<AksesProfile | null>(null);
  const [consent, setConsent] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [reporting, setReporting] = useState<{ place: Place; key: string } | null>(null);
  const [category, setCategory] = useState<AccessCategory>('OBSTRUCTION');
  const [photo, setPhoto] = useState<File | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const [reopening, setReopening] = useState<string | null>(null);
  const [carerCode, setCarerCode] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const akses = useAksesMode();

  const p = draft ?? profile.data;
  const edit = (change: Partial<AksesProfile>) => p && setDraft({ ...p, ...change });
  const save = useAction(
    () =>
      api.post<AksesProfile>('/me/access', {
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
  const remove = useAction(() => api.post<AksesProfile>('/me/access/delete'), {
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
  const refresh = () => {
    void places.mutate();
    void reports.mutate();
  };
  const suggest = useAction((body: Record<string, string>) => api.post<{ id: string; possibleDuplicate: { name: string } | null }>('/access-places', body), {
    onSuccess: () => {
      setSuggesting(false);
      void places.mutate();
    },
    success: (r) => (r.possibleDuplicate ? `Thank you. It may already be listed as “${r.possibleDuplicate.name}”; staff will check both.` : 'Thank you. It shows as pending until staff inspect it; a verified place earns Impact XP.'),
  });
  const report = useAction(
    async (placeId: string, key: string, description: string) =>
      api.post<{ reference: string; outcome: 'CREATED' | 'LINKED' | 'REOPENED' | 'ALREADY_REPORTED' | 'ALREADY_RECEIVED' }>(`/access-places/${placeId}/reports`, await formWith({ category, description, idempotencyKey: key }, photo)),
    {
      onSuccess: () => {
        setReporting(null);
        setPhoto(null);
        refresh();
      },
      success: (r) => ({
        CREATED: `Reported as ${r.reference}. It went straight to the team responsible.`,
        LINKED: `Thank you. Others reported this too; your report was added to ${r.reference}.`,
        REOPENED: `${r.reference} is reopened: it went back to the team responsible.`,
        ALREADY_REPORTED: `You already reported this (${r.reference}).`,
        ALREADY_RECEIVED: `You already reported this (${r.reference}).`,
      })[r.outcome],
    },
  );
  const confirm = useAction(async (reference: string, answer: 'CLEAR' | 'STILL_BLOCKED', note?: string) => api.post(`/access-incidents/${reference}/confirm`, await formWith({ answer, note }, answer === 'STILL_BLOCKED' ? photo : null)), {
    onSuccess: () => {
      setAnswering(null);
      setPhoto(null);
      refresh();
    },
    success: 'Thank you. Your answer helps verify the fix.',
  });
  const reopen = useAction((reference: string, reason: string) => api.post(`/access-incidents/${reference}/reopen`, { reason }), {
    onSuccess: () => {
      setReopening(null);
      refresh();
    },
    success: 'Reopened. It went back to the team responsible.',
  });
  const follow = useAction((id: string, on: boolean) => api.post(`/access-places/${id}/follow`, { follow: on }), {
    onSuccess: () => void places.mutate(),
    success: 'Saved.',
  });

  const needsConsent = Boolean(p && (p.needs.length > 0 || p.priorityHelp) && !profile.data?.consentAt);
  // Simple Mode asks one question at a time; the full form is always the same otherwise.
  const guided = akses.guided;

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
                {guided ? (
                  <div className="flex flex-wrap gap-3 p-5">
                    <Button size="lg" className="min-h-20 flex-1 text-xl" onClick={() => { setDraft(profile.data ?? null); setWizardStep(0); setWizardOpen(true); }}>
                      <Text>Update access needs one step at a time</Text>
                    </Button>
                    {profile.data?.consentAt && <Button size="lg" variant="ghost" onClick={() => setConfirmDelete(true)}><Trash2 className="size-5" aria-hidden /><Text>Delete my access needs</Text></Button>}
                  </div>
                ) : (
                <>
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
                      <Button variant="ghost" size="sm" className="mt-1" onClick={() => speak(lang === 'ms' ? 'Ini contoh suara SimeTown.' : 'This is how SimeTown sounds when it reads aloud.', lang)}>
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
                      label="I agree that SimeTown keeps these access needs to adapt the app for me, and shows my name, address and note to duty staff during a flood alert if I join the priority list. I can delete them at any time."
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
                </>
                )}
                <AksesWizard
                  open={wizardOpen}
                  title="Akses+ preferences"
                  step={wizardStep}
                  total={5}
                  onClose={() => setWizardOpen(false)}
                  onBack={() => setWizardStep((step) => step - 1)}
                  onNext={() => setWizardStep((step) => step + 1)}
                  onSubmit={() => {
                    if (needsConsent && !consent) return;
                    void save.run().then((ok) => ok && setWizardOpen(false));
                  }}
                  pending={save.pending}
                  submitLabel="Save"
                >
                  {wizardStep === 0 && (
                    <fieldset className="space-y-3">
                      <legend className="mb-3 text-3xl font-semibold"><Text>What support would help you?</Text></legend>
                      {ACCESS_NEEDS.map((need) => <Checkbox key={need} label={ACCESS_NEED_LABELS[need]} checked={p.needs.includes(need)} onChange={(event) => edit({ needs: event.target.checked ? [...p.needs, need] : p.needs.filter((item) => item !== need) })} />)}
                    </fieldset>
                  )}
                  {wizardStep === 1 && <Switch label="Simple Mode" hint="Four big buttons on your home screen: Help, Visitors, Flood, My points." checked={p.simpleMode} onChange={(value) => edit({ simpleMode: value })} />}
                  {wizardStep === 2 && (
                    <div>
                      <Switch label="Read alerts aloud" hint="Flood warnings and Simple Mode are read out by your phone’s own voice." checked={p.readAloud} onChange={(value) => edit({ readAloud: value })} />
                      <Button size="lg" variant="secondary" className="mt-4 min-h-16" onClick={() => speak(lang === 'ms' ? 'Ini contoh suara SimeTown.' : 'This is how SimeTown sounds when it reads aloud.', lang)}><Volume2 className="size-5" aria-hidden /><Text>Try it</Text></Button>
                    </div>
                  )}
                  {wizardStep === 3 && <Switch label="Flash and vibrate for alerts" hint="For deaf and hard-of-hearing residents. One flash a second, within the safe limit." checked={p.flashAlerts} onChange={(value) => edit({ flashAlerts: value })} />}
                  {wizardStep === 4 && (
                    <div className="space-y-5">
                      <Switch label="Priority help list for floods" hint="In a flood warning, staff phone homes on this list first." checked={p.priorityHelp} onChange={(value) => edit({ priorityHelp: value })} />
                      {p.priorityHelp && <Input label="Anything staff should know (optional)" labelClassName="!text-3xl !font-semibold" value={p.priorityNote ?? ''} onChange={(event) => edit({ priorityNote: event.target.value })} maxLength={200} placeholder="e.g. Uses a walking frame; lives alone" />}
                      {needsConsent && <Checkbox label="I agree that SimeTown keeps these access needs to adapt the app for me, and shows my name, address and note to duty staff during a flood alert if I join the priority list. I can delete them at any time." checked={consent} onChange={(event) => setConsent(event.target.checked)} error={save.fields.consent} />}
                    </div>
                  )}
                </AksesWizard>
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
            description="Two things are shown separately: whether a place has been verified as accessible, and whether it can be used today. A problem residents report is marked as reported until the team responsible confirms it."
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
                    <li key={place.id} className="space-y-2 px-5 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[15px] font-semibold text-ink-900">{place.name}</p>
                          <p className="flex items-center gap-1.5 text-sm text-ink-500">
                            <MapPin className="size-3.5 shrink-0" aria-hidden />
                            <span><Text>{PLACE_KIND_LABELS[place.kind]}</Text> · {place.location}</span>
                          </p>
                        </div>
                        <span className="flex flex-wrap items-center gap-2">
                          <VerificationBadge value={place.verification} />
                          <AvailabilityBadge value={place.availability} />
                        </span>
                      </div>
                      {place.availability !== 'AVAILABLE' && place.availability !== 'UNKNOWN' && (
                        <p className="text-sm text-ink-600"><Text>{availabilityHint(place.availability)}</Text></p>
                      )}
                      {place.incidents.map((i) => (
                        <div key={i.reference} className="rounded-lg border border-ink-200 bg-ink-25 p-3 text-sm">
                          <p className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-ink-900"><Text>{categoryLabel(i.category)}</Text></span>
                            <IncidentStatusBadge value={i.status} />
                            {i.mine && <Badge tone="brand"><Text>You reported this</Text></Badge>}
                          </p>
                          <p className="mt-1 text-ink-600">
                            <Text>{i.confirmed ? 'Confirmed.' : `Reported by ${i.reporters} resident(s), not yet confirmed.`}</Text> <Text>{`Since ${timeAgo(i.since)}`}</Text>
                          </p>
                          {i.can_confirm && (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <span className="text-ink-700"><Text>The team says it is fixed. Is it clear?</Text></span>
                              <Button size="sm" variant="success" onClick={() => void confirm.run(i.reference, 'CLEAR')} disabled={confirm.pending}><Text>Yes, it is clear</Text></Button>
                              <Button size="sm" variant="secondary" onClick={() => { setPhoto(null); setAnswering(i.reference); }}><Text>Still blocked</Text></Button>
                            </div>
                          )}
                        </div>
                      ))}
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="ghost" onClick={() => { setCategory(place.kind === 'OKU_PARKING' ? 'PARKING_OBSTRUCTION' : 'OBSTRUCTION'); setPhoto(null); setReporting({ place, key: newKey() }); }}>
                          <TriangleAlert className="size-4" aria-hidden /><Text>Report a problem</Text></Button>
                        <Button size="sm" variant="ghost" aria-pressed={place.following} onClick={() => void follow.run(place.id, !place.following)} disabled={follow.pending}>
                          {place.following ? <BellOff className="size-4" aria-hidden /> : <Bell className="size-4" aria-hidden />}
                          <Text>{place.following ? 'Stop following' : 'Follow'}</Text>
                        </Button>
                        {place.last_verified_at && <span className="text-xs text-ink-500"><Text>{`Last verified ${formatDate(place.last_verified_at)}`}</Text></span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )
            }
          </Async>
        </Card>

        <Card>
          <CardHeader title="My accessibility reports" description="Where each report is. You are told when it changes." />
          <Async state={reports}>
            {(list) =>
              list.length === 0 ? (
                <p className="p-5 text-sm text-ink-500"><Text>You have not reported anything yet.</Text></p>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {list.map((r) => {
                    const canReopen = r.status === 'RESOLVED' && r.resolved_at && Date.now() - new Date(r.resolved_at).getTime() < 7 * 86_400_000;
                    return (
                      <li key={r.reference} id={r.reference} className="scroll-mt-24 space-y-2 px-5 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-ink-500">{r.reference}</span>
                          <IncidentStatusBadge value={r.status} />
                        </div>
                        <p className="text-[15px] font-semibold text-ink-900"><Text>{categoryLabel(r.category)}</Text>: {r.place_name}</p>
                        {r.party_name && <p className="text-sm text-ink-500"><Text>{`Handled by ${r.party_name}`}</Text></p>}
                        <ol className="space-y-1 border-l-2 border-ink-200 pl-3 text-sm text-ink-700">
                          {r.steps.map((s, n) => (
                            <li key={n}><span className="text-ink-500"><Text>{timeAgo(s.at)}</Text>:</span> <Text>{s.body ?? ''}</Text></li>
                          ))}
                        </ol>
                        <div className="flex flex-wrap gap-2">
                          {r.fix_photo_id && <a href={`/api/v1/access-photos/${r.fix_photo_id}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand-700 underline"><Text>See the photo of the fix</Text></a>}
                          {r.can_confirm && (
                            <>
                              <Button size="sm" variant="success" onClick={() => void confirm.run(r.reference, 'CLEAR')} disabled={confirm.pending}><Text>Yes, it is clear</Text></Button>
                              <Button size="sm" variant="secondary" onClick={() => { setPhoto(null); setAnswering(r.reference); }}><Text>Still blocked</Text></Button>
                            </>
                          )}
                          {canReopen && <Button size="sm" variant="ghost" onClick={() => setReopening(r.reference)}><Text>The problem is back</Text></Button>}
                        </div>
                      </li>
                    );
                  })}
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
        open={reporting !== null}
        onClose={() => setReporting(null)}
        title="Report a problem"
        description={reporting?.place.name}
        footer={
          <Button type="submit" form="report-access" pending={report.pending}><Text>Send report</Text></Button>
        }
      >
        <form
          id="report-access"
          method="post"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const description = String(new FormData(event.currentTarget).get('description') ?? '');
            if (reporting) void report.run(reporting.place.id, reporting.key, description);
          }}
        >
          <fieldset className="space-y-2">
            <legend className="mb-1 text-[15px] font-semibold text-ink-900"><Text>What is wrong?</Text></legend>
            {ACCESS_CATEGORIES.map((c) => (
              <label key={c} className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink-200 p-3 has-checked:border-brand-500 has-checked:bg-brand-50/50">
                <input type="radio" name="category" value={c} checked={category === c} onChange={() => setCategory(c)} className="mt-1 size-4 accent-brand-600" />
                <span>
                  <span className="block text-[15px] font-medium text-ink-900"><Text>{ACCESS_CATEGORY_INFO[c].label}</Text></span>
                  <span className="block text-sm text-ink-500"><Text>{ACCESS_CATEGORY_INFO[c].hint}</Text></span>
                </span>
              </label>
            ))}
          </fieldset>
          <Textarea
            name="description"
            label={ACCESS_CATEGORY_INFO[category].needsNote ? 'Describe the problem' : 'Anything that helps (optional)'}
            required={ACCESS_CATEGORY_INFO[category].needsNote}
            maxLength={500}
            rows={2}
            error={report.fields.description}
            placeholder="e.g. Motorcycles parked across the ramp"
          />
          <PhotoField label="Add a photo (optional)" name={photo?.name ?? null} onChange={setPhoto} />
          <p className="text-sm text-ink-500"><Text>Your report goes straight to the team responsible. Your name is never shown to other residents or to outside contractors.</Text></p>
        </form>
      </Modal>

      <Modal
        open={answering !== null}
        onClose={() => setAnswering(null)}
        title="Still blocked?"
        footer={<Button type="submit" form="still-blocked" variant="danger" pending={confirm.pending}><Text>Send</Text></Button>}
      >
        <form
          id="still-blocked"
          method="post"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const note = String(new FormData(event.currentTarget).get('note') ?? '');
            if (answering) void confirm.run(answering, 'STILL_BLOCKED', note);
          }}
        >
          <Textarea name="note" label="What is still wrong?" required minLength={3} maxLength={300} rows={3} error={confirm.fields.note} />
          <PhotoField label="Add a photo (optional)" name={photo?.name ?? null} onChange={setPhoto} />
        </form>
      </Modal>

      <Modal
        open={reopening !== null}
        onClose={() => setReopening(null)}
        title="The problem is back"
        footer={<Button type="submit" form="reopen-access" variant="danger" pending={reopen.pending}><Text>Reopen</Text></Button>}
      >
        <form
          id="reopen-access"
          method="post"
          onSubmit={(event) => {
            event.preventDefault();
            const reason = String(new FormData(event.currentTarget).get('reason') ?? '');
            if (reopening) void reopen.run(reopening, reason);
          }}
        >
          <Textarea name="reason" label="What is wrong again?" required minLength={5} maxLength={300} rows={3} error={reopen.fields.reason} />
        </form>
      </Modal>
    </>
  );
}
