import fs from 'node:fs';
import path from 'node:path';
import type { Lang } from '@/lib/i18n-core';
import type { Db, Queryable } from '../../db/client';
import { getConfig } from '../../config';
import { LOGO_CID, renderEmail, type EmailContent } from './layout';

/**
 * The email outbox. An email is queued in the same transaction as the event it reports, once per event and
 * person, and sent later by the scheduled job: a slow or failing mail server never slows a door, a handover or a
 * request. Nothing is sent until a mail account is configured (SMTP_*), and an email that waited more than a day
 * is skipped rather than sent late. Addresses on reserved test domains (the demo's @demo.kita.test) are never
 * sent to.
 */

export type EmailKind = 'LOCKER_READY' | 'COUNTER_READY' | 'COUNTER_REMINDER' | 'DOOR_FORCED';

/** What the outbox needs from a mail service. Real sending uses nodemailer; tests pass their own. */
export interface Mailer {
  send(message: { from: string; to: string; subject: string; html: string; text: string; logo: Buffer | null }): Promise<void>;
}

const BATCH = 20;
const MAX_ATTEMPTS = 3;
const STALE_MS = 24 * 3_600_000;
const STUCK_MS = 15 * 60_000;
/** Reserved for testing and documentation (RFC 2606, RFC 6761): mail to them can never be delivered. */
const TEST_DOMAIN = /\.(test|example|invalid|localhost)$/i;

let testMailer: Mailer | null | undefined;
/** Tests replace the mail service; pass undefined to go back to the configured one. */
export function setMailerForTests(mailer: Mailer | null | undefined) {
  testMailer = mailer;
}

let smtp: { key: string; mailer: Mailer } | null = null;
function configuredMailer(): Mailer | null {
  if (testMailer !== undefined) return testMailer;
  const config = getConfig();
  if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASS) return null;
  const key = `${config.SMTP_HOST}:${config.SMTP_PORT}:${config.SMTP_USER}`;
  if (smtp?.key === key) return smtp.mailer;
  let transport: import('nodemailer').Transporter | null = null;
  const mailer: Mailer = {
    async send(m) {
      // Loaded only when an email is actually sent.
      const nodemailer = (await import('nodemailer')).default;
      transport ??= nodemailer.createTransport({
        host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_PORT === 465, requireTLS: config.SMTP_PORT !== 465,
        auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
        connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 20_000,
      });
      await transport.sendMail({
        from: m.from, to: m.to, subject: m.subject, html: m.html, text: m.text,
        attachments: m.logo ? [{ filename: 'simetown-mark.png', content: m.logo, contentType: 'image/png', cid: LOGO_CID }] : [],
      });
    },
  };
  smtp = { key, mailer };
  return mailer;
}

let logo: Buffer | null | undefined;
function logoImage(): Buffer | null {
  if (logo === undefined) {
    try {
      logo = fs.readFileSync(path.join(process.cwd(), 'public', 'email', 'simetown-mark@2x.png'));
    } catch {
      logo = null; // The email still reads correctly: the band also says "SimeTown" in text.
    }
  }
  return logo;
}

/** The app's address for links in emails. */
export const appLink = (pathAndQuery: string) => new URL(pathAndQuery, getConfig().appOrigin).toString();

/**
 * Queues one email per person, in their own language, unless they switched parcel emails off (security emails
 * are always queued). The same event never queues twice for a person. Inside the caller's transaction.
 */
export async function queueEmails(
  q: Queryable,
  userIds: string[],
  kind: EmailKind,
  build: (lang: Lang) => Omit<EmailContent, 'lang' | 'firstName'>,
  dedupe: string,
  options: { always?: boolean } = {},
  now: Date = new Date(),
): Promise<number> {
  if (userIds.length === 0) return 0;
  const people = await q.query<{ id: string; email: string; full_name: string | null; language: Lang; parcel_emails: boolean }>(
    `SELECT id, email, full_name, language, parcel_emails FROM users WHERE id = ANY($1::uuid[]) AND status = 'ACTIVE' AND email IS NOT NULL`,
    [userIds],
  );
  let queued = 0;
  const content = new Map<Lang, Omit<EmailContent, 'lang' | 'firstName'>>();
  for (const person of people) {
    if (!options.always && !person.parcel_emails) continue;
    const lang: Lang = person.language === 'ms' ? 'ms' : 'en';
    if (!content.has(lang)) content.set(lang, build(lang));
    const firstName = person.full_name?.trim().split(/\s+/)[0] ?? null;
    const email = renderEmail({ ...content.get(lang)!, lang, firstName });
    const row = await q.query(
      `INSERT INTO email_outbox (user_id, to_email, kind, subject, html, body_text, dedupe_key, created_at, next_attempt_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
      [person.id, person.email, kind, email.subject.slice(0, 200), email.html, email.text, `${dedupe}:${person.id}`, now],
    );
    queued += row.length;
  }
  return queued;
}

/** Sends what is due, a batch at a time. Safe to run often and twice at once (rows are claimed with SKIP LOCKED). */
export async function sendQueuedEmails(db: Db, now: Date) {
  const counts = { sent: 0, failed: 0, retrying: 0, skipped: 0, waiting: 0, configured: false };
  // A run that died mid-send leaves rows claimed: give them back.
  await db.query(`UPDATE email_outbox SET status = 'QUEUED' WHERE status = 'SENDING' AND next_attempt_at < $1`, [new Date(now.getTime() - STUCK_MS)]);
  // Too late to be useful: a reminder or a "your parcel is here" a day later only confuses.
  counts.skipped += (await db.query(
    `UPDATE email_outbox SET status = 'SKIPPED', last_error = 'Not sent within a day', html = NULL, body_text = NULL
      WHERE status = 'QUEUED' AND created_at < $1 RETURNING id`,
    [new Date(now.getTime() - STALE_MS)],
  )).length;
  const mailer = configuredMailer();
  counts.configured = mailer !== null;
  if (!mailer) {
    counts.waiting = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM email_outbox WHERE status = 'QUEUED'`))[0]!.n;
    return counts;
  }
  const config = getConfig();
  const from = `SimeTown <${config.SMTP_FROM ?? config.SMTP_USER}>`;
  const due = await db.query<{ id: string; to_email: string; subject: string; html: string; body_text: string; attempts: number }>(
    `UPDATE email_outbox SET status = 'SENDING', attempts = attempts + 1, next_attempt_at = $1
      WHERE id IN (SELECT id FROM email_outbox WHERE status = 'QUEUED' AND next_attempt_at <= $1 ORDER BY id LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
      RETURNING id, to_email, subject, html, body_text, attempts`,
    [now],
  );
  for (const m of due) {
    const domain = m.to_email.split('@')[1] ?? '';
    if (TEST_DOMAIN.test(domain)) {
      await db.query(`UPDATE email_outbox SET status = 'SKIPPED', last_error = 'Test address: never sent' WHERE id = $1`, [m.id]);
      counts.skipped++;
      continue;
    }
    try {
      await mailer.send({ from, to: m.to_email, subject: m.subject, html: m.html, text: m.body_text, logo: logoImage() });
      await db.query(`UPDATE email_outbox SET status = 'SENT', sent_at = $2, last_error = NULL WHERE id = $1`, [m.id, now]);
      counts.sent++;
    } catch (error) {
      // The mail server's answer, never the credentials.
      const reason = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 300);
      const final = m.attempts >= MAX_ATTEMPTS;
      await db.query(
        `UPDATE email_outbox SET status = $2, last_error = $3, next_attempt_at = $4 WHERE id = $1`,
        [m.id, final ? 'FAILED' : 'QUEUED', reason, new Date(now.getTime() + m.attempts * 10 * 60_000)],
      );
      if (final) counts.failed++;
      else counts.retrying++;
    }
  }
  counts.waiting = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM email_outbox WHERE status = 'QUEUED'`))[0]!.n;
  return counts;
}

/** Privacy: an email's words are kept 30 days, the record of it 180 days. */
export async function cleanupEmails(q: Queryable, now: Date) {
  const cleared = await q.query(`UPDATE email_outbox SET html = NULL, body_text = NULL WHERE html IS NOT NULL AND created_at < $1 AND status <> 'QUEUED' RETURNING id`, [new Date(now.getTime() - 30 * 86_400_000)]);
  const removed = await q.query(`DELETE FROM email_outbox WHERE created_at < $1 RETURNING id`, [new Date(now.getTime() - 180 * 86_400_000)]);
  return { emailBodiesCleared: cleared.length, emailsRemoved: removed.length };
}
