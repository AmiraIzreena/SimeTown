import { z } from 'zod';
import { ADMINS, STAFF, type Role } from '@/shared/domain';
import { COURIER_PROBLEMS, DELIVERY_PROBLEMS, LOCKER_SIZES, PARCEL_STATES } from '@/shared/lockers';
import { badRequest } from '../../errors';
import { emptyBody, route, zEmail, zId, zPassword, zPhone, zText } from '../../http/router';
import * as admin from './admin';
import * as accessSessions from './access-sessions';
import * as collection from './collection';
import * as couriers from './couriers';
import { DEVICE } from './core';
import * as delivery from './delivery';
import * as exceptions from './exceptions';
import * as hardware from './hardware';
import * as incidents from './incidents';
import * as overflow from './overflow';

/** People who work the guardhouse counter: guardhouse staff, township staff and admins. Gate guards do not. */
const COUNTER: Role[] = ['GUARDHOUSE', 'TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN', 'HQ_ADMIN'];
const zKey = z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/, 'Check the request key.');
const zTracking = z.string().trim().min(6).max(40).regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and dashes only.');
const zCredential = z.string().trim().min(6).max(120);
const zMm = z.number().int().min(10).max(3000);
const zPolicy = z.object({
  first_reminder_hours: z.number().int().min(1).max(720),
  final_reminder_hours: z.number().int().min(2).max(720),
  relocate_after_hours: z.number().int().min(3).max(720),
  overflow_collect_days: z.number().int().min(1).max(60),
  quiet_from_hour: z.number().int().min(0).max(23),
  quiet_to_hour: z.number().int().min(0).max(23),
  extensions_enabled: z.boolean(),
  extension_hours: z.number().int().min(1).max(168),
  max_extensions: z.number().int().min(0).max(5),
  fee_enabled: z.boolean(),
  fee_sen: z.number().int().min(1).max(100_000).nullable(),
  exceptions_need_second_approval: z.boolean().default(true),
  door_reminder_hours: z.number().int().min(1).max(720).default(48),
  counter_call_after_days: z.number().int().min(2).max(90).default(14),
});
const zHour = z.number().int().min(0).max(24);

export const lockerRoutes = [
  // --- Couriers: signing up -----------------------------------------------------------------
  route({
    method: 'GET', path: '/couriers/companies', tag: 'Smart lockers', summary: 'Courier companies that may apply for locker access', auth: 'public',
    rateLimit: { limit: 60, windowSec: 60, by: 'ip' },
    handler: (c) => couriers.listCompanies(c.db),
  }),
  route({
    method: 'POST', path: '/couriers/apply', tag: 'Smart lockers', summary: 'Apply for a courier account (an admin approves it and chooses the stations)', auth: 'public',
    rateLimit: { limit: 5, windowSec: 3600, by: 'ip' },
    body: z.object({ townshipId: zId, companyId: zId, fullName: zText(80, 2), email: zEmail, phone: zPhone, password: zPassword }),
    handler: (c) => couriers.applyAsCourier(c.db, c.body, c.now),
  }),
  route({
    method: 'GET', path: '/lockers/stations/:code', tag: 'Smart lockers', summary: "A station's public name and place, from the code on its QR poster (grants nothing)", auth: 'public',
    rateLimit: { limit: 60, windowSec: 60, by: 'ip' },
    handler: async (c) => {
      if (!/^[A-Za-z0-9]{6,12}$/.test(c.params.code!)) throw badRequest('Check the station code.');
      return delivery.stationByCode(c.db, c.params.code!);
    },
  }),

  // --- Couriers: delivering -----------------------------------------------------------------
  route({
    method: 'GET', path: '/courier', tag: 'Smart lockers', summary: "The courier's account status and the stations they may use", auth: 'session', roles: ['COURIER'],
    handler: (c) => couriers.courierHome(c.db, c.actor),
  }),
  route({
    method: 'GET', path: '/courier/parcels', tag: 'Smart lockers', summary: "The courier's recent deliveries", auth: 'session', roles: ['COURIER'],
    handler: (c) => delivery.courierHistory(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/courier/parcels', tag: 'Smart lockers', summary: 'Register a parcel at a station and verify the recipient (no resident details are returned)', auth: 'session', roles: ['COURIER'],
    rateLimit: { limit: 120, windowSec: 3600, by: 'user' },
    body: z.object({
      stationId: zId,
      trackingNo: zTracking,
      size: z.enum(LOCKER_SIZES).optional(),
      dimensionsMm: z.tuple([zMm, zMm, zMm]).optional(),
      recipient: z.union([z.object({ memberCode: z.string().trim().min(6).max(12) }), z.object({ homeId: zId, name: zText(80, 2) })]),
    }).refine((b) => b.size || b.dimensionsMm, 'Choose a size or enter the dimensions.'),
    handler: (c) => delivery.registerParcel(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'GET', path: '/courier/parcels/:parcelId', tag: 'Smart lockers', summary: 'Where a delivery stands, with its door command', auth: 'session', roles: ['COURIER'],
    handler: async (c) => {
      await hardware.reconcile(c.db, c.now);
      return delivery.deliveryStatus(c.db, c.actor, c.params.parcelId!);
    },
  }),
  route({
    method: 'POST', path: '/courier/parcels/:parcelId/open', tag: 'Smart lockers', summary: "Open the household's own door (or say why it cannot be used, and which guardhouse can take the parcel)", auth: 'session', roles: ['COURIER'],
    rateLimit: { limit: 60, windowSec: 600, by: 'user' },
    body: z.object({ idempotencyKey: zKey }),
    handler: (c) => delivery.reserveAndOpen(c.db, c.actor, c.params.parcelId!, c.body.idempotencyKey, c.now),
  }),
  route({
    method: 'POST', path: '/courier/parcels/:parcelId/station', tag: 'Smart lockers', summary: 'Choose another station you may use', auth: 'session', roles: ['COURIER'],
    body: z.object({ stationId: zId }),
    handler: (c) => delivery.moveToStation(c.db, c.actor, c.params.parcelId!, c.body.stationId, c.now),
  }),
  route({
    method: 'POST', path: '/courier/parcels/:parcelId/counter', tag: 'Smart lockers', summary: 'Take the parcel to the guardhouse instead (only while it is open)', auth: 'session', roles: ['COURIER'],
    body: z.object({ locationId: zId }),
    handler: (c) => delivery.chooseCounter(c.db, c.actor, c.params.parcelId!, c.body.locationId, c.now),
  }),
  route({
    method: 'POST', path: '/courier/parcels/:parcelId/confirm', tag: 'Smart lockers', summary: 'Stations without sensors: confirm the parcel is in and the door is shut', auth: 'session', roles: ['COURIER'], body: emptyBody,
    handler: (c) => delivery.confirmDeposit(c.db, c.actor, c.params.parcelId!, c.now),
  }),
  route({
    method: 'POST', path: '/courier/parcels/:parcelId/problem', tag: 'Smart lockers', summary: "Say why the parcel could not go into the household's door (frees the door and shows where to take it)", auth: 'session', roles: ['COURIER'],
    rateLimit: { limit: 60, windowSec: 600, by: 'user' },
    body: z.object({ reason: z.enum(COURIER_PROBLEMS), note: z.string().trim().max(300).optional() }),
    handler: (c) => delivery.reportDeliveryProblem(c.db, c.actor, c.params.parcelId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/courier/parcels/:parcelId/fail', tag: 'Smart lockers', summary: 'Record that the delivery could not be made today (the parcel stays with the courier; the household is told)', auth: 'session', roles: ['COURIER'],
    body: z.object({ reason: zText(200, 3), problem: z.enum(DELIVERY_PROBLEMS).optional() }),
    handler: (c) => delivery.failDelivery(c.db, c.actor, c.params.parcelId!, c.body.reason, c.now, c.body.problem),
  }),

  // --- Residents ----------------------------------------------------------------------------
  route({
    method: 'GET', path: '/lockers/my-parcels', tag: 'Smart lockers', summary: "My home's locker parcels with their QR code and PIN, my locker door, the guardhouse and my late collections", auth: 'session', roles: ['RESIDENT'],
    handler: (c) => collection.myLockerParcels(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/lockers/parcels/:parcelId/open', tag: 'Smart lockers', summary: "Open my parcel's door from the app, at the station (its code from the QR poster)", auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 20, windowSec: 600, by: 'user' },
    body: z.object({ stationCode: z.string().trim().min(6).max(12), idempotencyKey: zKey }),
    handler: (c) => collection.openFromApp(c.db, c.actor, c.params.parcelId!, c.body.stationCode, c.body.idempotencyKey, c.now),
  }),
  route({
    method: 'POST', path: '/lockers/parcels/:parcelId/confirm', tag: 'Smart lockers', summary: 'Stations without sensors: confirm I have the parcel and the door is shut', auth: 'session', roles: ['RESIDENT'], body: emptyBody,
    handler: (c) => collection.confirmCollected(c.db, c.actor, c.params.parcelId!, c.now),
  }),
  route({
    method: 'POST', path: '/lockers/parcels/:parcelId/extend', tag: 'Smart lockers', summary: 'Ask for more time on a parcel with a deadline (doors belong to one home and have none)', auth: 'session', roles: ['RESIDENT'],
    body: z.object({ agreeFee: z.boolean().default(false) }),
    handler: (c) => collection.extendDeadline(c.db, c.actor, c.params.parcelId!, c.body.agreeFee, c.now),
  }),
  route({
    method: 'POST', path: '/lockers/parcels/:parcelId/new-code', tag: 'Smart lockers', summary: 'Replace my pickup PIN and QR code (the old one stops working at once)', auth: 'session', roles: ['RESIDENT'], body: emptyBody,
    rateLimit: { limit: 10, windowSec: 3600, by: 'user' },
    handler: (c) => collection.renewPickupCode(c.db, c.actor, c.params.parcelId!, c.now),
  }),
  route({
    method: 'POST', path: '/lockers/parcels/:parcelId/keypad-help', tag: 'Smart lockers', summary: "Ask staff to unlock my parcel's station keypad after it locked itself (once per lockout)", auth: 'session', roles: ['RESIDENT'], body: emptyBody,
    rateLimit: { limit: 10, windowSec: 3600, by: 'user' },
    handler: (c) => collection.askToUnlockKeypad(c.db, c.actor, c.params.parcelId!, c.now),
  }),
  route({
    method: 'POST', path: '/lockers/parcels/:parcelId/report', tag: 'Smart lockers', summary: 'Report a problem with a parcel from the lockers: not collected by us, damaged, wrong contents, not ours', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 10, windowSec: 3600, by: 'user' },
    body: z.object({ reason: z.enum(collection.PARCEL_REPORT_REASONS), note: z.string().trim().max(300).optional() }),
    handler: (c) => collection.reportParcel(c.db, c.actor, c.params.parcelId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/lockers/parcels/:parcelId/simulate-close', tag: 'Smart lockers', summary: 'Simulated stations only: close the door you opened, with or without the parcel inside', auth: 'session', roles: ['RESIDENT', 'COURIER', ...STAFF],
    body: z.object({ itemPresent: z.boolean() }),
    handler: (c) => admin.simulateClose(c.db, c.actor, c.params.parcelId!, c.body.itemPresent, c.now),
  }),

  // --- Property management ------------------------------------------------------------------
  route({
    method: 'GET', path: '/admin/lockers', tag: 'Smart lockers', summary: 'Every station by compartment state, overflow storage, the 14-day trend and alerts', auth: 'session', roles: STAFF,
    handler: async (c) => {
      await hardware.reconcile(c.db, c.now);
      return admin.lockerOverview(c.db, c.actor, c.now);
    },
  }),
  route({
    method: 'GET', path: '/admin/lockers/forecast', tag: 'Smart lockers', summary: "Tomorrow's expected demand per station, with the method and recommendations", auth: 'session', roles: STAFF,
    handler: (c) => admin.lockerForecast(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/admin/lockers/stations', tag: 'Smart lockers', summary: 'Add a station and its compartments (a gateway station’s device secret is shown once)', auth: 'session', roles: ADMINS,
    body: z.object({
      name: zText(80, 2), location: zText(160, 3),
      layout: z.object({ S: z.number().int().min(0).max(200).optional(), M: z.number().int().min(0).max(200).optional(), L: z.number().int().min(0).max(200).optional(), XL: z.number().int().min(0).max(200).optional() }),
      adapter: z.enum(['SIMULATED', 'HTTP_GATEWAY']), gatewayUrl: z.url().optional(),
      hasDoorSensor: z.boolean().default(true), hasPresenceSensor: z.boolean().default(true),
      lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(),
      precincts: z.array(zText(80, 2)).max(30).optional(),
    }),
    handler: (c) => admin.createStation(c.db, c.actor, c.body),
  }),
  route({
    method: 'GET', path: '/admin/lockers/stations/:stationId/doors', tag: 'Smart lockers', summary: "A station's doors and the home each belongs to", auth: 'session', roles: STAFF,
    handler: (c) => admin.stationDoors(c.db, c.actor, c.params.stationId!),
  }),
  route({
    method: 'POST', path: '/admin/lockers/compartments/:compartmentId/release', tag: 'Smart lockers', summary: 'Free an empty door when its household moves out (admins)', auth: 'session', roles: ADMINS, body: emptyBody,
    handler: (c) => admin.releaseDoor(c.db, c.actor, c.params.compartmentId!, c.now),
  }),
  route({
    method: 'POST', path: '/admin/lockers/stations/:stationId/status', tag: 'Smart lockers', summary: 'Put a station online, offline or in maintenance', auth: 'session', roles: STAFF,
    body: z.object({ status: z.enum(['ONLINE', 'OFFLINE', 'MAINTENANCE']) }),
    handler: (c) => admin.setStationStatus(c.db, c.actor, c.params.stationId!, c.body.status),
  }),
  route({
    method: 'POST', path: '/admin/lockers/stations/:stationId/keypad-unlock', tag: 'Smart lockers', summary: 'Unlock a station keypad that locked itself after too many wrong pickup codes', auth: 'session', roles: STAFF, body: emptyBody,
    handler: (c) => admin.unlockStationKeypad(c.db, c.actor, c.params.stationId!, c.now),
  }),
  route({
    method: 'POST', path: '/admin/lockers/stations/:stationId/secret', tag: 'Smart lockers', summary: 'Issue a new device secret (the old one stops working)', auth: 'session', roles: ADMINS, body: emptyBody,
    handler: (c) => admin.rotateDeviceSecret(c.db, c.actor, c.params.stationId!),
  }),
  route({
    method: 'GET', path: '/admin/lockers/stations/:stationId/commands', tag: 'Smart lockers', summary: "A station's recent door commands and device messages", auth: 'session', roles: STAFF,
    handler: (c) => admin.stationCommands(c.db, c.actor, c.params.stationId!),
  }),
  route({
    method: 'POST', path: '/admin/lockers/compartments/:compartmentId', tag: 'Smart lockers', summary: 'Disable, enable or clear the fault on a compartment', auth: 'session', roles: STAFF,
    body: z.object({ action: z.enum(['DISABLE', 'ENABLE', 'CLEAR_FAULT']) }),
    handler: (c) => admin.setCompartment(c.db, c.actor, c.params.compartmentId!, c.body.action, c.now),
  }),
  route({
    method: 'POST', path: '/admin/lockers/compartments/:compartmentId/unlock', tag: 'Smart lockers', summary: 'Open an empty compartment for maintenance (admins; logged)', auth: 'session', roles: ADMINS,
    body: z.object({ reason: zText(200, 3), idempotencyKey: zKey }),
    handler: (c) => admin.maintenanceUnlock(c.db, c.actor, c.params.compartmentId!, c.body.reason, c.body.idempotencyKey, c.now),
  }),
  route({
    method: 'GET', path: '/admin/lockers/parcels', tag: 'Smart lockers', summary: 'Locker parcels by state, station or tracking number', auth: 'session', roles: STAFF,
    query: z.object({
      // One state, or several separated by commas (the console filters by group).
      state: z.string().max(400).transform((s) => s.split(',').filter(Boolean)).pipe(z.array(z.enum(PARCEL_STATES)).max(PARCEL_STATES.length)).optional(),
      stationId: zId.optional(), q: z.string().max(40).optional() }),
    handler: (c) => admin.listLockerParcels(c.db, c.actor, c.query),
  }),
  route({
    method: 'GET', path: '/admin/lockers/parcels/:parcelId', tag: 'Smart lockers', summary: "One parcel's state history, custody chain and door commands", auth: 'session', roles: STAFF,
    handler: (c) => admin.lockerParcelDetail(c.db, c.actor, c.params.parcelId!),
  }),
  route({
    method: 'POST', path: '/admin/lockers/parcels/:parcelId/receive', tag: 'Smart lockers', summary: 'Receive a parcel a courier brought to the counter because the lockers were full', auth: 'session', roles: COUNTER, body: emptyBody,
    handler: (c) => delivery.receiveAtCounter(c.db, c.actor, c.params.parcelId!, c.now),
  }),
  route({
    method: 'POST', path: '/admin/lockers/parcels/:parcelId/return', tag: 'Smart lockers', summary: 'Mark a parcel to go back to the courier, when the household or the courier asks', auth: 'session', roles: COUNTER,
    body: z.object({ reason: zText(300, 3) }),
    handler: (c) => overflow.startReturn(c.db, c.actor, c.params.parcelId!, c.body.reason, c.now),
  }),
  route({
    method: 'POST', path: '/admin/lockers/parcels/:parcelId/keep', tag: 'Smart lockers', summary: 'Keep a parcel at the guardhouse instead of sending it back', auth: 'session', roles: COUNTER, body: emptyBody,
    handler: (c) => overflow.keepAtCounter(c.db, c.actor, c.params.parcelId!, c.now),
  }),
  route({
    method: 'GET', path: '/admin/lockers/parcels/:parcelId/notes', tag: 'Smart lockers', summary: "Staff and guards' notes on a parcel", auth: 'session', roles: COUNTER,
    handler: (c) => overflow.parcelNotes(c.db, c.actor, c.params.parcelId!),
  }),
  route({
    method: 'POST', path: '/admin/lockers/parcels/:parcelId/notes', tag: 'Smart lockers', summary: 'Add a note to a parcel, for example after calling the household', auth: 'session', roles: COUNTER,
    rateLimit: { limit: 60, windowSec: 600, by: 'user' },
    body: z.object({ body: zText(500, 1) }),
    handler: (c) => overflow.addParcelNote(c.db, c.actor, c.params.parcelId!, c.body.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/lockers/parcels/:parcelId/returned', tag: 'Smart lockers', summary: 'The courier has taken the parcel back', auth: 'session', roles: COUNTER, body: emptyBody,
    handler: (c) => overflow.completeReturn(c.db, c.actor, c.params.parcelId!, c.now),
  }),
  route({
    method: 'POST', path: '/admin/lockers/parcels/:parcelId/resolve', tag: 'Smart lockers', summary: 'Settle a parcel held as an exception', auth: 'session', roles: ADMINS,
    body: z.object({ outcome: z.enum(['RELOCATED_TO_STORAGE', 'RETURN_PENDING', 'COLLECTED']), note: zText(300, 3), overflowId: zId.optional() }),
    handler: (c) => overflow.resolveException(c.db, c.actor, c.params.parcelId!, c.body.outcome, c.body.note, c.body.overflowId, c.now),
  }),
  route({
    method: 'GET', path: '/admin/lockers/overflow', tag: 'Smart lockers', summary: 'Guardhouses, how full each is, and whether each is open now', auth: 'session', roles: COUNTER,
    handler: (c) => overflow.listOverflow(c.db, c.actor, c.now),
  }),
  route({
    method: 'GET', path: '/admin/lockers/storage/parcels', tag: 'Smart lockers', summary: 'Parcels at the counters: days waited, overdue, calls due and notes', auth: 'session', roles: COUNTER,
    handler: (c) => overflow.listStoredParcels(c.db, c.actor, c.now),
  }),
  route({
    method: 'GET', path: '/admin/lockers/storage/deliveries', tag: 'Smart lockers', summary: 'Parcels a courier is bringing to a counter, and why', auth: 'session', roles: COUNTER,
    handler: (c) => overflow.listCounterDeliveries(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/admin/lockers/overflow', tag: 'Smart lockers', summary: 'Add a guardhouse with its opening hours', auth: 'session', roles: ADMINS,
    body: z.object({
      name: zText(80, 2), kind: z.enum(['COUNTER', 'PARCEL_ROOM']), location: zText(160, 3), instructions: zText(300, 3),
      openFromHour: zHour.default(8), openToHour: zHour.default(22),
      capacity: z.number().int().min(1).max(5000).default(100), acceptsDeliveries: z.boolean().default(true),
    }),
    handler: (c) => overflow.createOverflow(c.db, c.actor, c.body),
  }),
  route({
    method: 'PATCH', path: '/admin/lockers/overflow/:locationId', tag: 'Smart lockers', summary: "Change a guardhouse's opening hours, room or instructions", auth: 'session', roles: ADMINS,
    body: z.object({ openFromHour: zHour, openToHour: zHour, capacity: z.number().int().min(1).max(5000), instructions: zText(300, 3) }),
    handler: (c) => overflow.updateOverflow(c.db, c.actor, c.params.locationId!, c.body),
  }),
  route({
    method: 'POST', path: '/admin/lockers/overflow/:locationId/active', tag: 'Smart lockers', summary: 'Stop or resume taking parcels at a guardhouse (not its daily hours)', auth: 'session', roles: ADMINS,
    body: z.object({ active: z.boolean() }),
    handler: (c) => overflow.setOverflowActive(c.db, c.actor, c.params.locationId!, c.body.active),
  }),
  route({
    method: 'POST', path: '/admin/lockers/overflow/:locationId/check', tag: 'Smart lockers', summary: 'Check the pickup code a resident shows at the counter', auth: 'session', roles: COUNTER,
    rateLimit: { limit: 60, windowSec: 600, by: 'user' },
    body: z.object({ credential: zCredential }),
    handler: (c) => overflow.checkCounterCode(c.db, c.actor, c.params.locationId!, c.body.credential, c.now),
  }),
  route({
    method: 'POST', path: '/admin/lockers/overflow/:locationId/handover', tag: 'Smart lockers', summary: 'Hand the parcel over after checking the code and ID', auth: 'session', roles: COUNTER,
    rateLimit: { limit: 60, windowSec: 600, by: 'user' },
    body: z.object({ credential: zCredential, idChecked: z.boolean() }),
    handler: (c) => overflow.handOverAtCounter(c.db, c.actor, c.params.locationId!, c.body.credential, c.body.idChecked, c.now),
  }),
  route({
    method: 'GET', path: '/admin/lockers/couriers', tag: 'Smart lockers', summary: 'Courier applications and accounts with their stations', auth: 'session', roles: STAFF,
    handler: (c) => couriers.listCouriers(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/admin/lockers/couriers/:userId/approve', tag: 'Smart lockers', summary: 'Approve a courier for the chosen stations', auth: 'session', roles: ADMINS,
    body: z.object({ stationIds: z.array(zId).min(1).max(50) }),
    handler: (c) => couriers.approveCourier(c.db, c.actor, c.params.userId!, c.body.stationIds, c.now),
  }),
  route({
    method: 'POST', path: '/admin/lockers/couriers/:userId/revoke', tag: 'Smart lockers', summary: "Withdraw a courier's access at once", auth: 'session', roles: ADMINS,
    body: z.object({ note: z.string().trim().max(200).optional() }),
    handler: (c) => couriers.revokeCourier(c.db, c.actor, c.params.userId!, c.body.note, c.now),
  }),
  route({
    method: 'GET', path: '/admin/lockers/companies', tag: 'Smart lockers', summary: 'Courier companies, including paused ones', auth: 'session', roles: STAFF,
    handler: (c) => couriers.listCompanies(c.db, true),
  }),
  route({
    method: 'POST', path: '/admin/lockers/companies', tag: 'Smart lockers', summary: 'Authorise a courier company', auth: 'session', roles: ADMINS,
    body: z.object({ name: zText(60, 2) }),
    handler: (c) => couriers.createCompany(c.db, c.actor, c.body.name),
  }),
  route({
    method: 'POST', path: '/admin/lockers/companies/:companyId/active', tag: 'Smart lockers', summary: 'Pause or resume a courier company', auth: 'session', roles: ADMINS,
    body: z.object({ active: z.boolean() }),
    handler: (c) => couriers.setCompanyActive(c.db, c.actor, c.params.companyId!, c.body.active),
  }),
  route({
    method: 'GET', path: '/admin/lockers/incidents', tag: 'Smart lockers', summary: 'Security incidents: replayed barcodes, forced doors, refused commands, suspicious sign-ins', auth: 'session', roles: STAFF,
    query: z.object({ status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'ALL']).optional() }),
    handler: (c) => incidents.listIncidents(c.db, c.actor, c.query),
  }),
  route({
    method: 'POST', path: '/admin/lockers/incidents', tag: 'Smart lockers', summary: 'Report something staff saw at a locker', auth: 'session', roles: STAFF,
    body: z.object({ summary: zText(300, 5), stationId: zId.optional(), severity: z.enum(['LOW', 'MEDIUM', 'HIGH']) }),
    handler: (c) => incidents.reportIncident(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/lockers/incidents/:incidentId', tag: 'Smart lockers', summary: 'Acknowledge or resolve an incident', auth: 'session', roles: STAFF,
    body: z.object({ status: z.enum(['ACKNOWLEDGED', 'RESOLVED']), resolution: z.string().trim().max(300).optional() }),
    handler: (c) => incidents.updateIncident(c.db, c.actor, c.params.incidentId!, c.body, c.now),
  }),
  route({
    method: 'GET', path: '/admin/lockers/exceptions', tag: 'Smart lockers', summary: 'Requests to open an occupied door outside the normal flow', auth: 'session', roles: STAFF,
    handler: (c) => exceptions.listExceptions(c.db, c.actor),
  }),
  route({
    method: 'GET', path: '/admin/lockers/access-sessions', tag: 'Smart lockers', summary: 'Controlled multi-parcel access sessions', auth: 'session', roles: STAFF,
    handler: (c) => accessSessions.listAccessSessions(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/admin/lockers/access-sessions', tag: 'Smart lockers', summary: 'Request one controlled session for several occupied doors at one station', auth: 'session', roles: STAFF,
    body: z.object({ stationId: zId, parcelIds: z.array(zId).min(2).max(50), reason: zText(300, 5) }),
    handler: (c) => accessSessions.requestAccessSession(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/lockers/access-sessions/:sessionId/decision', tag: 'Smart lockers', summary: 'A second admin approves or rejects a controlled access session', auth: 'session', roles: ADMINS,
    body: z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional() }),
    handler: (c) => accessSessions.decideAccessSession(c.db, c.actor, c.params.sessionId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/lockers/access-sessions/:sessionId/items/:itemId/open', tag: 'Smart lockers', summary: 'Open the next approved session door', auth: 'session', roles: STAFF,
    body: z.object({ idempotencyKey: zKey }),
    handler: (c) => accessSessions.openSessionItem(c.db, c.actor, c.params.sessionId!, c.params.itemId!, c.body.idempotencyKey, c.now),
  }),
  route({
    method: 'POST', path: '/admin/lockers/access-sessions/:sessionId/items/:itemId/complete', tag: 'Smart lockers', summary: 'Scan and confirm the parcel removed during a session', auth: 'session', roles: STAFF,
    body: z.object({ trackingNo: zTracking }),
    handler: (c) => accessSessions.completeSessionItem(c.db, c.actor, c.params.sessionId!, c.params.itemId!, c.body.trackingNo, c.now),
  }),
  route({
    method: 'POST', path: '/admin/lockers/exceptions/:requestId/decision', tag: 'Smart lockers', summary: 'A second admin approves (the door opens) or rejects a request', auth: 'session', roles: ADMINS,
    body: z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional() }),
    handler: (c) => exceptions.decideException(c.db, c.actor, c.params.requestId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/lockers/parcels/:parcelId/exception', tag: 'Smart lockers', summary: 'Ask to open an occupied door (wrong door, wrong household, damage, suspected theft, fault)', auth: 'session', roles: STAFF,
    body: z.object({ kind: z.enum(exceptions.EXCEPTION_KINDS), reason: zText(300, 5) }),
    handler: (c) => exceptions.requestException(c.db, c.actor, c.params.parcelId!, c.body, c.now),
  }),
  route({
    method: 'GET', path: '/admin/lockers/policy', tag: 'Smart lockers', summary: "The township's reminder timings for doors and the guardhouse", auth: 'session', roles: STAFF,
    handler: (c) => overflow.getTownshipPolicy(c.db, c.actor),
  }),
  route({
    method: 'PATCH', path: '/admin/lockers/policy', tag: 'Smart lockers', summary: 'Change the reminder timings (no fees are ever charged)', auth: 'session', roles: ADMINS,
    body: zPolicy,
    handler: (c) => overflow.saveTownshipPolicy(c.db, c.actor, c.body, c.now),
  }),

  // --- The simulator ------------------------------------------------------------------------
  route({
    method: 'GET', path: '/admin/lockers/simulator/:stationId', tag: 'Smart lockers', summary: "A simulated station's compartments, doors and sensors", auth: 'session', roles: STAFF,
    handler: (c) => admin.simulatorView(c.db, c.actor, c.params.stationId!),
  }),
  route({
    method: 'POST', path: '/admin/lockers/simulator/:stationId', tag: 'Smart lockers', summary: 'Simulated stations only: a door, sensor, fault, connectivity or keypad event', auth: 'session', roles: STAFF,
    rateLimit: { limit: 300, windowSec: 600, by: 'user' },
    body: z.discriminatedUnion('type', [
      z.object({ type: z.literal('DOOR'), compartmentId: zId, door: z.enum(['OPEN', 'CLOSED']), itemPresent: z.boolean() }),
      z.object({ type: z.literal('FAIL_NEXT'), compartmentId: zId, on: z.boolean() }),
      z.object({ type: z.literal('FAULT'), compartmentId: zId, on: z.boolean() }),
      z.object({ type: z.literal('STATION'), status: z.enum(['ONLINE', 'OFFLINE']) }),
      z.object({ type: z.literal('KEYPAD'), credential: zCredential }),
      z.object({ type: z.literal('REPLAY'), commandId: zId }),
    ]),
    handler: (c) => admin.simulatorEvent(c.db, c.actor, c.params.stationId!, c.body, c.now),
  }),

  // --- Real stations (signed device messages) -------------------------------------------------
  route({
    method: 'POST', path: '/devices/lockers/events', tag: 'Smart lockers', summary: 'Station gateway: command acknowledgements, door events, heartbeats and keypad pickups (HMAC-signed)', auth: 'machine',
    rateLimit: { limit: 600, windowSec: 60, by: 'ip' },
    body: z.object({
      stationId: zId, eventId: z.string().trim().min(8).max(80), type: z.enum(['ACK', 'DOOR', 'HEARTBEAT', 'PICKUP']),
      commandId: zId.optional(), ok: z.boolean().optional(), error: z.string().max(200).optional(), compartment: z.string().max(12).optional(),
      door: z.enum(['OPEN', 'CLOSED']).optional(), itemPresent: z.boolean().nullable().optional(), credential: zCredential.optional(),
      ts: z.iso.datetime(), signature: z.string().regex(/^[0-9a-fA-F]{64}$/, 'An HMAC-SHA256 signature in hex.'),
    }),
    handler: async (c) => {
      const { signature, ...message } = c.body;
      const station = await hardware.verifyDevice(c.db, message, signature.toLowerCase(), c.now);
      switch (message.type) {
        case 'HEARTBEAT':
          return hardware.heartbeat(c.db, station, message.eventId, c.now);
        case 'ACK':
          if (!message.commandId || message.ok === undefined) throw badRequest('An acknowledgement needs commandId and ok.');
          return hardware.handleAck(c.db, station.id, message.commandId, message.ok, message.error ?? null, c.now, 'DEVICE', message.eventId);
        case 'DOOR': {
          if (!message.compartment || !message.door) throw badRequest('A door event needs compartment and door.');
          const comp = await c.db.query<{ id: string }>('SELECT id FROM locker_compartments WHERE station_id = $1 AND label = $2', [station.id, message.compartment]);
          if (!comp[0]) throw badRequest('Unknown compartment.');
          return hardware.handleDoor(c.db, { stationId: station.id, compartmentId: comp[0].id, door: message.door, itemPresent: message.itemPresent ?? null, source: 'DEVICE', eventId: message.eventId }, c.now);
        }
        case 'PICKUP':
          if (!message.credential) throw badRequest('A pickup needs the credential read at the keypad.');
          return collection.pickupAtStation(c.db, station.id, message.credential, DEVICE, `device-${station.id}-${message.eventId}`, c.now);
      }
    },
  }),
];
