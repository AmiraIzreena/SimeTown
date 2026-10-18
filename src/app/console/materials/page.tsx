'use client';

import { Text } from '@/components/ui/localized-text';

import { Bot, CheckCircle2, CircleAlert, CircleHelp, FlaskConical, ListChecks, XCircle } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader, Stat } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState, SkeletonList } from '@/components/ui/feedback';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/field';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { api, type ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, formatKg } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

type Tab = 'compare' | 'trial';
type UseCase = 'WALKWAY_PAVING' | 'LANDSCAPE_EDGING';
type Key = 'costRm' | 'lifeYears' | 'strengthMpa' | 'permeable' | 'uvStable';
interface Criterion { key: Key; label: string; unit: string; kind: 'min' | 'max' | 'must' }
interface Row {
  id: string;
  name: string;
  conventional: boolean;
  values: Partial<Record<Key, number | boolean | null>>;
  carbonKg: number | null;
  recycledPct: number | null;
  checks: { key: Key; verdict: 'MEETS' | 'FAILS' | 'NO_DATA' }[];
  fails: number;
  noData: number;
  missingEvidence: string[];
  missingData: string[];
  rank: number;
  carbonVsBaselinePct: number | null;
}
interface Comparison { use: UseCase; useLabel: string; unit: string; criteria: Criterion[]; rows: Row[]; baselineId: string | null }

const USE_LABELS: Record<UseCase, string> = { WALKWAY_PAVING: 'Walkway paving', LANDSCAPE_EDGING: 'Landscape edging' };
const DEFAULTS: Record<UseCase, Partial<Record<Key, number | boolean>>> = {
  WALKWAY_PAVING: { costRm: 80, lifeYears: 20, strengthMpa: 30, permeable: false },
  LANDSCAPE_EDGING: { costRm: 40, lifeYears: 15, uvStable: true },
};
const VERDICT = {
  MEETS: { icon: CheckCircle2, className: 'text-success-700', label: 'Meets' },
  FAILS: { icon: XCircle, className: 'text-accent-600', label: 'Does not meet' },
  NO_DATA: { icon: CircleHelp, className: 'text-gold-700', label: 'No data' },
};

export default function MaterialsPage() {
  const [tab, setTab] = useState<Tab>('compare');
  return (
    <>
      <PageHeader title="Greener materials" description="Compare materials for one use against its performance requirements, with missing environmental evidence flagged; and follow the recycled-plastic edging trial." />
      <Tabs<Tab> label="Greener materials" value={tab} onChange={setTab} items={[{ key: 'compare', label: 'Compare materials' }, { key: 'trial', label: 'Edging trial' }]} />
      <TabPanel>{tab === 'compare' ? <Compare /> : <Trial />}</TabPanel>
    </>
  );
}

function Compare() {
  const [use, setUse] = useState<UseCase>('WALKWAY_PAVING');
  const [req, setReq] = useState(DEFAULTS.WALKWAY_PAVING);
  const [started, setStarted] = useState(() => Date.now());
  const [picked, setPicked] = useState<string[]>([]);
  const [explanation, setExplanation] = useState<{ summary: string; source: 'AI' | 'RULES' } | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  // A comparison is worked out by the server from the requirements; SWR keeps the last one while a new one loads.
  const result = useSWR<Comparison, ApiError>(['materials-compare', use, JSON.stringify(req)], () => api.post<Comparison>('/admin/materials/compare', { use, requirements: req }), { keepPreviousData: true, shouldRetryOnError: false });
  const shortlists = useApi<{ medianSeconds: number | null; shortlists: { id: string; useLabel: string; materials: string[]; seconds_taken: number; note: string | null; created_at: string; full_name: string }[] }>('/admin/materials/shortlists');
  const explain = useAction(() => api.post<{ summary: string; source: 'AI' | 'RULES' }>('/admin/materials/explain', { use, requirements: req }), { onSuccess: setExplanation });
  const save = useAction(
    () => api.post('/admin/materials/shortlists', { use, requirements: req, materialIds: picked, secondsTaken: Math.round((Date.now() - started) / 1000), note: note.trim() || undefined }),
    {
      success: 'Shortlist saved.',
      onSuccess: () => {
        setSaving(false);
        setPicked([]);
        setNote('');
        setStarted(Date.now());
        void shortlists.mutate();
      },
    },
  );
  const changeUse = (u: UseCase) => {
    setUse(u);
    setReq(DEFAULTS[u]);
    setPicked([]);
    setExplanation(null);
    setStarted(Date.now());
  };
  const setValue = (k: Key, value: number | boolean | undefined) => {
    setReq((current) => {
      const next = { ...current };
      if (value === undefined) delete next[k];
      else next[k] = value;
      return next;
    });
    setExplanation(null);
  };

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-gold-50 px-4 py-3 text-sm text-gold-700"><Text>The library holds sample values to show how the comparison works. Replace each with the supplier’s datasheet before any decision.</Text></p>
      <Card>
        <CardHeader title="Requirements" description="Set what this use needs. Leave a box empty to ignore it." />
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Select label="Use" value={use} onChange={(event) => changeUse(event.target.value as UseCase)}>
            {(Object.keys(USE_LABELS) as UseCase[]).map((u) => <option key={u} value={u}><Text>{USE_LABELS[u]}</Text></option>)}
          </Select>
          {result.data?.criteria.map((c) =>
            c.kind === 'must' ? (
              <Checkbox key={c.key} className="self-end pb-3" label={c.label} checked={req[c.key] === true} onChange={(event) => setValue(c.key, event.target.checked ? true : undefined)} />
            ) : (
              <Input
                key={c.key}
                label={c.label}
                hint={<><Text>{c.kind === 'max' ? 'At most' : 'At least'}</Text>, <Text>{c.unit}</Text></>}
                type="number"
                min={0}
                value={req[c.key] === undefined ? '' : String(req[c.key])}
                onChange={(event) => setValue(c.key, event.target.value === '' ? undefined : Number(event.target.value))}
              />
            ),
          )}
        </div>
      </Card>

      <Async state={result} skeleton={<SkeletonList rows={4} />}>
        {(r) => (
          <Card>
            <CardHeader
              title={`${r.useLabel}: best fit first`}
              description="Ranked by requirements met, then data available, then lowest embodied carbon, then cost. Tick the ones to shortlist."
              action={<Button size="sm" variant="secondary" onClick={() => void explain.run()} pending={explain.pending}><Bot className="size-4" aria-hidden /><Text>Ask the agent</Text></Button>}
            />
            {explanation && (
              <div className="mx-5 mb-2 rounded-lg bg-brand-50 p-4 text-[15px] text-brand-800">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-600"><Text>{explanation.source === 'AI' ? 'Agent summary (from this table only)' : 'Summary from the table'}</Text></p>
                <p className="mt-1">{explanation.summary}</p>
              </div>
            )}
            <ul className="divide-y divide-ink-100">
              {r.rows.map((row) => (
                <li key={row.id} className={cn('space-y-3 px-5 py-4', picked.includes(row.id) && 'bg-brand-50/40')}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <label className="flex min-w-0 cursor-pointer items-start gap-3">
                      <input type="checkbox" className="mt-1 size-5 accent-brand-700" checked={picked.includes(row.id)} onChange={() => setPicked((cur) => (cur.includes(row.id) ? cur.filter((x) => x !== row.id) : [...cur, row.id]))} />
                      <span>
                        <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink-900">
                          {row.rank}. <Text>{row.name}</Text>
                          {row.conventional && <Badge tone="neutral"><Text>Conventional</Text></Badge>}
                          {row.fails === 0 && row.noData === 0 && <Badge tone="success"><Text>Meets all</Text></Badge>}
                        </span>
                        <span className="block text-sm text-ink-500">
                          <Text>{row.carbonKg != null ? `${row.carbonKg} kg CO2e per ${r.unit}` : 'No carbon figure'}</Text>
                          {row.carbonVsBaselinePct != null && <> · <Text>{`${row.carbonVsBaselinePct > 0 ? '+' : ''}${row.carbonVsBaselinePct}% against conventional`}</Text></>}
                          {row.recycledPct ? <> · <Text>{`${row.recycledPct}% recycled content`}</Text></> : null}
                        </span>
                      </span>
                    </label>
                  </div>
                  <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                    {r.criteria.map((c) => {
                      const check = row.checks.find((x) => x.key === c.key);
                      const value = row.values[c.key];
                      const shown = value === null || value === undefined ? 'no data' : typeof value === 'boolean' ? (value ? 'yes' : 'no') : `${value} ${c.unit}`;
                      const v = check ? VERDICT[check.verdict] : null;
                      return (
                        <li key={c.key} className="inline-flex items-center gap-1.5 text-ink-700">
                          {v && <v.icon className={cn('size-4', v.className)} aria-label={v.label} />}
                          <Text>{c.label}</Text>: <Text>{shown}</Text>
                        </li>
                      );
                    })}
                  </ul>
                  {row.missingEvidence.length > 0 && (
                    <ul className="flex flex-wrap gap-2">
                      {row.missingEvidence.map((m) => (
                        <li key={m} className="inline-flex items-center gap-1.5 rounded-full bg-warning-50 px-3 py-1 text-xs font-medium text-warning-700">
                          <CircleAlert className="size-3.5" aria-hidden /><Text>{m}</Text>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-5 py-4">
              <p className="text-sm text-ink-600"><Text>{picked.length === 1 ? '1 material ticked' : `${picked.length} materials ticked`}</Text></p>
              <Button onClick={() => setSaving(true)} disabled={picked.length === 0}><ListChecks className="size-4" aria-hidden /><Text>Save shortlist</Text></Button>
            </div>
          </Card>
        )}
      </Async>

      <Card>
        <CardHeader title="Saved shortlists" description={shortlists.data?.medianSeconds != null ? `Median time to shortlist: ${Math.round(shortlists.data.medianSeconds / 60 * 10) / 10} min` : 'The time each one took is recorded, to compare with doing it by hand.'} />
        <Async state={shortlists} skeleton={<SkeletonList rows={2} className="p-5" />}>
          {(s) =>
            s.shortlists.length === 0 ? (
              <div className="p-5"><EmptyState icon={ListChecks} title="No shortlists yet" /></div>
            ) : (
              <ul className="divide-y divide-ink-100">
                {s.shortlists.map((x) => (
                  <li key={x.id} className="space-y-0.5 px-5 py-3">
                    <p className="text-[15px] font-semibold text-ink-900"><Text>{x.useLabel}</Text>: {x.materials.map((m, i) => <span key={m}>{i > 0 && ', '}<Text>{m}</Text></span>)}</p>
                    <p className="text-sm text-ink-500">{x.full_name} · <Text>{formatDateTime(x.created_at)}</Text> · <Text>{`${Math.max(1, Math.round(x.seconds_taken / 60))} min`}</Text></p>
                    {x.note && <p className="text-sm text-ink-700">{x.note}</p>}
                  </li>
                ))}
              </ul>
            )
          }
        </Async>
      </Card>

      <Modal
        open={saving}
        onClose={() => setSaving(false)}
        title="Save shortlist"
        description="The materials you ticked, with the requirements and how long it took."
        footer={<><Button variant="secondary" onClick={() => setSaving(false)}><Text>Cancel</Text></Button><Button onClick={() => void save.run()} pending={save.pending}><Text>Save</Text></Button></>}
      >
        <Textarea label="Note (optional)" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder="e.g. Ask suppliers for EPDs before the design review" />
      </Modal>
    </div>
  );
}

interface TrialTest {
  id: string;
  seq: number;
  area: 'SAFETY' | 'PERFORMANCE' | 'ENVIRONMENT';
  name: string;
  method: string;
  pass_rule: string;
  result_recycled: string | null;
  result_conventional: string | null;
  status: 'PLANNED' | 'RUNNING' | 'PASSED' | 'FAILED';
  updated_at: string | null;
}
const AREA_LABELS = { SAFETY: 'Safety', PERFORMANCE: 'Performance', ENVIRONMENT: 'Environment' } as const;
const TEST_STATUS = {
  PLANNED: { label: 'Planned', tone: 'neutral' as const },
  RUNNING: { label: 'Running', tone: 'brand' as const },
  PASSED: { label: 'Passed', tone: 'success' as const },
  FAILED: { label: 'Failed', tone: 'danger' as const },
};

function Trial() {
  const trial = useApi<{ plasticCollectedG: number; tests: TrialTest[]; counts: Record<TrialTest['status'], number> }>('/admin/edging-trial');
  const [kgPerMetre, setKgPerMetre] = useState('');
  const [editing, setEditing] = useState<TrialTest | null>(null);
  const update = useAction((id: string, body: Record<string, unknown>) => api.patch(`/admin/edging-trial/tests/${id}`, body), {
    success: 'Result saved.',
    onSuccess: () => {
      setEditing(null);
      void trial.mutate();
    },
  });
  return (
    <Async state={trial} skeleton={<SkeletonList rows={4} />}>
      {(t) => {
        const perMetre = Number(kgPerMetre);
        const metres = perMetre > 0 ? Math.floor(t.plasticCollectedG / 1000 / perMetre) : null;
        return (
          <div className="space-y-6">
            <p className="text-[15px] text-ink-700"><Text>A recycling partner turns plastic that residents recycled into landscape edging. A trial strip is laid beside conventional concrete edging, and both go through the same tests.</Text></p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="Plastic recycled in the township" value={t.plasticCollectedG} format={formatKg} icon={FlaskConical} hint="Kiosks and smart machines, all time" />
              <Card className="p-5">
                <Input label="Partner’s plastic per metre of edging (kg)" type="number" min={0} step={0.1} value={kgPerMetre} onChange={(event) => setKgPerMetre(event.target.value)} hint="From the partner’s product sheet." />
                <p className="mt-2 font-display text-xl font-bold text-ink-900"><Text>{metres != null ? `Enough for about ${metres} m of edging` : 'Enter the partner’s figure'}</Text></p>
              </Card>
              <Stat label="Tests passed" value={`${t.counts.PASSED} / ${t.tests.length}`} icon={CheckCircle2} tone="success" hint={`${t.counts.FAILED} failed · ${t.counts.RUNNING} running`} />
            </div>
            {(['SAFETY', 'PERFORMANCE', 'ENVIRONMENT'] as const).map((area) => (
              <Card key={area}>
                <CardHeader title={AREA_LABELS[area]} />
                <ul className="divide-y divide-ink-100">
                  {t.tests.filter((x) => x.area === area).map((x) => (
                    <li key={x.id} className="space-y-1.5 px-5 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[15px] font-semibold text-ink-900"><Text>{x.name}</Text></p>
                        <div className="flex items-center gap-2">
                          <Badge tone={TEST_STATUS[x.status].tone}><Text>{TEST_STATUS[x.status].label}</Text></Badge>
                          <Button size="sm" variant="secondary" onClick={() => setEditing(x)}><Text>Record result</Text></Button>
                        </div>
                      </div>
                      <p className="text-sm text-ink-600"><Text>How: </Text><Text>{x.method}</Text></p>
                      <p className="text-sm text-ink-600"><Text>Pass if: </Text><Text>{x.pass_rule}</Text></p>
                      {(x.result_recycled || x.result_conventional) && (
                        <div className="grid gap-2 pt-1 text-sm sm:grid-cols-2">
                          <p className="rounded-md bg-success-50 p-2.5 text-ink-800"><strong><Text>Recycled edging: </Text></strong>{x.result_recycled ?? '–'}</p>
                          <p className="rounded-md bg-ink-50 p-2.5 text-ink-800"><strong><Text>Concrete edging: </Text></strong>{x.result_conventional ?? '–'}</p>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
            <Modal
              open={editing !== null}
              onClose={() => setEditing(null)}
              title={editing?.name ?? ''}
              description={editing?.pass_rule}
              footer={<><Button variant="secondary" onClick={() => setEditing(null)}><Text>Cancel</Text></Button><Button type="submit" form="trial-result" pending={update.pending}><Text>Save</Text></Button></>}
            >
              {editing && (
                <form
                  method="post"
                  id="trial-result"
                  key={editing.id}
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void update.run(editing.id, {
                      status: form.get('status'),
                      resultRecycled: String(form.get('resultRecycled') ?? '').trim() || null,
                      resultConventional: String(form.get('resultConventional') ?? '').trim() || null,
                    });
                  }}
                >
                  <Select label="Status" name="status" defaultValue={editing.status}>
                    {(Object.keys(TEST_STATUS) as TrialTest['status'][]).map((s) => <option key={s} value={s}><Text>{TEST_STATUS[s].label}</Text></option>)}
                  </Select>
                  <Textarea label="Result: recycled-plastic edging" name="resultRecycled" defaultValue={editing.result_recycled ?? ''} maxLength={300} />
                  <Textarea label="Result: concrete edging" name="resultConventional" defaultValue={editing.result_conventional ?? ''} maxLength={300} />
                </form>
              )}
            </Modal>
          </div>
        );
      }}
    </Async>
  );
}
