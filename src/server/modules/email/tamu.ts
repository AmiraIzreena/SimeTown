import { translateMessage, type Lang } from '@/lib/i18n-core';
import type { Queryable } from '../../db/client';
import { describeDetails, type StoredDetails } from '../tamu/visitor-data';
import { appLink, queueEmails, queueEmailTo } from './outbox';

/**
 * The Tamu emails to the household, in the design every SimeTown email shares (docs/EMAIL_DESIGN.md). They say who
 * came, how and why, but never the visitor's identity number or the home's address: the app shows the rest. Each is
 * queued with the in-app notification for the same event, so it exists only if the event happened.
 *
 * The one email to a visitor, their pass, is sent only when the resident gives the visitor's address. It carries the
 * pass link, because the visitor has no account: the link shows the QR code, and the
 * guard still checks the visitor's identity card at the gate. No QR code, code or identity number is in the email.
 */

const TZ = 'Asia/Kuala_Lumpur';
const when = (date: Date, lang: Lang) =>
  date.toLocaleString(lang === 'ms' ? 'ms-MY' : 'en-MY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ });
const FOOTER = 'You received this because a visitor came to your home. You can turn visitor emails off in Account.';
const NOTE = 'For your visitor’s privacy, identity numbers are never sent by email. Tamu shows the last 4 characters.';

interface Visit {
  entryId: string;
  visitorName: string;
  details: StoredDetails;
  gate: string | null;
  at: Date;
}

function facts(v: Visit, lang: Lang, identity: string) {
  const t = (text: string) => translateMessage(lang, text);
  const d = describeDetails(v.details);
  return [
    { label: 'Visitor', value: v.visitorName },
    ...(d.citizenship ? [{ label: 'Citizenship', value: t(d.citizenship) }] : []),
    { label: 'Identity', value: t(identity) },
    ...(d.transport ? [{ label: 'Travelling by', value: v.details.vehicle_no ? `${t(d.transport)} · ${v.details.vehicle_no}` : t(d.transport) }] : []),
    ...(d.reason ? [{ label: 'Reason', value: d.reasonIsOther ? d.reason : t(d.reason) }] : []),
    { label: 'Arrived', value: when(v.at, lang) },
    ...(v.gate ? [{ label: 'Gate', value: v.gate }] : []),
  ];
}

/** A pass was scanned at the gate: the resident who made it is told who came in. */
export function emailVisitorArrived(q: Queryable, people: string[], v: Visit) {
  return queueEmails(q, people, 'VISITOR_ARRIVED', (lang) => ({
    subject: 'Your visitor has arrived',
    preheader: `${v.visitorName} was let in at the main gate.`,
    bandLabel: 'Tamu',
    status: { tone: 'success', label: 'Arrived' },
    heading: 'Your visitor has arrived',
    intro: `${v.visitorName} was let in at the main gate with the pass you sent.`,
    facts: facts(v, lang, 'Checked at the gate'),
    action: { label: 'Open Tamu', url: appLink('/app/tamu') },
    note: NOTE,
    footer: FOOTER,
  }), `email-visitor-arrived:${v.entryId}`, { preference: 'visitor' }, v.at);
}

/** Someone came without a pass: everyone in the home is asked whether they expect them. */
export function emailVisitorAtGate(q: Queryable, people: string[], v: Visit) {
  return queueEmails(q, people, 'VISITOR_AT_GATE', (lang) => ({
    subject: 'A visitor is at the main gate for your home',
    preheader: `${v.visitorName} is at the main gate. Are you expecting them?`,
    bandLabel: 'Tamu',
    status: { tone: 'warning', label: 'Waiting for your answer' },
    heading: 'Are you expecting this visitor?',
    intro: `the guard has recorded ${v.visitorName} at the main gate, asking for your home. Please answer in SimeTown: Expected, Not expected or Call me.`,
    facts: facts(v, lang, 'Recorded at the gate'),
    action: { label: 'Answer in Tamu', url: appLink('/app/tamu') },
    note: '“Not expected” tells the guard. It never blocks lawful access on a public road.',
    footer: FOOTER,
  }), `email-visitor-at-gate:${v.entryId}`, { preference: 'visitor' }, v.at);
}

/** The resident gave their visitor's email: SimeTown sends the pass link, in the resident's language. */
export function emailVisitorPass(
  q: Queryable,
  p: { passId: string; token: string; address: string; lang: Lang; visitorName: string; township: string; street: string; gate: string | null; validFrom: Date; validUntil: Date; now: Date },
) {
  return queueEmailTo(q, p.address, p.lang, 'VISITOR_PASS', (lang) => ({
    subject: `Your visitor pass for ${p.township}`,
    preheader: 'Open your pass before you arrive and show its QR code at the main gate.',
    bandLabel: 'Tamu',
    status: { tone: 'info', label: 'Visitor pass' },
    heading: 'Your visitor pass is ready',
    intro: `you have been invited to ${p.township}. Open your pass before you arrive and show its QR code to the guard at the main gate.`,
    facts: [
      { label: 'Visitor', value: p.visitorName },
      { label: 'Valid', value: `${when(p.validFrom, lang)} – ${when(p.validUntil, lang)}` },
      { label: 'Going to', value: p.gate ? `${p.street} · ${p.gate}` : p.street },
    ],
    action: { label: 'Open my pass', url: appLink(`/pass/${p.token}`) },
    note: 'Bring your identity card: the guard checks it and hands it straight back. If your host asked, add your details on the pass page before you come. This link is your pass, so please do not forward this email.',
    footer: 'You received this because a SimeTown resident invited you. Your email address is used only to send this pass.',
  }), `email-visitor-pass:${p.passId}:${p.token.slice(0, 12)}`, p.now);
}

