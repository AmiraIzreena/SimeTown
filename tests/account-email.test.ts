import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@/server/db/client';
import { login, registerResident, requestPasswordReset, resetPassword } from '@/server/modules/identity/service';
import { T0, freshDb, makeHome, makeWorld, type World } from './helpers';

/** Account emails: a welcome on sign-up, and a self-service password reset by a single-use emailed link. */

let db: Db;
let w: World;
const MIN = 60_000;

const outbox = (userId: string) => db.query<{ kind: string; subject: string; html: string; body_text: string; status: string }>(
  'SELECT kind, subject, html, body_text, status FROM email_outbox WHERE user_id = $1 ORDER BY id', [userId],
);
/** The token from the reset link in the plain-text part, as the person would click it. */
const linkToken = (text: string) => /\/reset-password#([\w-]+)/.exec(text)![1]!;

async function register(email = `r-${randomUUID().slice(0, 8)}@simetown.my`) {
  const { actor } = await registerResident(db, {
    email, password: 'first-password-1', fullName: 'Aisyah Rahman', phone: '+60123456789',
    townshipId: w.townshipId, homeId: await makeHome(w), occupancy: 'OWNER',
  }, T0);
  return { ...actor, email };
}

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
});
afterAll(() => db.close());

describe('Welcome email', () => {
  it('is queued once when a resident creates an account, without the password or the full address', async () => {
    const r = await register();
    const [welcome, ...rest] = await outbox(r.id);
    expect(rest).toHaveLength(0);
    expect(welcome).toMatchObject({ kind: 'ACCOUNT_CREATED', subject: 'Welcome to SimeTown', status: 'QUEUED' });
    expect(welcome!.html).toContain('Hi Aisyah,');
    expect(welcome!.html).toContain(r.email);
    expect(welcome!.html).not.toContain('first-password-1');
    expect(welcome!.html).not.toContain('41050');
  });

  it('is sent even to a resident who turned parcel emails off (account emails are always sent)', async () => {
    const r = await register();
    await db.query('UPDATE users SET parcel_emails = false WHERE id = $1', [r.id]);
    // The welcome was queued at sign-up; a reset now is queued too.
    await requestPasswordReset(db, r.email, T0);
    expect((await outbox(r.id)).map((m) => m.kind)).toEqual(['ACCOUNT_CREATED', 'PASSWORD_RESET']);
  });
});

describe('Password reset', () => {
  it('emails a single-use link that sets a new password, signs out other devices and then stops working', async () => {
    const r = await register();
    expect(await requestPasswordReset(db, r.email.toUpperCase(), T0)).toEqual({ ok: true });
    const reset = (await outbox(r.id)).find((m) => m.kind === 'PASSWORD_RESET')!;
    expect(reset.subject).toBe('Reset your SimeTown password');
    expect(reset.html).toContain('Reset my password');
    expect(reset.html).toContain('30 minutes');
    expect(reset.html).not.toContain('first-password-1');
    const token = linkToken(reset.body_text);
    // The token is never stored, only its hash.
    expect(await db.query('SELECT 1 FROM password_resets WHERE token_hash = $1', [token])).toHaveLength(0);

    const before = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM sessions WHERE user_id = $1', [r.id]);
    expect(before[0]!.n).toBe(1);
    const signedIn = await resetPassword(db, { token, password: 'second-password-2' }, new Date(T0.getTime() + 5 * MIN));
    expect(signedIn.actor.id).toBe(r.id);
    const after = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM sessions WHERE user_id = $1', [r.id]);
    expect(after[0]!.n).toBe(1); // only the new one
    await expect(login(db, { email: r.email, password: 'first-password-1' }, T0)).rejects.toMatchObject({ status: 401 });
    await expect(login(db, { email: r.email, password: 'second-password-2' }, T0)).resolves.toBeTruthy();
    await expect(resetPassword(db, { token, password: 'third-password-3' }, new Date(T0.getTime() + 6 * MIN))).rejects.toMatchObject({ code: 'RESET_LINK_INVALID' });
  });

  it('expires after 30 minutes, and only the newest link works', async () => {
    const r = await register();
    await requestPasswordReset(db, r.email, T0);
    const first = linkToken((await outbox(r.id)).find((m) => m.kind === 'PASSWORD_RESET')!.body_text);
    await expect(resetPassword(db, { token: first, password: 'second-password-2' }, new Date(T0.getTime() + 31 * MIN))).rejects.toMatchObject({ code: 'RESET_LINK_INVALID' });

    // A second request within two minutes sends nothing new; after that, a new link replaces the old one.
    await requestPasswordReset(db, r.email, new Date(T0.getTime() + MIN));
    expect((await outbox(r.id)).filter((m) => m.kind === 'PASSWORD_RESET')).toHaveLength(1);
    await requestPasswordReset(db, r.email, new Date(T0.getTime() + 3 * MIN));
    const resets = (await outbox(r.id)).filter((m) => m.kind === 'PASSWORD_RESET');
    expect(resets).toHaveLength(2);
    const second = linkToken(resets[1]!.body_text);
    await expect(resetPassword(db, { token: first, password: 'second-password-2' }, new Date(T0.getTime() + 4 * MIN))).rejects.toMatchObject({ code: 'RESET_LINK_INVALID' });
    await expect(resetPassword(db, { token: second, password: 'second-password-2' }, new Date(T0.getTime() + 4 * MIN))).resolves.toBeTruthy();
  });

  it('answers the same for an address nobody uses, and queues nothing', async () => {
    const count = async () => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM email_outbox WHERE kind = 'PASSWORD_RESET'`))[0]!.n;
    const before = await count();
    expect(await requestPasswordReset(db, 'nobody@simetown.my', T0)).toEqual({ ok: true });
    expect(await count()).toBe(before);
  });

  it('is in Malay for a resident who chose Malay', async () => {
    const r = await register();
    await db.query(`UPDATE users SET language = 'ms' WHERE id = $1`, [r.id]);
    await requestPasswordReset(db, r.email, T0);
    const reset = (await outbox(r.id)).find((m) => m.kind === 'PASSWORD_RESET')!;
    expect(reset.subject).toBe('Tetapkan semula kata laluan SimeTown anda');
    expect(reset.html).toContain('lang="ms"');
    expect(reset.html).toContain('30 minit');
  });
});
