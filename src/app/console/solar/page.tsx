'use client';

import { Text } from '@/components/ui/localized-text';

import { CircleAlert, Pencil, Plus, Sun, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { Async, EmptyState, SkeletonList } from '@/components/ui/feedback';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/field';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

type Kind = 'ROOFTOP' | 'CAR_PARK' | 'OTHER';
type Orientation = 'FLAT' | 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
type Shading = 'LOW' | 'MEDIUM' | 'HIGH';
interface Site {
  id: string;
  name: string;
  kind: Kind;
  zone_id: string | null;
  zone_name: string | null;
  usable_m2: number;
  orientation: Orientation;
  shading: Shading | null;
  roof_age_years: number | null;
  structural_checked: boolean;
  expert_rank: number | null;
  notes: string | null;
  kwp: number;
  annualKwh: number;
  zoneMonthlyKwh: number;
  zoneHomesReporting: number;
  zoneInterested: number;
  score: number;
  parts: { output: number; demand: number; interest: number; readiness: number };
  flags: string[];
  rank: number;
}
interface SolarData {
  sites: Site[];
  areas: { id: string; name: string; homesReporting: number; monthlyKwh: number; interested: number }[];
  agreement: { compared: number; inBoth: number } | null;
  assumptions: { kwpPerM2: number; kwhPerKwpYear: number; unknownShading: number; oldRoofYears: number };
}

const KINDS: Record<Kind, string> = { ROOFTOP: 'Rooftop', CAR_PARK: 'Car park canopy', OTHER: 'Other' };
const ORIENTATIONS: Record<Orientation, string> = { FLAT: 'Flat or low tilt', N: 'North', NE: 'North-east', E: 'East', SE: 'South-east', S: 'South', SW: 'South-west', W: 'West', NW: 'North-west' };
const SHADING: Record<Shading, string> = { LOW: 'Little shade', MEDIUM: 'Some shade', HIGH: 'Heavy shade' };

export default function SolarPage() {
  const data = useApi<SolarData>('/admin/solar/sites');
  const [editing, setEditing] = useState<Site | 'new' | null>(null);
  const [removing, setRemoving] = useState<Site | null>(null);
  const remove = useAction((id: string) => api.del(`/admin/solar/sites/${id}`), {
    success: 'Site removed.',
    onSuccess: () => {
      setRemoving(null);
      void data.mutate();
    },
  });

  return (
    <>
      <PageHeader
        title="Solar sites"
        description="Rooftops and car parks ranked for detailed solar feasibility studies: likely output, electricity demand nearby from Jimat bills (added up per area, never per home), residents who asked about solar, and what still needs checking."
        action={<Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /><Text>Add a site</Text></Button>}
      />
      <Async state={data} skeleton={<SkeletonList rows={4} />}>
        {(d) => (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="p-5 text-sm text-ink-700">
                <p className="font-semibold text-ink-900"><Text>Planning assumptions</Text></p>
                <p className="mt-1"><Text>{`${d.assumptions.kwpPerM2} kWp per m² of usable area, ${formatNumber(d.assumptions.kwhPerKwpYear)} kWh per kWp a year, adjusted for orientation and shading. Unsurveyed shading counts as some shade. Estimates only: the detailed study replaces them.`}</Text></p>
              </Card>
              <Card className="p-5 text-sm text-ink-700">
                <p className="font-semibold text-ink-900"><Text>Against an expert’s ranking</Text></p>
                <p className="mt-1">
                  <Text>
                    {d.agreement
                      ? `${d.agreement.inBoth} of the top ${d.agreement.compared} here are also in the expert’s top ${d.agreement.compared}.`
                      : 'Enter an engineer’s own rank on each site to test this shortlist against expert judgement.'}
                  </Text>
                </p>
              </Card>
            </div>

            {d.sites.length === 0 ? (
              <EmptyState icon={Sun} title="No sites yet" action={<Button onClick={() => setEditing('new')}><Text>Add a site</Text></Button>}><Text>Add rooftops and car parks with their usable area.</Text></EmptyState>
            ) : (
              <ol className="space-y-3">
                {d.sites.map((s) => (
                  <li key={s.id}>
                    <Card className="p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex min-w-0 items-start gap-4">
                          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-gold-50 font-display text-lg font-bold text-gold-700">{s.rank}</span>
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-2 font-display text-lg font-bold text-ink-900">
                              {s.name}
                              <Badge tone="neutral"><Text>{KINDS[s.kind]}</Text></Badge>
                              {s.expert_rank != null && <Badge tone="brand"><Text>{`Expert rank ${s.expert_rank}`}</Text></Badge>}
                            </p>
                            <p className="text-sm text-ink-500">
                              {s.zone_name ? <Text>{s.zone_name}</Text> : <Text>No area set</Text>} · <Text>{`${formatNumber(s.usable_m2)} m²`}</Text> · <Text>{ORIENTATIONS[s.orientation]}</Text> · <Text>{s.shading ? SHADING[s.shading] : 'Shading not surveyed'}</Text>
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-display text-3xl font-bold tabular-nums text-ink-900">{s.score}</p>
                          <p className="text-xs text-ink-500"><Text>score out of 100</Text></p>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
                        <Fact label="Estimated size" value={`${s.kwp} kWp`} />
                        <Fact label="Estimated output" value={`${formatNumber(Math.round(s.annualKwh / 100) / 10)} MWh a year`} />
                        <Fact label="Area demand" value={s.zoneHomesReporting === 1 ? `${formatNumber(s.zoneMonthlyKwh)} kWh a month, 1 home` : s.zoneHomesReporting ? `${formatNumber(s.zoneMonthlyKwh)} kWh a month, ${s.zoneHomesReporting} homes` : 'No data'} />
                        <Fact label="Residents interested" value={String(s.zoneInterested)} />
                      </div>
                      <p className="mt-3 text-xs text-ink-500"><Text>{`Output ${s.parts.output}/45 · demand ${s.parts.demand}/20 · interest ${s.parts.interest}/10 · readiness ${s.parts.readiness}/25`}</Text></p>
                      {s.flags.length > 0 && (
                        <ul className="mt-3 flex flex-wrap gap-2">
                          {s.flags.map((f) => (
                            <li key={f} className="inline-flex items-center gap-1.5 rounded-full bg-warning-50 px-3 py-1 text-xs font-medium text-warning-700">
                              <CircleAlert className="size-3.5" aria-hidden /><Text>{f}</Text>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-4 flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setEditing(s)}><Pencil className="size-4" aria-hidden /><Text>Update</Text></Button>
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(s)}><Trash2 className="size-4" aria-hidden /><Text>Remove</Text></Button>
                      </div>
                    </Card>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </Async>

      <SiteForm site={editing} areas={data.data?.areas ?? []} onClose={() => setEditing(null)} onSaved={() => void data.mutate()} />
      <ConfirmDialog open={removing !== null} onClose={() => setRemoving(null)} onConfirm={() => void remove.run(removing!.id)} title="Remove this site?" confirmLabel="Remove" destructive pending={remove.pending}>
        <p className="text-[15px] text-ink-700"><Text>It leaves the ranking. You can add it again later.</Text></p>
      </ConfirmDialog>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-ink-25 p-3">
      <p className="text-xs text-ink-500"><Text>{label}</Text></p>
      <p className="font-semibold text-ink-900"><Text>{value}</Text></p>
    </div>
  );
}

function SiteForm({ site, areas, onClose, onSaved }: { site: Site | 'new' | null; areas: SolarData['areas']; onClose: () => void; onSaved: () => void }) {
  const existing = site && site !== 'new' ? site : null;
  const save = useAction(
    (body: Record<string, unknown>) => (existing ? api.patch(`/admin/solar/sites/${existing.id}`, body) : api.post('/admin/solar/sites', body)),
    {
      success: existing ? 'Site updated.' : 'Site added.',
      onSuccess: () => {
        onSaved();
        onClose();
      },
    },
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? '').trim();
    const num = (name: string) => (text(name) === '' ? null : Number(text(name)));
    void save.run({
      name: text('name'),
      kind: text('kind'),
      zoneId: text('zoneId') || null,
      usableM2: num('usableM2'),
      orientation: text('orientation'),
      shading: text('shading') || null,
      roofAgeYears: num('roofAgeYears'),
      structuralChecked: form.get('structuralChecked') === 'on',
      expertRank: num('expertRank'),
      notes: text('notes') || null,
    });
  };
  return (
    <Modal
      open={site !== null}
      onClose={onClose}
      title={existing ? `Update ${existing.name}` : 'Add a site'}
      description="Leave what nobody has checked yet empty: it is flagged, and it lowers the score until it is filled in."
      wide
      footer={<><Button variant="secondary" onClick={onClose}><Text>Cancel</Text></Button><Button type="submit" form="solar-site" pending={save.pending}><Text>Save</Text></Button></>}
    >
      {site !== null && (
        <form method="post" id="solar-site" key={existing?.id ?? 'new'} onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Input label="Name" name="name" defaultValue={existing?.name} maxLength={80} required error={save.fields.name} />
          <Select label="Kind" name="kind" defaultValue={existing?.kind ?? 'ROOFTOP'}>
            {(Object.keys(KINDS) as Kind[]).map((k) => <option key={k} value={k}><Text>{KINDS[k]}</Text></option>)}
          </Select>
          <Select label="Area" name="zoneId" defaultValue={existing?.zone_id ?? ''} hint="Links the site to the demand of homes nearby.">
            <option value=""><Text>Not set</Text></option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <Input label="Usable area (m²)" name="usableM2" type="number" min={1} defaultValue={existing?.usable_m2} required error={save.fields.usableM2} />
          <Select label="Faces" name="orientation" defaultValue={existing?.orientation ?? 'FLAT'}>
            {(Object.keys(ORIENTATIONS) as Orientation[]).map((o) => <option key={o} value={o}><Text>{ORIENTATIONS[o]}</Text></option>)}
          </Select>
          <Select label="Shading" name="shading" defaultValue={existing?.shading ?? ''}>
            <option value=""><Text>Not surveyed yet</Text></option>
            {(Object.keys(SHADING) as Shading[]).map((s) => <option key={s} value={s}><Text>{SHADING[s]}</Text></option>)}
          </Select>
          <Input label="Roof age (years)" name="roofAgeYears" type="number" min={0} max={200} defaultValue={existing?.roof_age_years ?? ''} hint="Rooftops only. Leave empty if unknown." />
          <Input label="Expert’s rank (optional)" name="expertRank" type="number" min={1} defaultValue={existing?.expert_rank ?? ''} hint="An engineer’s own ranking, to test this shortlist." />
          <Checkbox label="Structural check done" name="structuralChecked" defaultChecked={existing?.structural_checked ?? false} className="sm:col-span-2" />
          <Textarea label="Notes (optional)" name="notes" defaultValue={existing?.notes ?? ''} maxLength={300} className="sm:col-span-2" />
        </form>
      )}
    </Modal>
  );
}
