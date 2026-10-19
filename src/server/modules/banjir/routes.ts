import { z } from 'zod';
import { FLOOD_SENSOR_KINDS, FLOOD_SENSOR_SITES, FLOOD_TEST_PICTURES, STAFF } from '@/shared/domain';
import { route, zId, zText } from '../../http/router';
import * as agent from './agent';
import * as events from './events';
import { ingestReadings } from './ingest';
import * as sensors from './sensors';
import * as banjir from './service';

const zLevel = z.number().int().min(0).max(100);
const zCm = z.number().min(0).max(2000);
const pictureIds = FLOOD_TEST_PICTURES.map((p) => p.id) as [(typeof FLOOD_TEST_PICTURES)[number]['id'], ...(typeof FLOOD_TEST_PICTURES)[number]['id'][]];

/** One signed reading, as Appendix E.1 specifies the payload. */
const zReading = z.object({
  sensor_id: zId,
  zone_id: zId,
  level_cm: zCm,
  battery: z.number().int().min(0).max(100),
  rssi: z.number().int().min(-200).max(0),
  ts: z.iso.datetime({ offset: true }),
  signature: z.string().regex(/^[0-9a-fA-F]{64}$/, 'An HMAC-SHA256 signature in hex.'),
});

export const banjirRoutes = [
  route({
    method: 'GET', path: '/banjir', tag: 'Banjir', summary: 'Water level, risk, last verified reading and the latest official message for each zone', auth: 'session', roles: ['RESIDENT', 'GUARD', ...STAFF],
    handler: (c) => banjir.banjirOverview(c.db, c.actor, c.now),
  }),
  route({
    method: 'GET', path: '/banjir/zones/:zoneId/history', tag: 'Banjir', summary: "A zone's water level over the last hours, in 10-minute steps", auth: 'session', roles: ['RESIDENT', 'GUARD', ...STAFF],
    query: z.object({ hours: z.coerce.number().int().min(1).max(48).optional() }),
    handler: (c) => events.zoneHistory(c.db, c.actor, c.params.zoneId!, c.now, c.query.hours),
  }),
  route({
    method: 'GET', path: '/alerts/active', tag: 'Banjir', summary: 'Open flood alerts that concern me (drives the danger takeover)', auth: 'session', roles: ['RESIDENT', 'GUARD', ...STAFF],
    handler: (c) => banjir.activeAlerts(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/banjir/checkin', tag: 'Banjir', summary: '"I\'m safe" or "I need help" during an alert in my zone', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 20, windowSec: 600, by: 'user' },
    body: z.object({ status: z.enum(['SAFE', 'NEED_HELP']) }),
    handler: (c) => agent.checkIn(c.db, c.actor, c.body.status, c.now),
  }),
  route({
    method: 'POST', path: '/banjir/help-tasks/:taskId/reached', tag: 'Banjir', summary: 'The guard (or duty staff) marks a resident on the priority help list as reached', auth: 'session', roles: ['GUARD', ...STAFF],
    handler: (c) => events.markReached(c.db, c.actor, c.params.taskId!, c.now),
  }),
  route({
    method: 'GET', path: '/public/flood-status', tag: 'Banjir', summary: 'The one official flood status page (no sign-in, nothing about any person)', auth: 'public',
    rateLimit: { limit: 120, windowSec: 60, by: 'ip' },
    handler: (c) => agent.publicFloodStatus(c.db),
  }),
  route({
    method: 'POST', path: '/admin/banjir/zones/:zoneId/level', tag: 'Banjir', summary: 'The duty officer sets a zone water level by hand (sent at once)', auth: 'session', roles: STAFF,
    body: z.object({ levelPct: zLevel }),
    handler: (c) => banjir.recordLevel(c.db, { zoneId: c.params.zoneId!, levelPct: c.body.levelPct, actor: c.actor }, c.now),
  }),
  route({
    method: 'GET', path: '/admin/banjir/agent', tag: 'Banjir', summary: "The Banjir agent: each zone's signals, sensors, drafts waiting for the officer and the decision timeline", auth: 'session', roles: STAFF,
    handler: (c) => agent.agentOverview(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/admin/banjir/zones/:zoneId/signals', tag: 'Banjir', summary: "Prototype: a signal from the sensor simulator (signed readings from the zone's simulated sensors), a camera test picture or the rain gauge", auth: 'session', roles: STAFF,
    rateLimit: { limit: 240, windowSec: 60, by: 'user' },
    body: z.discriminatedUnion('source', [
      z.object({ source: z.literal('SENSOR'), levelPct: zLevel }),
      z.object({ source: z.literal('CAMERA'), pictureId: z.enum(pictureIds) }),
      z.object({ source: z.literal('RAIN'), rainMmHr: z.number().int().min(0).max(300) }),
    ]),
    handler: (c) => agent.simulateSignal(c.db, c.actor, c.params.zoneId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/banjir/drafts/:messageId', tag: 'Banjir', summary: 'One tap: send (optionally edited) or cancel a one-signal draft; a cancel or an edit needs a reason (BR21)', auth: 'session', roles: STAFF,
    body: z.object({ action: z.enum(['SEND', 'CANCEL']), what: zText(300, 10).optional(), todo: zText(300, 10).optional(), reason: zText(300, 3).optional() }),
    handler: (c) => agent.decideDraft(c.db, c.actor, c.params.messageId!, c.body, c.now),
  }),

  // --- Sensors (Appendix E.3) ---------------------------------------------------------------
  route({
    method: 'POST', path: '/flood/readings', tag: 'Banjir', summary: 'A sensor (or its gateway) posts signed readings: signature checked, duplicates dropped, stored, and the agent woken', auth: 'machine',
    rateLimit: { limit: 1200, windowSec: 60, by: 'ip' },
    body: z.union([zReading, z.object({ readings: z.array(zReading).min(1).max(100) })]),
    handler: (c) => ingestReadings(c.db, 'readings' in c.body ? c.body.readings : [c.body], c.now),
  }),
  route({
    method: 'GET', path: '/admin/banjir/sensors', tag: 'Banjir', summary: 'Every sensor: battery, signal strength, last seen, health, open ticket and maintenance log', auth: 'session', roles: STAFF,
    handler: (c) => sensors.listSensors(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/admin/banjir/sensors', tag: 'Banjir', summary: 'Register a sensor; its signing key is shown once', auth: 'session', roles: STAFF,
    body: z.object({
      zoneId: zId,
      code: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9-]+$/, 'Use letters, numbers and dashes.'),
      kind: z.enum(FLOOD_SENSOR_KINDS),
      site: z.enum(FLOOD_SENSOR_SITES),
      locationNote: zText(200).optional(),
      baseCm: zCm,
      overflowCm: zCm,
      riseCm10min: z.number().min(1).max(200).optional(),
      lowBatteryPct: z.number().int().min(1).max(90).optional(),
      simulated: z.boolean(),
    }),
    handler: (c) => sensors.registerSensor(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/banjir/sensors/:sensorId/calibrate', tag: 'Banjir', summary: "Calibrate a sensor on site: the base (0%) and overflow (100%) heights", auth: 'session', roles: STAFF,
    body: z.object({ baseCm: zCm, overflowCm: zCm, note: zText(300).optional() }),
    handler: (c) => sensors.calibrateSensor(c.db, c.actor, c.params.sensorId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/banjir/sensors/:sensorId/thresholds', tag: 'Banjir', summary: 'Set the rate-of-rise and low-battery thresholds from the site survey', auth: 'session', roles: STAFF,
    body: z.object({ riseCm10min: z.number().min(1).max(200), lowBatteryPct: z.number().int().min(1).max(90) }),
    handler: (c) => sensors.setThresholds(c.db, c.actor, c.params.sensorId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/banjir/sensors/:sensorId/maintenance', tag: 'Banjir', summary: "Log maintenance; closes the sensor's open ticket", auth: 'session', roles: STAFF,
    body: z.object({ note: zText(500, 3) }),
    handler: (c) => sensors.logMaintenance(c.db, c.actor, c.params.sensorId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/banjir/sensors/:sensorId/simulate', tag: 'Banjir', summary: 'Prototype: cut power, drain the battery or stick the value of a simulated sensor', auth: 'session', roles: STAFF,
    body: z.object({ action: z.enum(['POWER_CUT', 'POWER_ON', 'LOW_BATTERY', 'BATTERY_OK', 'STUCK', 'UNSTUCK']) }),
    handler: (c) => sensors.simulateSensorFault(c.db, c.actor, c.params.sensorId!, c.body.action, c.now),
  }),

  // --- Priority help, events and reports (Appendix E.3) ---------------------------------------------
  route({
    method: 'GET', path: '/admin/banjir/help', tag: 'Banjir', summary: 'The priority help list and "I need help" check-ins for zones under an alert, with their tasks (duty staff only)', auth: 'session', roles: STAFF,
    handler: (c) => events.helpBoard(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/admin/banjir/help-tasks', tag: 'Banjir', summary: 'Send a guard to reach a resident on the help list', auth: 'session', roles: STAFF,
    body: z.object({ eventId: zId, userId: zId, assignedTo: zId, note: zText(300).optional() }),
    handler: (c) => events.assignHelpTask(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'GET', path: '/admin/banjir/events', tag: 'Banjir', summary: 'Past and open flood events', auth: 'session', roles: STAFF,
    handler: (c) => events.listEvents(c.db, c.actor),
  }),
  route({
    method: 'GET', path: '/admin/banjir/events/:eventId', tag: 'Banjir', summary: 'The post-event report: timeline, who was warned, check-in rate and the false-alarm review', auth: 'session', roles: STAFF,
    handler: (c) => events.eventReport(c.db, c.actor, c.params.eventId!, c.now),
  }),
  route({
    method: 'POST', path: '/admin/banjir/events/:eventId/review', tag: 'Banjir', summary: 'Record the false-alarm review after the all clear', auth: 'session', roles: STAFF,
    body: z.object({ falseAlarm: z.boolean(), note: zText(1000, 3) }),
    handler: (c) => events.reviewEvent(c.db, c.actor, c.params.eventId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/ingest/flood', tag: 'Banjir', summary: 'Older unsigned bridge (bearer token): a zone-level reading. New sensors use POST /flood/readings', auth: 'sensor',
    rateLimit: { limit: 600, windowSec: 60, by: 'ip' },
    body: z.object({ zoneId: zId, levelPct: zLevel }),
    handler: (c) => agent.ingestSensor(c.db, c.body, c.now),
  }),
];
