import { translateMessage, type Lang } from '@/lib/i18n-core';
import { counterHoursText } from '@/shared/lockers';
import { one, type Queryable } from '../../db/client';
import { appLink, queueEmails } from './outbox';

/**
 * The parcel emails, in the design every SimeTown email shares (docs/EMAIL_DESIGN.md). They never carry a pickup
 * PIN, collection code or QR code: the button opens the app, where the code is shown. Each is queued with the
 * in-app notification for the same event, so it exists only if the event happened.
 *
 * The guardhouse is one place with one set of rules: a locker parcel that could not go into the home's door and a
 * parcel a courier left straight with the guard get the same arrival email and the same weekly reminder.
 */

const TZ = 'Asia/Kuala_Lumpur';
/** "Mon, 20 Oct 2026, 10:02 am" in English, the same shape in Malay. */
const when = (date: Date, lang: Lang) =>
  date.toLocaleString(lang === 'ms' ? 'ms-MY' : 'en-MY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ });
const day = (date: Date, lang: Lang) => date.toLocaleDateString(lang === 'ms' ? 'ms-MY' : 'en-MY', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
const lockerLink = (parcelId: string) => appLink(`/app/parcels?tab=lockers&parcel=${parcelId}`);
const guardhouseLink = (parcelId: string) => appLink(`/app/parcels?tab=guardhouse&parcel=${parcelId}`);
const FOOTER = 'You received this because a parcel arrived for your home. You can turn parcel emails off in Account.';

/** The household's guardhouse, with its opening hours, for shelf parcels (which do not record which guardhouse). */
async function guardhouseOf(q: Queryable, parcelId: string) {
  return one<{ name: string; location: string; open_from_hour: number; open_to_hour: number; instructions: string }>(
    q,
    `SELECT o.name, o.location, o.open_from_hour, o.open_to_hour, o.instructions FROM parcels p
       JOIN overflow_locations o ON o.township_id = p.township_id AND o.active WHERE p.id = $1 ORDER BY o.name LIMIT 1`,
    [parcelId],
  );
}

/** A parcel is in the home's own door. */
export function emailParcelInLocker(q: Queryable, people: string[], p: { id: string; company: string; station: string; door: string; trackingNo: string; at: Date }) {
  return queueEmails(q, people, 'LOCKER_READY', (lang) => ({
    subject: 'Your parcel is ready in your locker',
    preheader: `Your parcel from ${p.company} is in your locker door ${p.door}.`,
    bandLabel: 'Parcel lockers',
    status: { tone: 'success', label: 'Ready to collect' },
    heading: 'Your parcel is ready in your locker',
    intro: `your parcel from ${p.company} has been delivered to your private locker door.`,
    facts: [
      { label: 'Locker', value: p.station },
      { label: 'Your door', value: p.door },
      { label: 'Tracking no.', value: p.trackingNo },
      { label: 'Delivered', value: when(p.at, lang) },
    ],
    action: { label: 'Get my pickup code', url: lockerLink(p.id) },
    note: 'For your security, pickup codes are shown only in the SimeTown app. Your locker is open 24 hours.',
    footer: FOOTER,
  }), `email-locker-ready:${p.id}`, {}, p.at);
}

/** A smart locker parcel the courier could not put in the door is with the guard at the guardhouse. */
export function emailParcelAtCounter(
  q: Queryable, people: string[],
  p: { id: string; company: string; counter: string; location: string; openFrom: number; openTo: number; instructions: string; reason: string | null; overdueAfterDays: number; at: Date },
) {
  return queueEmails(q, people, 'COUNTER_READY', (lang) => {
    const t = (text: string) => translateMessage(lang, text);
    return {
      subject: 'Your parcel is at the guardhouse',
      preheader: `Your parcel from ${p.company} is waiting for you at ${p.counter}.`,
      bandLabel: 'Guardhouse',
      status: { tone: 'info', label: 'At the guardhouse' },
      heading: 'Your parcel is waiting at the guardhouse',
      intro: `your parcel from ${p.company} could not go into your locker door, so the guard is keeping it at ${p.counter}.`,
      facts: [
        { label: 'Collect at', value: `${p.counter} · ${p.location}` },
        { label: 'Opening hours', value: t(counterHoursText(p.openFrom, p.openTo)) },
        ...(p.reason ? [{ label: 'Reason', value: t(p.reason) }] : []),
        { label: 'Please bring', value: t(p.instructions) },
      ],
      action: { label: 'Get my pickup code', url: guardhouseLink(p.id) },
      note: `It stays at the guardhouse until you collect it. After ${p.overdueAfterDays} days it is marked overdue and you are reminded once a week.`,
      footer: FOOTER,
    };
  }, `email-counter-ready:${p.id}`, {}, p.at);
}

/** The weekly reminder for a smart locker parcel still at the guardhouse. */
export function emailCounterReminder(
  q: Queryable, people: string[],
  p: { id: string; trackingNo: string; counter: string | null; location: string | null; openFrom: number | null; openTo: number | null; readyAt: Date; days: number; now: Date },
) {
  return queueEmails(q, people, 'COUNTER_REMINDER', (lang) => {
    const t = (text: string) => translateMessage(lang, text);
    return {
      subject: `Reminder: your parcel has been waiting for ${p.days} days`,
      preheader: 'Please collect your parcel from the guardhouse.',
      bandLabel: 'Guardhouse',
      status: { tone: 'warning', label: 'Overdue' },
      heading: 'Your parcel has not been collected yet',
      intro: `your parcel has been waiting at the guardhouse since ${day(p.readyAt, lang)}. Please collect it when you can.`,
      highlight: { value: String(p.days), label: 'days uncollected' },
      facts: [
        ...(p.counter ? [{ label: 'Collect at', value: `${p.counter}${p.location ? ` · ${p.location}` : ''}` }] : []),
        ...(p.openFrom != null && p.openTo != null ? [{ label: 'Opening hours', value: t(counterHoursText(p.openFrom, p.openTo)) }] : []),
        { label: 'Tracking no.', value: p.trackingNo },
      ],
      action: { label: 'View my parcel', url: guardhouseLink(p.id) },
      note: 'We send one reminder a week until the parcel is collected. No charges apply.',
      footer: FOOTER,
    };
  }, `email-counter-reminder:${p.id}:${p.now.toISOString().slice(0, 10)}`, {}, p.now);
}

/** A courier left a parcel straight with the guard. */
export async function emailShelfArrival(q: Queryable, people: string[], p: { id: string; courier: string; shelf: string; overdueAfterDays: number; at: Date }) {
  const place = await guardhouseOf(q, p.id);
  return queueEmails(q, people, 'COUNTER_READY', (lang) => {
    const t = (text: string) => translateMessage(lang, text);
    return {
      subject: `Your parcel from ${p.courier} is at the guardhouse`,
      preheader: 'Show your collection code at the guardhouse to collect it.',
      bandLabel: 'Guardhouse',
      status: { tone: 'info', label: 'At the guardhouse' },
      heading: 'Your parcel is waiting at the guardhouse',
      intro: `the guard has received a parcel from ${p.courier} for your home.`,
      facts: [
        ...(place ? [{ label: 'Collect at', value: `${place.name} · ${place.location}` }] : []),
        { label: 'Shelf', value: p.shelf },
        ...(place ? [{ label: 'Opening hours', value: t(counterHoursText(place.open_from_hour, place.open_to_hour)) }] : []),
        { label: 'Arrived', value: when(p.at, lang) },
      ],
      action: { label: 'Get my collection code', url: guardhouseLink(p.id) },
      note: `For your security, collection codes are shown only in the SimeTown app. It stays at the guardhouse until you collect it; after ${p.overdueAfterDays} days it is marked overdue.`,
      footer: FOOTER,
    };
  }, `email-shelf-ready:${p.id}`, {}, p.at);
}

/** The weekly reminder for a shelf parcel still at the guardhouse. */
export async function emailShelfReminder(q: Queryable, people: string[], p: { id: string; courier: string; shelf: string; trackingNo: string | null; loggedAt: Date; days: number; now: Date }) {
  const place = await guardhouseOf(q, p.id);
  return queueEmails(q, people, 'COUNTER_REMINDER', (lang) => {
    const t = (text: string) => translateMessage(lang, text);
    return {
      subject: `Reminder: your parcel has been waiting for ${p.days} days`,
      preheader: 'Please collect your parcel from the guardhouse.',
      bandLabel: 'Guardhouse',
      status: { tone: 'warning', label: 'Overdue' },
      heading: 'Your parcel has not been collected yet',
      intro: `your parcel from ${p.courier} has been waiting at the guardhouse since ${day(p.loggedAt, lang)}. Please collect it when you can.`,
      highlight: { value: String(p.days), label: 'days uncollected' },
      facts: [
        ...(place ? [{ label: 'Collect at', value: `${place.name} · ${place.location}` }] : []),
        { label: 'Shelf', value: p.shelf },
        ...(place ? [{ label: 'Opening hours', value: t(counterHoursText(place.open_from_hour, place.open_to_hour)) }] : []),
        ...(p.trackingNo ? [{ label: 'Tracking no.', value: p.trackingNo }] : []),
      ],
      action: { label: 'View my parcel', url: guardhouseLink(p.id) },
      note: 'We send one reminder a week until the parcel is collected. No charges apply.',
      footer: FOOTER,
    };
  }, `email-shelf-reminder:${p.id}:${p.now.toISOString().slice(0, 10)}`, {}, p.now);
}

/** A door opened without a code: always sent, at any hour. */
export function emailDoorForced(q: Queryable, people: string[], p: { door: string; station: string; at: Date; eventId: string }) {
  return queueEmails(q, people, 'DOOR_FORCED', (lang) => ({
    subject: 'Security alert: your locker door was opened without a code',
    preheader: 'The guard on duty has been told and is checking the locker.',
    band: 'alert',
    bandLabel: 'Security alert',
    status: { tone: 'alert', label: 'Security alert' },
    heading: 'Your locker door was opened without a code',
    intro: `door ${p.door} at ${p.station} was opened without a valid code. The guard on duty has been told and is checking the locker.`,
    facts: [
      { label: 'Locker', value: `${p.station} · ${translateMessage(lang, `door ${p.door}`)}` },
      { label: 'Time', value: when(p.at, lang) },
    ],
    action: { label: 'View my parcels', url: appLink('/app/parcels?tab=lockers') },
    note: 'If you or someone in your home opened it, no action is needed.',
    footer: 'Security alerts are always sent, at any hour.',
  }), `email-door-forced:${p.eventId}`, { always: true }, p.at);
}
