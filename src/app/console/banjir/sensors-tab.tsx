'use client';

import { Text } from '@/components/ui/localized-text';

import { BatteryLow, BatteryMedium, KeyRound, Plus, Signal, Wrench } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { SimulatedNote } from '@/components/features/preview';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState } from '@/components/ui/feedback';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/field';
import { DataTable } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatDateTime, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { FLOOD_FAULT_LABELS, FLOOD_SENSOR_KIND_LABELS, FLOOD_SENSOR_KINDS, FLOOD_SENSOR_SITE_LABELS, FLOOD_SENSOR_SITES } from '@/shared/domain';
import type { AgentZone, SensorRow } from './types';

const LOG_WORDS: Record<string, string> = {
  REGISTERED: 'Registered',
  FAULT: 'Fault',
  RECOVERED: 'Reporting normally again',
  MAINTENANCE: 'Maintenance',
  CALIBRATED: 'Calibrated',
  THRESHOLDS: 'Thresholds changed',
  RETIRED: 'Retired',
};

function HealthBadge({ sensor }: { sensor: Pick<SensorRow, 'health' | 'health_reason'> }) {
  if (sensor.health === 'FAULTY') return <Badge tone="danger"><Text>{sensor.health_reason ? FLOOD_FAULT_LABELS[sensor.health_reason] : 'Faulty'}</Text></Badge>;
  if (sensor.health === 'OK') return <Badge tone="success"><Text>OK</Text></Badge>;
  return <Badge><Text>Waiting for a reading</Text></Badge>;
}

const num = (form: FormData, key: string) => Number(String(form.get(key) ?? '').trim());

/** Tab 3: battery, signal strength, last seen and health for every sensor; register, calibrate, set thresholds, log maintenance. */
export function SensorsTab({ zones }: { zones: Pick<AgentZone, 'id' | 'name'>[] }) {
  const sensors = useApi<SensorRow[]>('/admin/banjir/sensors', { refreshInterval: 10_000 });
  const [registering, setRegistering] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = sensors.data?.find((s) => s.id === openId) ?? null;
  const faulty = sensors.data?.filter((s) => s.health === 'FAULTY').length ?? 0;
  const tickets = sensors.data?.filter((s) => s.ticket).length ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-600">
          <Text>{sensors.data?.length ?? 0}</Text><Text> sensors · </Text><Text>{faulty}</Text><Text> faulty · </Text><Text>{tickets}</Text><Text> open tickets. A faulty sensor cannot count as a signal.</Text>
        </p>
        <Button onClick={() => setRegistering(true)}><Plus className="size-4" aria-hidden /><Text>Register a sensor</Text></Button>
      </div>
      <Async state={sensors}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState title="No sensors registered"><Text>Register the water-level sensors for each zone: two or three per zone, at the lake edge, the main drain and the low road.</Text></EmptyState>
          ) : (
            <DataTable
              caption="Flood sensors"
              rows={list}
              keyOf={(s) => s.id}
              columns={[
                {
                  header: 'Sensor',
                  cell: (s) => (
                    <span>
                      <span className="block font-semibold text-ink-900">{s.code}{s.simulated && <Badge className="ml-2" tone="gold"><Text>Simulated</Text></Badge>}</span>
                      <span className="block text-xs text-ink-500">{s.zone_name} · <Text>{FLOOD_SENSOR_SITE_LABELS[s.site]}</Text></span>
                    </span>
                  ),
                },
                { header: 'Health', cell: (s) => <span className="flex flex-wrap items-center gap-1.5"><HealthBadge sensor={s} />{s.ticket && <Badge tone="warning"><Text>Ticket open</Text></Badge>}</span> },
                {
                  header: 'Battery',
                  cell: (s) =>
                    s.last_battery === null ? '–' : (
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        {s.last_battery < s.low_battery_pct ? <BatteryLow className="size-4 text-accent-600" aria-hidden /> : <BatteryMedium className="size-4 text-ink-500" aria-hidden />}
                        <Text>{s.last_battery}</Text>%
                      </span>
                    ),
                },
                { header: 'Signal', desktopOnly: true, cell: (s) => (s.last_rssi === null ? '–' : <span className="inline-flex items-center gap-1 tabular-nums"><Signal className="size-4 text-ink-500" aria-hidden /><Text>{s.last_rssi}</Text><Text> dBm</Text></span>) },
                {
                  header: 'Last reading',
                  cell: (s) => (s.last_seen_at ? <span><span className="tabular-nums"><Text>{s.last_level_pct}</Text>% · <Text>{s.last_level_cm}</Text><Text> cm</Text></span><span className="block text-xs text-ink-500"><Text>{timeAgo(s.last_seen_at)}</Text></span></span> : <Text>Never</Text>),
                },
                { header: 'Uptime, 24 h', desktopOnly: true, align: 'right', cell: (s) => (s.uptime_pct === null ? '–' : <span><Text>{s.uptime_pct}</Text>%</span>) },
                { header: 'Actions', cell: (s) => <Button size="sm" variant="secondary" onClick={() => setOpenId(s.id)}><Wrench className="size-4" aria-hidden /><Text>Manage</Text></Button> },
              ]}
            />
          )
        }
      </Async>
      <RegisterSensor open={registering} zones={zones} onClose={() => setRegistering(false)} onDone={() => void sensors.mutate()} />
      {open && <ManageSensor key={open.id} sensor={open} onClose={() => setOpenId(null)} onChange={() => void sensors.mutate()} />}
    </div>
  );
}

function RegisterSensor({ open, zones, onClose, onDone }: { open: boolean; zones: Pick<AgentZone, 'id' | 'name'>[]; onClose: () => void; onDone: () => void }) {
  const [created, setCreated] = useState<{ code: string; secret: string } | null>(null);
  const register = useAction((body: Record<string, unknown>) => api.post<{ id: string; code: string; secret: string }>('/admin/banjir/sensors', body), {
    onSuccess: (r) => {
      setCreated(r);
      onDone();
    },
  });
  const close = () => {
    setCreated(null);
    onClose();
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void register.run({
      zoneId: String(form.get('zoneId')),
      code: String(form.get('code') ?? '').trim(),
      kind: String(form.get('kind')),
      site: String(form.get('site')),
      locationNote: String(form.get('locationNote') ?? '').trim() || undefined,
      baseCm: num(form, 'baseCm'),
      overflowCm: num(form, 'overflowCm'),
      riseCm10min: num(form, 'riseCm10min'),
      lowBatteryPct: num(form, 'lowBatteryPct'),
      simulated: form.get('simulated') === 'on',
    });
  };
  return (
    <Modal open={open} onClose={close} title={created ? 'Sensor registered' : 'Register a sensor'} description={created ? undefined : 'Readings are percentages of the calibrated height, from the base (0%) to overflow (100%).'}>
      {created ? (
        <div className="space-y-4 text-sm text-ink-700">
          <p className="flex items-center gap-2 font-semibold text-ink-900"><KeyRound className="size-4" aria-hidden />{created.code}</p>
          <p><Text>Load this signing key into the sensor. It is shown only now; if it is lost, register the sensor again.</Text></p>
          <code className="block break-all rounded-md bg-ink-900 p-3 font-mono text-xs text-white">{created.secret}</code>
          <Button onClick={close}><Text>Done</Text></Button>
        </div>
      ) : (
        <form method="post" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Select name="zoneId" label="Zone" defaultValue={zones[0]?.id} error={register.fields.zoneId}>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </Select>
          <Input name="code" label="Code on the device" placeholder="For example EV12-DRAIN-1" required error={register.fields.code} />
          <Select name="kind" label="Type" defaultValue="RADAR">
            {FLOOD_SENSOR_KINDS.map((k) => <option key={k} value={k}><Text>{FLOOD_SENSOR_KIND_LABELS[k]}</Text></option>)}
          </Select>
          <Select name="site" label="Placed at" defaultValue="MAIN_DRAIN">
            {FLOOD_SENSOR_SITES.map((s) => <option key={s} value={s}><Text>{FLOOD_SENSOR_SITE_LABELS[s]}</Text></option>)}
          </Select>
          <Input name="locationNote" label="Where exactly (optional)" className="sm:col-span-2" placeholder="Under the bridge on Persiaran Metafasa" />
          <Input name="baseCm" type="number" step="0.1" min={0} label="Base height (0%), cm" defaultValue={0} required error={register.fields.baseCm} />
          <Input name="overflowCm" type="number" step="0.1" min={1} label="Overflow height (100%), cm" defaultValue={180} required error={register.fields.overflowCm} />
          <Input name="riseCm10min" type="number" step="0.5" min={1} label="Fast rise: more than this many cm in 10 minutes" defaultValue={15} hint="Set from the site survey." />
          <Input name="lowBatteryPct" type="number" min={1} max={90} label="Low battery below, %" defaultValue={20} />
          <Checkbox name="simulated" label="Simulated sensor (prototype): driven from this console, but signs its readings like a real one" defaultChecked className="sm:col-span-2" />
          <div className="sm:col-span-2"><Button type="submit" pending={register.pending}><Text>Register</Text></Button></div>
        </form>
      )}
    </Modal>
  );
}

function ManageSensor({ sensor, onClose, onChange }: { sensor: SensorRow; onClose: () => void; onChange: () => void }) {
  const calibrate = useAction((body: Record<string, unknown>) => api.post(`/admin/banjir/sensors/${sensor.id}/calibrate`, body), { onSuccess: onChange, success: 'Calibration saved.' });
  const thresholds = useAction((body: Record<string, unknown>) => api.post(`/admin/banjir/sensors/${sensor.id}/thresholds`, body), { onSuccess: onChange, success: 'Thresholds saved.' });
  const maintenance = useAction((note: string) => api.post<{ ticketClosed: boolean }>(`/admin/banjir/sensors/${sensor.id}/maintenance`, { note }), {
    onSuccess: onChange,
    success: (r) => (r.ticketClosed ? 'Logged. The ticket is closed.' : 'Logged.'),
  });
  const simulate = useAction((action: string) => api.post(`/admin/banjir/sensors/${sensor.id}/simulate`, { action }), { onSuccess: onChange });
  const [note, setNote] = useState('');

  return (
    <Modal open onClose={onClose} wide title={sensor.code} description={`${sensor.zone_name} · ${FLOOD_SENSOR_SITE_LABELS[sensor.site]} · ${FLOOD_SENSOR_KIND_LABELS[sensor.kind]}`}>
      <div className="space-y-6 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <HealthBadge sensor={sensor} />
          {sensor.ticket && <Badge tone="warning"><Text>Ticket open since </Text><Text>{formatDateTime(sensor.ticket.at)}</Text></Badge>}
          {sensor.location_note && <span className="text-ink-600"><Text>{sensor.location_note}</Text></span>}
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <form
            method="post"
            className="space-y-3 rounded-lg border border-ink-200 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void calibrate.run({ baseCm: num(form, 'baseCm'), overflowCm: num(form, 'overflowCm') });
            }}
          >
            <p className="font-semibold text-ink-900"><Text>Calibrate</Text></p>
            <p className="text-ink-500"><Text>Measure on site against a known gauge; check again each monsoon season.</Text>{sensor.calibrated_at && <> <Text>Last: </Text><Text>{formatDateTime(sensor.calibrated_at)}</Text></>}</p>
            <div className="grid grid-cols-2 gap-3">
              <Input name="baseCm" type="number" step="0.1" min={0} label="Base, cm" defaultValue={sensor.base_cm} error={calibrate.fields.baseCm} />
              <Input name="overflowCm" type="number" step="0.1" min={1} label="Overflow, cm" defaultValue={sensor.overflow_cm} error={calibrate.fields.overflowCm} />
            </div>
            <Button type="submit" size="sm" variant="secondary" pending={calibrate.pending}><Text>Save calibration</Text></Button>
          </form>
          <form
            method="post"
            className="space-y-3 rounded-lg border border-ink-200 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void thresholds.run({ riseCm10min: num(form, 'riseCm10min'), lowBatteryPct: num(form, 'lowBatteryPct') });
            }}
          >
            <p className="font-semibold text-ink-900"><Text>Thresholds</Text></p>
            <p className="text-ink-500"><Text>A faster climb than this counts as a warning signal, even below 75%.</Text></p>
            <div className="grid grid-cols-2 gap-3">
              <Input name="riseCm10min" type="number" step="0.5" min={1} label="Rise in 10 min, cm" defaultValue={sensor.rise_cm_10min} />
              <Input name="lowBatteryPct" type="number" min={1} max={90} label="Low battery, %" defaultValue={sensor.low_battery_pct} />
            </div>
            <Button type="submit" size="sm" variant="secondary" pending={thresholds.pending}><Text>Save thresholds</Text></Button>
          </form>
        </div>

        <form
          method="post"
          className="space-y-3 rounded-lg border border-ink-200 p-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await maintenance.run(note)) setNote('');
          }}
        >
          <Textarea label="Log maintenance" hint="Logging a visit closes the open ticket." value={note} onChange={(event) => setNote(event.target.value)} rows={2} error={maintenance.fields.note} />
          <Button type="submit" size="sm" pending={maintenance.pending} disabled={note.trim().length < 3}><Text>Log it</Text></Button>
        </form>

        {sensor.simulated && (
          <div className="space-y-3">
            <SimulatedNote><Text>Test controls for this simulated sensor. A power cut is noticed after 5 minutes of silence, a stuck value after 20 minutes, a low battery at once.</Text></SimulatedNote>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={sensor.sim_paused ? 'primary' : 'danger'} onClick={() => void simulate.run(sensor.sim_paused ? 'POWER_ON' : 'POWER_CUT')} pending={simulate.pending}>
                <Text>{sensor.sim_paused ? 'Restore power' : 'Cut power'}</Text>
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void simulate.run((sensor.sim_battery ?? 96) < sensor.low_battery_pct ? 'BATTERY_OK' : 'LOW_BATTERY')} disabled={simulate.pending}>
                <Text>{(sensor.sim_battery ?? 96) < sensor.low_battery_pct ? 'New battery' : 'Drain the battery'}</Text>
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void simulate.run(sensor.sim_stuck ? 'UNSTUCK' : 'STUCK')} disabled={simulate.pending}>
                <Text>{sensor.sim_stuck ? 'Unstick the value' : 'Stick on one value'}</Text>
              </Button>
            </div>
          </div>
        )}

        <div>
          <p className="mb-2 font-semibold text-ink-900"><Text>Health and maintenance log</Text></p>
          <ol className="space-y-1.5 border-l-2 border-ink-200 pl-3">
            {sensor.log.map((l) => (
              <li key={l.id}>
                <span className="font-medium text-ink-900"><Text>{LOG_WORDS[l.kind] ?? l.kind}</Text></span>
                {l.reason && <span className="text-ink-600"> · <Text>{FLOOD_FAULT_LABELS[l.reason]}</Text></span>}
                {l.ticket_open && <Badge className="ml-2" tone="warning"><Text>Ticket open</Text></Badge>}
                {l.note && <span className="block text-ink-600"><Text>{l.note}</Text></span>}
                <span className="block text-xs text-ink-500"><Text>{formatDateTime(l.at)}</Text>{l.actor_name && <> · {l.actor_name}</>}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Modal>
  );
}
