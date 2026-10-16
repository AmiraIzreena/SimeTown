'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedInput } from '@/components/ui/localized-elements';

import { Bird, Camera, Droplet, Leaf, Repeat2, Shovel, Sprout } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AksesPage, AksesWizard, useAksesMode } from '@/components/features/akses-mode';
import { CodeEntry } from '@/components/features/scan';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader, Stat } from '@/components/ui/card';
import { Async, EmptyState, SkeletonStats } from '@/components/ui/feedback';
import { Input, Select, Textarea } from '@/components/ui/field';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, rewardMessage, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { shrinkPhoto } from '@/lib/image';
import type { ActionRewardView } from '@/lib/types';
import { WILDLIFE_KINDS, WILDLIFE_KIND_LABELS, type WildlifeKind } from '@/shared/domain';
import { DEMO_MODE } from '@/lib/demo';

interface Overview {
  today: string;
  rosterDays: number;
  plotMonths: number;
  gardens: {
    id: string;
    name: string;
    location: string;
    waiting: number;
    freePlots: number;
    myApplication: { id: string; created_at: string } | null;
    plots: { id: string; plot_no: string; size_m2: number; taken: boolean; mine: boolean; booked_until: string | null }[];
    roster: { day: string; mine: boolean; done: boolean }[];
  }[];
  mySightings: { id: string; kind: WildlifeKind; species: string; location: string; status: 'PENDING' | 'CONFIRMED' | 'REJECTED'; created_at: string }[];
  townshipLog: { kind: WildlifeKind; species: string; location: string; created_at: string }[];
  speciesCount: number;
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });

export function TamanScreen({ scanned }: { scanned: string }) {
  const akses = useAksesMode();
  const overview = useApi<Overview>('/taman');
  const t = useT();
  const [code, setCode] = useState(scanned);
  const [photo, setPhoto] = useState<File | null>(null);
  const [sightingOpen, setSightingOpen] = useState(false);
  const [sightingStep, setSightingStep] = useState(0);
  const [sightingKind, setSightingKind] = useState<WildlifeKind>('BIRD');
  const [species, setSpecies] = useState('');
  const [sightingLocation, setSightingLocation] = useState('');
  const [sightingNote, setSightingNote] = useState('');
  const [sightingError, setSightingError] = useState('');
  const [wateringOpen, setWateringOpen] = useState(false);
  const refresh = () => void overview.mutate();

  const apply = useAction((gardenId: string) => api.post(`/taman/gardens/${gardenId}/apply`), { onSuccess: refresh, success: 'You are on the waiting list. You will hear when the ballot is drawn.' });
  const withdraw = useAction((id: string) => api.post(`/taman/applications/${id}/withdraw`), { onSuccess: refresh, success: 'You have left the waiting list.' });
  const release = useAction((id: string) => api.post(`/taman/plots/${id}/release`), { onSuccess: refresh, success: 'Plot given back.' });
  const take = useAction((gardenId: string, day: string) => api.post('/taman/roster', { gardenId, day }), { onSuccess: refresh, success: 'You are on the watering roster.' });
  const watered = useAction(() => api.post<{ garden: string; reward: ActionRewardView }>('/taman/watered', { code: code.trim() }), {
    onSuccess: () => {
      setCode('');
      refresh();
    },
    success: (r) => `${r.garden} watered. ${rewardMessage(r.reward, 'Thank you!')}`,
  });
  const sight = useAction(
    async (fields: Record<string, string>) => {
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) if (v) form.set(k, v);
      if (photo) form.set('photo', await shrinkPhoto(photo), 'sighting.jpg');
      return api.post('/taman/sightings', form);
    },
    {
      onSuccess: () => {
        setPhoto(null);
        refresh();
      },
      success: 'Logged. Staff confirm it, and then it joins the township’s wildlife log.',
    },
  );
  const submitSighting = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const fields = Object.fromEntries(new FormData(element)) as Record<string, string>;
    delete fields.photo;
    void sight.run(fields).then((ok) => ok && element.reset());
  };
  const nextSighting = () => {
    if (sightingStep === 1 && !species.trim()) {
      setSightingError('Please enter what you saw.');
      return;
    }
    if (sightingStep === 2 && !sightingLocation.trim()) {
      setSightingError('Please enter where you saw it.');
      return;
    }
    setSightingError('');
    setSightingStep((step) => step + 1);
  };
  const submitGuidedSighting = () => {
    void sight.run({ kind: sightingKind, species: species.trim(), location: sightingLocation.trim(), note: sightingNote }).then((ok) => {
      if (ok) {
        setSightingOpen(false);
        setSightingStep(0);
        setSpecies('');
        setSightingLocation('');
        setSightingNote('');
      }
    });
  };

  return (
    <AksesPage profile={akses.profile} simple={akses.simple} largeText={akses.largeText} largeTargets={akses.largeTargets}>
      <PageHeader
        title="Taman"
        description="Community gardens and more nature in the township. Apply for a plot, take a day on the watering roster, and log the birds and insects you spot."
        action={
          <Button href="/app/kongsi" variant="secondary">
            <Repeat2 className="size-4" aria-hidden /><Text>Share your harvest</Text></Button>
        }
      />
      <div className="space-y-6">
        <Async state={overview} skeleton={<SkeletonStats count={3} />}>
          {(o) => {
            const myPlot = o.gardens.flatMap((g) => g.plots.filter((p) => p.mine).map((p) => ({ ...p, garden: g.name })))[0];
            const waiting = o.gardens.some((g) => g.myApplication);
            return (
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
                <Stat
                  label="Your plot"
                  value={myPlot ? `Plot ${myPlot.plot_no}` : waiting ? 'Waiting list' : 'None yet'}
                  icon={Shovel}
                  hint={myPlot?.booked_until ? `Until ${formatDate(myPlot.booked_until)}` : waiting ? 'Plots are given out by ballot' : 'One plot per home'}
                />
                <Stat label="Your sightings" value={o.mySightings.length} icon={Bird} hint={`${o.mySightings.filter((s) => s.status === 'CONFIRMED').length} confirmed`} />
                <div className="col-span-2 lg:col-span-1">
                  <Stat label="Species seen in the township" value={o.speciesCount} icon={Leaf} tone="gold" hint="Confirmed by staff" />
                </div>
              </div>
            );
          }}
        </Async>

        <Card>
          <CardHeader title="Watered today?" description="Scan the code on the garden gate after watering. It earns Impact XP and offer-backed points." />
          <div className="p-5">
            {akses.guided ? (
              <Button size="lg" className="min-h-20 w-full text-xl" onClick={() => setWateringOpen(true)}><Text>Enter garden code</Text></Button>
            ) : <CodeEntry label="Garden code" value={code} onChange={setCode} onSubmit={() => void watered.run()} pending={watered.pending} error={watered.fields.code} action="I watered" />}
          </div>
        </Card>

        <Async state={overview}>
          {(o) =>
            o.gardens.length === 0 ? (
              <EmptyState icon={Sprout} title="No community gardens yet" />
            ) : (
              <div className="grid gap-6 lg:grid-cols-2">
                {o.gardens.map((g) => {
                  const days = Array.from({ length: 7 }, (_, i) => addDays(o.today, i + 1));
                  const mine = g.plots.find((p) => p.mine);
                  const homeHasPlot = o.gardens.some((x) => x.plots.some((p) => p.mine));
                  const homeWaiting = o.gardens.some((x) => x.myApplication);
                  return (
                    <Card key={g.id}>
                      <CardHeader title={g.name} description={g.location} />
                      <div className="space-y-5 p-5">
                        <div>
                          <p className="mb-2 text-sm font-semibold text-ink-900"><Text>Plots</Text></p>
                          <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                            {g.plots.map((p) => (
                              <li
                                key={p.id}
                                title={
                                  p.mine
                                    ? t(`Plot ${p.plot_no}, ${p.size_m2} m² (yours)`)
                                    : p.taken
                                      ? t(`Plot ${p.plot_no}, ${p.size_m2} m² (taken)`)
                                      : t(`Plot ${p.plot_no}, ${p.size_m2} m² (free)`)
                                }
                                className={cn(
                                  'flex aspect-square flex-col items-center justify-center rounded-md border text-xs font-semibold',
                                  p.mine ? 'border-brand-600 bg-brand-600 text-white' : p.taken ? 'border-success-600/20 bg-success-50 text-success-700' : 'border-dashed border-ink-300 bg-white text-ink-600',
                                )}
                              >
                                <Sprout className="size-4" aria-hidden />
                                <Text>{p.plot_no}</Text>
                                <span className="font-normal opacity-80"><Text>{`${p.size_m2} m²`}</Text></span>
                              </li>
                            ))}
                          </ul>
                          <p className="mt-2 text-xs text-ink-500"><Text>Plots are given out by ballot, one per home, for six months. Green plots are taken; yours is dark.</Text></p>
                        </div>
                        <div className="rounded-md bg-ink-50 p-4 text-sm text-ink-700">
                          {mine ? (
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p><Text>{`Plot ${mine.plot_no} is yours until ${formatDate(mine.booked_until!)}.`}</Text></p>
                              <Button variant="secondary" size="sm" pending={release.pending} onClick={() => void release.run(mine.id)}>
                                <Text>Give it back</Text></Button>
                            </div>
                          ) : g.myApplication ? (
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p><Text>{`You are on the waiting list (since ${formatDate(g.myApplication.created_at)}). The township office draws names when plots are free.`}</Text></p>
                              <Button variant="secondary" size="sm" pending={withdraw.pending} onClick={() => void withdraw.run(g.myApplication!.id)}>
                                <Text>Leave the list</Text></Button>
                            </div>
                          ) : homeHasPlot || homeWaiting ? (
                            <p><Text>One plot, and one waiting list, per home.</Text></p>
                          ) : (
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p><Text>{`${g.freePlots} free · ${g.waiting} waiting. Join the list and you are in the next ballot.`}</Text></p>
                              <Button size="sm" pending={apply.pending} onClick={() => void apply.run(g.id)}>
                                <Shovel className="size-4" aria-hidden /><Text>Apply for a plot</Text></Button>
                            </div>
                          )}
                        </div>
                        {DEMO_MODE && <p className="text-xs text-ink-500"><Text>Sample plots, holders and waiting list.</Text></p>}
                        <div>
                          <p className="mb-2 text-sm font-semibold text-ink-900"><Text>Watering roster, next 7 days</Text></p>
                          <div className="grid grid-cols-7 gap-1.5">
                            {days.map((day) => {
                              const slot = g.roster.find((r) => r.day === day);
                              return (
                                <button
                                  key={day}
                                  type="button"
                                  disabled={Boolean(slot) || take.pending}
                                  onClick={() => void take.run(g.id, day)}
                                  className={cn(
                                    'flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-[11px] font-medium',
                                    slot?.mine ? 'border-brand-600 bg-brand-50 text-brand-800' : slot ? 'border-ink-200 bg-ink-50 text-ink-500' : 'border-dashed border-ink-300 text-ink-700 hover:border-brand-500',
                                  )}
                                >
                                  <Droplet className="size-3.5" aria-hidden />
                                  <Text>{dayLabel(day)}</Text>
                                  <span><Text>{slot?.mine ? 'You' : slot ? 'Taken' : 'Free'}</Text></span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )
          }
        </Async>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Log a sighting" description="Birds, butterflies, frogs and native plants. Staff confirm each one before it joins the log." />
            {akses.guided ? (
              <div className="p-5">
                <Button size="lg" className="min-h-20 w-full text-xl" onClick={() => { setSightingStep(0); setSightingOpen(true); }}><Bird className="size-6" aria-hidden /><Text>Log a sighting one step at a time</Text></Button>
              </div>
            ) : (
            <form method="post" onSubmit={submitSighting} className="space-y-4 p-5" noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <Select name="kind" label="What kind" defaultValue="BIRD">
                  {WILDLIFE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      <Text>{WILDLIFE_KIND_LABELS[k]}</Text>
                    </option>
                  ))}
                </Select>
                <Input name="species" label="What it was" placeholder="e.g. Oriental magpie-robin" required maxLength={80} error={sight.fields.species} />
              </div>
              <Input name="location" label="Where" placeholder="e.g. Lake, near the boathouse" required maxLength={120} error={sight.fields.location} />
              <Textarea name="note" label="Note (optional)" rows={2} maxLength={300} />
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-ink-200 px-3 text-sm font-semibold text-ink-800 hover:border-ink-300">
                <Camera className="size-4" aria-hidden />
                <Text>{photo ? `Photo: ${photo.name}` : 'Add a photo (optional)'}</Text>
                <LocalizedInput name="photo" type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} />
              </label>
              <div>
                <Button type="submit" pending={sight.pending}>
                  <Bird className="size-4" aria-hidden /><Text>Log sighting</Text></Button>
              </div>
            </form>
            )}
          </Card>
          <Card>
            <CardHeader title="The township’s wildlife log" description="Confirmed sightings. No names: the log is about the wildlife." />
            <Async state={overview}>
              {(o) =>
                o.townshipLog.length === 0 ? (
                  <p className="p-5 text-sm text-ink-500"><Text>No confirmed sightings yet.</Text></p>
                ) : (
                  <ul className="divide-y divide-ink-100">
                    {o.townshipLog.map((s, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 px-5 py-3">
                        <span className="min-w-0">
                          <span className="block text-[15px] font-medium text-ink-900"><Text>{s.species}</Text></span>
                          <span className="block text-sm text-ink-500">
                            <Text>{WILDLIFE_KIND_LABELS[s.kind]}</Text> · <Text>{s.location}</Text>
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-ink-500"><Text>{timeAgo(s.created_at)}</Text></span>
                      </li>
                    ))}
                  </ul>
                )
              }
            </Async>
            {overview.data && overview.data.mySightings.length > 0 && (
              <div className="border-t border-ink-100 p-5">
                <p className="mb-2 text-sm font-semibold text-ink-900"><Text>Yours</Text></p>
                <ul className="flex flex-wrap gap-2">
                  {overview.data.mySightings.map((s) => (
                    <li key={s.id}>
                      <Badge tone={s.status === 'CONFIRMED' ? 'success' : s.status === 'REJECTED' ? 'neutral' : 'gold'}>
                        <Text>{s.species}</Text> · <Text>{s.status === 'PENDING' ? 'waiting' : s.status.toLowerCase()}</Text>
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </div>
      </div>
      {akses.guided && (
        <>
          <AksesWizard open={wateringOpen} title="Watered today?" step={0} total={1} onClose={() => setWateringOpen(false)} onBack={() => undefined} onNext={() => undefined} onSubmit={() => { void watered.run().then((result) => result && setWateringOpen(false)); }} pending={watered.pending} submitLabel="I watered">
            <Input label="Garden code" labelClassName="!text-3xl !font-semibold" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="e.g. GABC2345XY" maxLength={16} error={watered.fields.code} hint="Scan the poster with your camera, or type the code printed under it." />
          </AksesWizard>
          <AksesWizard open={sightingOpen} title="Log a sighting" step={sightingStep} total={5} onClose={() => setSightingOpen(false)} onBack={() => setSightingStep((step) => step - 1)} onNext={nextSighting} onSubmit={submitGuidedSighting} pending={sight.pending} submitLabel="Log sighting">
            {sightingStep === 0 ? (
              <Select label="What kind" labelClassName="!text-3xl !font-semibold" value={sightingKind} onChange={(event) => setSightingKind(event.target.value as WildlifeKind)}>
                {WILDLIFE_KINDS.map((kind) => <option key={kind} value={kind}><Text>{WILDLIFE_KIND_LABELS[kind]}</Text></option>)}
              </Select>
            ) : sightingStep === 1 ? (
              <Input label="What you saw" labelClassName="!text-3xl !font-semibold" value={species} onChange={(event) => { setSpecies(event.target.value); setSightingError(''); }} placeholder="e.g. Oriental magpie-robin" maxLength={80} error={sightingError || sight.fields.species} />
            ) : sightingStep === 2 ? (
              <Input label="Where you saw it" labelClassName="!text-3xl !font-semibold" value={sightingLocation} onChange={(event) => { setSightingLocation(event.target.value); setSightingError(''); }} placeholder="e.g. Lake, near the boathouse" maxLength={120} error={sightingError || sight.fields.location} />
            ) : sightingStep === 3 ? (
              <Textarea label="Note (optional)" labelClassName="!text-3xl !font-semibold" value={sightingNote} onChange={(event) => setSightingNote(event.target.value)} rows={3} maxLength={300} />
            ) : (
              <label className="flex min-h-24 cursor-pointer items-center gap-4 rounded-xl border-2 border-dashed border-ink-300 px-6 py-5 text-2xl font-semibold text-ink-700 hover:border-brand-500 hover:bg-brand-50/40">
                <Camera className="size-8 shrink-0 text-ink-500" aria-hidden />
                <span className="min-w-0 flex-1"><Text>{photo ? `Photo: ${photo.name}` : 'Add a photo (optional)'}</Text></span>
                <LocalizedInput type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} />
              </label>
            )}
          </AksesWizard>
        </>
      )}
    </AksesPage>
  );
}
