import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { hashPassword } from '@/server/auth/password';
import { createSession } from '@/server/auth/session';
import type { Db } from '@/server/db/client';
import { one } from '@/server/db/client';
import { routes } from '@/server/http/api';
import { createRouter } from '@/server/http/router';
import { notify } from '@/server/modules/notifications';
import { createKiosk } from '@/server/modules/kitar/service';
import { createLoop, listLoopsForStaff } from '@/server/modules/gerak/service';
import { T0, expectFloatBalanced, freshDb, makeCampaign, makeHome, makeMerchant, makeResident, makeSponsorUser, makeWorld, sell, walletOf, type World } from './helpers';

/** These tests go through the real router: sign-in, roles, the origin check, validation and each feature's rules. */

let db: Db;
let w: World;
const clock = { now: T0 };
const ORIGIN = 'http://kita.test';
let handle: (req: Request) => Promise<Response>;

interface CallOptions {
  as?: Actor | string; // an actor (a session is made for them) or a raw cookie
  body?: unknown;
  form?: FormData;
  origin?: string | null;
  bearer?: string;
}

const sessions = new Map<string, string>();
async function cookieFor(actor: Actor): Promise<string> {
  if (!sessions.has(actor.id)) sessions.set(actor.id, `kita_session=${await createSession(db, actor.id, clock.now)}`);
  return sessions.get(actor.id)!;
}

async function call(method: string, path: string, opts: CallOptions = {}) {
  const headers = new Headers();
  if (opts.as) headers.set('cookie', typeof opts.as === 'string' ? opts.as : await cookieFor(opts.as));
  if (opts.origin !== null && method !== 'GET') headers.set('origin', opts.origin ?? ORIGIN);
  if (opts.bearer) headers.set('authorization', `Bearer ${opts.bearer}`);
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(opts.body);
  }
  const res = await handle(new Request(`${ORIGIN}/api/v1${path}`, { method, headers, body }));
  const isJson = res.headers.get('content-type')?.includes('json');
  const payload = isJson ? ((await res.json()) as { data?: any; error?: { code: string; message: string; details?: any } }) : undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { status: res.status, data: payload?.data, error: payload?.error, headers: res.headers, json: payload as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

// A valid 1×1 PNG.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
  handle = createRouter(routes, { prefix: '/api/v1', db: async () => db, now: () => clock.now }).handle;
});
afterAll(() => db.close());

describe('notification API ownership and validation', () => {
  it('requires a session and restricts read and dismiss to the notification owner', async () => {
    const resident = await makeResident(w);
    const neighbour = await makeResident(w);
    await notify(db, [resident.id], { title: 'Update', body: 'Your update', link: '/app/wallet', dedupeKey: 'api-notification' });
    expect((await call('GET', '/notifications')).status).toBe(401);
    const inbox = await call('GET', '/notifications?unread=true&category=REWARDS', { as: resident });
    expect(inbox.status).toBe(200);
    const id = inbox.data.items[0].id;
    expect((await call('POST', `/notifications/${id}/read`, { as: neighbour, body: {} })).status).toBe(404);
    expect((await call('POST', `/notifications/${id}/dismiss`, { as: neighbour, body: {} })).status).toBe(404);
    expect((await call('POST', `/notifications/${id}/read`, { as: resident, origin: 'https://other.test' })).status).toBe(403);
    expect((await call('POST', `/notifications/${id}/read`, { as: resident, body: {} })).status).toBe(200);
    expect((await call('GET', '/notifications', { as: resident })).data.unread).toBe(0);
    expect((await call('POST', `/notifications/${id}/dismiss`, { as: resident, body: {} })).status).toBe(200);
    expect((await call('POST', '/notifications/invalid/read', { as: resident, body: {} })).status).toBe(400);
    expect((await call('GET', '/notifications', { as: resident })).data.items).toHaveLength(0);
    expect((await call('GET', '/notifications?limit=0', { as: resident })).status).toBe(400);
    expect((await call('GET', '/notifications?category=UNKNOWN', { as: resident })).status).toBe(400);
  });
});

describe('signing in (KITA ID)', () => {
  it('registers a resident as unverified, and staff verification unlocks earning (BR1)', async () => {
    const homeId = await makeHome(w);
    const reg = await call('POST', '/auth/register', {
      body: {
        email: 'aisyah@kita.test', password: 'correct-horse-battery', fullName: 'Aisyah Rahman', phone: '012-345 6789',
        townshipId: w.townshipId, homeId, occupancy: 'OWNER', acceptTerms: true,
      },
    });
    expect(reg.status).toBe(200);
    const cookie = reg.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const session = cookie.split(';')[0]!;
    expect(reg.data.residencyStatus).toBe('PENDING');

    await createKiosk(db, w.staff, { name: 'Kiosk Reg', location: 'Hall' });
    const kiosk = await one<{ code: string }>(db, `SELECT code FROM kitar_kiosks WHERE name = 'Kiosk Reg'`);
    const dropBody = { kioskCode: kiosk!.code, material: 'PAPER', weightG: 500 };
    expect((await call('POST', '/kitar/dropoffs', { as: session, body: dropBody })).status).toBe(403);

    const verify = await call('POST', `/admin/residents/${reg.data.id}/verify`, { as: w.staff, body: { approve: true } });
    expect(verify.status).toBe(200);
    const drop = await call('POST', '/kitar/dropoffs', { as: session, body: dropBody });
    expect(drop.status).toBe(200);
    expect(drop.data.reward.xp).toBe(20);
  });

  it('signs in with the right password only, and gives the same answer for any failure', async () => {
    const wrongPassword = await call('POST', '/auth/login', { body: { email: 'aisyah@kita.test', password: 'wrong-password-here' } });
    const noSuchUser = await call('POST', '/auth/login', { body: { email: 'nobody@kita.test', password: 'wrong-password-here' } });
    expect(wrongPassword.status).toBe(401);
    expect(noSuchUser.status).toBe(401);
    expect(noSuchUser.error!.message).toBe(wrongPassword.error!.message);

    const ok = await call('POST', '/auth/login', { body: { email: 'AISYAH@kita.test', password: 'correct-horse-battery' } });
    expect(ok.status).toBe(200);
    const session = ok.headers.get('set-cookie')!.split(';')[0]!;
    expect((await call('GET', '/me', { as: session })).data.email).toBe('aisyah@kita.test');

    await call('POST', '/auth/logout', { as: session, body: {} });
    expect((await call('GET', '/me', { as: session })).status).toBe(401);
  });

  it('slows down password guessing against one account', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await call('POST', '/auth/login', { body: { email: 'target@kita.test', password: `guess-number-${i}` } })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[11]).toBe(429);
  });

  it('lets an owner confirm their own tenant, and nobody else’s (BR1)', async () => {
    const homeId = await makeHome(w);
    const owner = await makeResident(w, { homeId });
    const tenant = await makeResident(w, { homeId, occupancy: 'TENANT', status: 'PENDING' });
    const otherOwner = await makeResident(w);

    expect((await call('POST', `/household/requests/${tenant.id}`, { as: otherOwner, body: { approve: true } })).status).toBe(404);
    expect((await call('GET', '/household/requests', { as: owner })).data).toHaveLength(1);
    expect((await call('POST', `/household/requests/${tenant.id}`, { as: owner, body: { approve: true } })).status).toBe(200);
    const row = await one<{ residency_status: string }>(db, 'SELECT residency_status FROM users WHERE id = $1', [tenant.id]);
    expect(row!.residency_status).toBe('VERIFIED');
  });

  it('creates staff accounts by one-time invitation link', async () => {
    const created = await call('POST', '/admin/accounts', { as: w.admin, body: { email: 'new.staff@kita.test', fullName: 'New Staff', role: 'TOWNSHIP_STAFF' } });
    expect(created.status).toBe(200);
    // A township admin cannot mint an HQ admin.
    expect((await call('POST', '/admin/accounts', { as: w.admin, body: { email: 'x@kita.test', fullName: 'Not Allowed', role: 'HQ_ADMIN' } })).status).toBe(403);

    const accept = await call('POST', '/auth/accept-invite', { body: { token: created.data.inviteToken, password: 'a-brand-new-password', acceptTerms: true } });
    expect(accept.status).toBe(200);
    expect(accept.data.role).toBe('TOWNSHIP_STAFF');
    const again = await call('POST', '/auth/accept-invite', { body: { token: created.data.inviteToken, password: 'another-password-1', acceptTerms: true } });
    expect(again.error!.code).toBe('INVITE_INVALID');
  });
});

describe('access control', () => {
  it('requires a session', async () => {
    expect((await call('GET', '/wallet')).status).toBe(401);
    expect((await call('GET', '/insights', { as: 'kita_session=made-up-token' })).status).toBe(401);
  });

  it('enforces roles on the server (BR2)', async () => {
    const resident = await makeResident(w);
    const shop = await makeMerchant(w);
    const sponsor = await makeSponsorUser(w);
    expect((await call('GET', '/insights', { as: resident })).status).toBe(403);
    expect((await call('GET', '/admin/audit', { as: w.staff })).status).toBe(403);
    expect((await call('GET', '/finance/float', { as: shop })).status).toBe(403);
    expect((await call('GET', '/admin/merchants', { as: sponsor })).status).toBe(403);
    expect((await call('POST', '/campaigns', { as: shop, body: {} })).status).toBe(403);
    expect((await call('PATCH', '/admin/settings', { as: w.admin, body: { issuance_fee_bps: 0 } })).status).toBe(403); // HQ only
    expect((await call('PATCH', '/admin/settings', { as: w.hq, body: { min_group_size: 10 } })).status).toBe(200);
  });

  it('refuses state-changing requests from another origin (CSRF)', async () => {
    const resident = await makeResident(w);
    expect((await call('POST', '/notifications/read', { as: resident, body: {}, origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('POST', '/notifications/read', { as: resident, body: {}, origin: null })).status).toBe(403);
    expect((await call('POST', '/notifications/read', { as: resident, body: {} })).status).toBe(200);
  });

  it('keeps one township’s staff out of another township', async () => {
    const other = await makeWorld(db);
    const resident = await makeResident(w, { status: 'PENDING' });
    expect((await call('POST', `/admin/residents/${resident.id}/verify`, { as: other.staff, body: { approve: true } })).status).toBe(403);
    expect((await call('POST', `/admin/banjir/zones/${w.zoneId}/level`, { as: other.staff, body: { levelPct: 95 } })).status).toBe(404);
    // An HQ admin may act anywhere.
    expect((await call('POST', `/admin/residents/${resident.id}/verify`, { as: w.hq, body: { approve: true } })).status).toBe(200);
  });

  it('validates input and names the fields that are wrong', async () => {
    const shop = await makeMerchant(w, 10_000);
    const bad = await call('POST', '/merchant/sales', { as: shop, body: { memberCode: 'ABCDEFGH', billSen: -5, idempotencyKey: 'nope' } });
    expect(bad.status).toBe(400);
    expect(bad.error!.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(bad.error!.details.fields)).toEqual(expect.arrayContaining(['billSen', 'idempotencyKey']));
    expect((await call('GET', '/merchant/sales/not-a-uuid', { as: shop })).status).toBe(404);
  });

  it('answers unknown paths and wrong methods cleanly', async () => {
    expect((await call('GET', '/nope')).status).toBe(404);
    expect((await call('DELETE', '/wallet')).status).toBe(405);
    expect((await call('GET', '/health')).data.status).toBe('ok');
    expect((await call('GET', '/ready')).data.status).toBe('ready');
  });
});

describe('KITA Merchant through the API', () => {
  it('keeps a new shop from trading until an admin approves it (BR3)', async () => {
    const apply = await call('POST', '/merchants/apply', {
      body: {
        townshipId: w.townshipId, businessName: 'Kafe Baharu', registrationNo: '202601012345', category: 'Food & drink',
        addressLine: 'Lot G-02, Jalan Satu', postcode: '41050', city: 'Klang', state: 'Selangor',
        contactName: 'Encik Lim', email: 'kafe@kita.test', phone: '+60 12-222 3333', password: 'kafe-password-123', acceptTerms: true,
      },
    });
    expect(apply.status).toBe(200);
    const login = await call('POST', '/auth/login', { body: { email: 'kafe@kita.test', password: 'kafe-password-123' } });
    const session = login.headers.get('set-cookie')!.split(';')[0]!;
    const resident = await makeResident(w);
    const saleBody = { memberCode: resident.memberCode, billSen: 2_000, idempotencyKey: crypto.randomUUID() };

    expect((await call('POST', '/merchant/sales', { as: session, body: saleBody })).status).toBe(403);
    await call('POST', `/admin/merchants/${apply.data.merchantId}/status`, { as: w.admin, body: { status: 'ACTIVE' } });
    await call('POST', `/admin/merchants/${apply.data.merchantId}/deposits`, { as: w.admin, body: { amountSen: 5_000, bankRef: 'TRF-KAFE-1' } });
    const sale = await call('POST', '/merchant/sales', { as: session, body: saleBody });
    expect(sale.data).toMatchObject({ status: 'COMPLETED', pointsEarned: 20 });
    // The same bank reference cannot be recorded twice.
    const dup = await call('POST', `/admin/merchants/${apply.data.merchantId}/deposits`, { as: w.admin, body: { amountSen: 5_000, bankRef: 'TRF-KAFE-1' } });
    expect(dup.error!.code).toBe('DUPLICATE_BANK_REF');
    // Named on the field, so the form shows it inside the payment dialog.
    expect(dup.error!.details).toMatchObject({ fields: { bankRef: expect.stringContaining('already recorded') } });
  });

  it('does not let one shop read or refund another shop’s sale', async () => {
    const shopA = await makeMerchant(w, 10_000);
    const shopB = await makeMerchant(w, 10_000);
    const resident = await makeResident(w);
    const sale = await sell(w, shopA, resident, 2_000);
    expect((await call('GET', `/merchant/sales/${sale.id}`, { as: shopB })).status).toBe(404);
    expect((await call('POST', `/merchant/sales/${sale.id}/refund`, { as: shopB, body: {} })).status).toBe(404);
    expect((await call('GET', `/merchant/sales/${sale.id}`, { as: shopA })).data.memberName).not.toContain('RESIDENT'); // first name and initial only
  });

  it('shows the resident the pending request and who funded each point (BR8, BR12)', async () => {
    const shop = await makeMerchant(w, 100_000);
    const resident = await makeResident(w);
    await sell(w, shop, resident, 50_000);
    const pending = await call('POST', '/merchant/sales', { as: shop, body: { memberCode: resident.memberCode, billSen: 2_000, redeemPoints: 300, idempotencyKey: crypto.randomUUID() } });
    expect(pending.data.status).toBe('PENDING');

    const wallet = await call('GET', '/wallet', { as: resident });
    expect(wallet.data.points).toBe(500);
    expect(wallet.data.pending).toHaveLength(1);

    const confirm = await call('POST', `/wallet/sales/${pending.data.id}/decision`, { as: resident, body: { accept: true } });
    expect(confirm.data).toMatchObject({ status: 'COMPLETED', redeemPoints: 300, pointsEarned: 17 });
    const history = await call('GET', '/wallet/history', { as: resident });
    expect(history.data.items.map((h: { points: number }) => h.points)).toEqual([17, -300, 500]);
    expect(history.data.items[0].label).toMatch(/funded by the shop/);
  });
});

describe('Lapor', () => {
  it('suggests type and urgency, lets staff correct it with a log entry, and rewards a confirmed report (BR21)', async () => {
    const reporter = await makeResident(w);
    const stranger = await makeResident(w);
    const form = new FormData();
    form.set('description', 'Lampu jalan rosak di depan taman permainan');
    form.set('locationText', 'Jalan Satu, near the playground');
    form.set('photo', new File([PNG], 'lamp.png', { type: 'image/png' }));
    const created = await call('POST', '/reports', { as: reporter, form });
    expect(created.status).toBe(200);
    expect(created.data).toMatchObject({ category: 'LIGHTING', urgency: 'MEDIUM', suggestion: { source: 'RULES' } });
    const id = created.data.id;

    // Only the reporter and township staff can see the report or its photo.
    expect((await call('GET', `/reports/${id}`, { as: stranger })).status).toBe(404);
    expect((await call('GET', `/reports/${id}/photo`, { as: stranger })).status).toBe(404);
    const photo = await call('GET', `/reports/${id}/photo`, { as: reporter });
    expect(photo.headers.get('content-type')).toBe('image/png');
    expect(photo.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await call('GET', '/reports', { as: w.staff })).data.items.some((r: { id: string }) => r.id === id)).toBe(true);
    expect((await call('PATCH', `/reports/${id}`, { as: reporter, body: { status: 'RESOLVED' } })).status).toBe(403);

    const fix = await call('PATCH', `/reports/${id}`, { as: w.staff, body: { category: 'SAFETY', urgency: 'HIGH', status: 'IN_PROGRESS', staffNote: 'Exposed wiring found.' } });
    expect(fix.status).toBe(200);
    const override = await one<{ detail: { suggested: { category: string } } }>(db, `SELECT detail FROM audit_log WHERE action = 'AI_OVERRIDE' AND entity_id = $1`, [id]);
    expect(override!.detail.suggested.category).toBe('LIGHTING');
    const xp = await one<{ xp_total: number }>(db, 'SELECT xp_total FROM users WHERE id = $1', [reporter.id]);
    expect(xp!.xp_total).toBe(25);
  });

  it('rejects a file that only pretends to be an image', async () => {
    const reporter = await makeResident(w);
    const form = new FormData();
    form.set('description', 'Rubbish dumped beside the bin store');
    form.set('locationText', 'Block C');
    form.set('photo', new File(['<script>alert(1)</script>'], 'photo.png', { type: 'image/png' }));
    const res = await call('POST', '/reports', { as: reporter, form });
    expect(res.status).toBe(400);
  });

  it('pushes an urgent safety report to staff as URGENT (BR19)', async () => {
    const reporter = await makeResident(w);
    const form = new FormData();
    form.set('description', 'Pokok tumbang across the road, live wire on the ground');
    form.set('locationText', 'Jalan Dua');
    const created = await call('POST', '/reports', { as: reporter, form });
    expect(created.data).toMatchObject({ category: 'SAFETY', urgency: 'URGENT' });
    const inbox = await call('GET', '/notifications', { as: w.staff });
    expect(inbox.data.items[0]).toMatchObject({ priority: 'URGENT', title: 'Urgent safety report' });
  });
});

describe('Jiran and Kongsi', () => {
  it('gives XP to the helper only when the person who asked confirms', async () => {
    const asker = await makeResident(w);
    const helper = await makeResident(w);
    const post = await call('POST', '/posts', { as: asker, body: { type: 'HELP', title: 'Help carrying a cupboard', body: 'Two flights of stairs, ten minutes.' } });
    await call('POST', `/posts/${post.data.id}/respond`, { as: helper, body: {} });

    expect((await call('POST', `/posts/${post.data.id}/responses/${helper.id}/confirm`, { as: asker, body: {} })).error!.code).toBe('NOT_ACCEPTED');
    expect((await call('POST', `/posts/${post.data.id}/responses/${helper.id}/accept`, { as: helper, body: {} })).status).toBe(403);
    await call('POST', `/posts/${post.data.id}/responses/${helper.id}/accept`, { as: asker, body: {} });
    expect((await call('POST', `/posts/${post.data.id}/responses/${helper.id}/confirm`, { as: helper, body: {} })).status).toBe(403);
    const confirm = await call('POST', `/posts/${post.data.id}/responses/${helper.id}/confirm`, { as: asker, body: {} });
    expect(confirm.data.reward.xp).toBe(40);
    expect((await call('POST', `/posts/${post.data.id}/respond`, { as: await makeResident(w), body: {} })).error!.code).toBe('POST_CLOSED');
  });

  it('rewards the giver when a Kongsi item is handed over', async () => {
    const giver = await makeResident(w);
    const taker = await makeResident(w);
    const post = await call('POST', '/posts', { as: giver, body: { type: 'GIVE', title: "Child's chair", body: 'Good condition, collect from Jalan Tiga.' } });
    const other = await makeResident(w);
    await call('POST', `/posts/${post.data.id}/respond`, { as: taker, body: {} });
    await call('POST', `/posts/${post.data.id}/respond`, { as: other, body: {} });
    await call('POST', `/posts/${post.data.id}/responses/${taker.id}/accept`, { as: giver, body: {} });
    // Only one neighbour can be promised the item at a time.
    expect((await call('POST', `/posts/${post.data.id}/responses/${other.id}/accept`, { as: giver, body: {} })).error!.code).toBe('ALREADY_ACCEPTED');
    await call('POST', `/posts/${post.data.id}/responses/${other.id}/decline`, { as: giver, body: {} });
    expect((await call('POST', `/posts/${post.data.id}/respond`, { as: other, body: {} })).status).toBe(200);
    expect((await call('POST', `/posts/${post.data.id}/responses/${other.id}/accept`, { as: giver, body: {} })).error!.code).toBe('NOT_PENDING');

    await call('POST', `/posts/${post.data.id}/responses/${taker.id}/confirm`, { as: giver, body: {} });
    const xp = await one<{ xp_total: number }>(db, 'SELECT xp_total FROM users WHERE id = $1', [giver.id]);
    expect(xp!.xp_total).toBe(30);
    const impact = await call('GET', '/posts/impact', { as: giver });
    expect(impact.data).toEqual({ xp: 30, activities: 0, contributions: 1, neighbours_helped: 0 });
  });

  it('lends with a return date and gives the lender XP only when the item comes back', async () => {
    const lender = await makeResident(w);
    const borrower = await makeResident(w);
    const next = await makeResident(w);
    const post = await call('POST', '/posts', { as: lender, body: { type: 'LEND', title: 'Ladder to borrow', body: 'Three metres, aluminium.' } });
    const responses = `/posts/${post.data.id}/responses`;
    await call('POST', `/posts/${post.data.id}/respond`, { as: borrower, body: {} });
    await call('POST', `/posts/${post.data.id}/respond`, { as: next, body: {} });

    expect((await call('POST', `${responses}/${borrower.id}/accept`, { as: lender, body: {} })).error!.code).toBe('LOAN_NEEDS_DATE');
    expect((await call('POST', `${responses}/${borrower.id}/accept`, { as: lender, body: { dueBack: '2026-11-01' } })).error!.code).toBe('LOAN_DATE'); // yesterday
    expect((await call('POST', `${responses}/${borrower.id}/accept`, { as: lender, body: { dueBack: '2027-03-01' } })).error!.code).toBe('LOAN_DATE'); // too far
    expect((await call('POST', `${responses}/${borrower.id}/accept`, { as: lender, body: { dueBack: '2026-11-05' } })).status).toBe(200);

    const lent = await call('POST', `${responses}/${borrower.id}/confirm`, { as: lender, body: {} });
    expect(lent.data.reward).toBeNull();
    // While it is out, nobody else can be lent it.
    expect((await call('POST', `${responses}/${next.id}/accept`, { as: lender, body: { dueBack: '2026-11-06' } })).error!.code).toBe('ALREADY_ACCEPTED');
    const seen = (await call('GET', `/posts?type=LEND&mine=true`, { as: borrower })).data.items.find((p: { id: string }) => p.id === post.data.id);
    expect(seen).toMatchObject({ my_response: 'CONFIRMED', my_due_back: '2026-11-05' });

    expect((await call('POST', `${responses}/${next.id}/returned`, { as: lender, body: {} })).error!.code).toBe('NOT_ON_LOAN');
    const back = await call('POST', `${responses}/${borrower.id}/returned`, { as: lender, body: {} });
    expect(back.data.reward.xp).toBe(30);
    expect((await call('POST', `${responses}/${next.id}/accept`, { as: lender, body: { dueBack: '2026-11-06' } })).status).toBe(200);

    // Borrowing the same item again is fine, but earns the lender nothing more from the same neighbour.
    expect((await call('POST', `/posts/${post.data.id}/respond`, { as: borrower, body: {} })).status).toBe(200);
    const again = await call('GET', `/posts?type=LEND&mine=true`, { as: borrower });
    expect(again.data.items.find((p: { id: string }) => p.id === post.data.id).my_response).toBe('PENDING');
  });

  it('lets a neighbour cancel an RSVP before the event, which frees the place', async () => {
    const host = await makeResident(w);
    const guest = await makeResident(w);
    const late = await makeResident(w);
    const post = await call('POST', '/posts', { as: host, body: { type: 'EVENT', title: 'Board games night', body: 'Bring a game.', startsAt: new Date(T0.getTime() + 86_400_000).toISOString(), capacity: 1 } });
    await call('POST', `/posts/${post.data.id}/respond`, { as: guest, body: {} });
    expect((await call('POST', `/posts/${post.data.id}/respond`, { as: late, body: {} })).error!.code).toBe('POST_FULL');
    expect((await call('POST', `/posts/${post.data.id}/responses/${guest.id}/accept`, { as: host, body: {} })).error!.code).toBe('EVENT_NO_ACCEPT');

    expect((await call('POST', `/posts/${post.data.id}/withdraw`, { as: guest, body: {} })).status).toBe(200);
    expect((await call('POST', `/posts/${post.data.id}/withdraw`, { as: guest, body: {} })).status).toBe(404);
    expect((await call('POST', `/posts/${post.data.id}/respond`, { as: late, body: {} })).status).toBe(200);

    clock.now = new Date(T0.getTime() + 2 * 86_400_000);
    try {
      expect((await call('POST', `/posts/${post.data.id}/withdraw`, { as: late, body: {} })).error!.code).toBe('EVENT_STARTED');
      const attended = await call('POST', `/posts/${post.data.id}/responses/${late.id}/confirm`, { as: host, body: {} });
      expect(attended.data.reward.xp).toBe(30);
      expect((await call('POST', `/posts/${post.data.id}/withdraw`, { as: late, body: {} })).error!.code).toBe('CANNOT_WITHDRAW');
    } finally {
      clock.now = T0;
    }
  });

  it('lists every type in one Komuniti feed, a group of types, or a search', async () => {
    const author = await makeResident(w);
    const help = await call('POST', '/posts', { as: author, body: { type: 'HELP', title: 'Komuniti test: fix a tap', body: 'Kitchen tap is dripping.' } });
    const lend = await call('POST', '/posts', { as: author, body: { type: 'LEND', title: 'Komuniti test: ladder', body: 'Three-metre ladder.' } });
    const ids = async (query: string) => (await call('GET', `/posts?${query}`, { as: author })).data.items.map((p: { id: string }) => p.id);

    expect(await ids('mine=true')).toEqual(expect.arrayContaining([help.data.id, lend.data.id]));
    const share = await ids('type=GIVE,LEND&mine=true');
    expect(share).toContain(lend.data.id);
    expect(share).not.toContain(help.data.id);
    expect(await ids('q=ladder&mine=true')).toEqual([lend.data.id]);
    expect((await call('GET', '/posts?type=NOPE', { as: author })).status).toBe(400);
  });

  it('takes one optional photo on any kind of post, as a form, and keeps the JSON form working', async () => {
    const author = await makeResident(w);
    const postForm = (fields: Record<string, string>, photo?: File) => {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.set(key, value);
      if (photo) form.set('photo', photo);
      return form;
    };
    const png = () => new File([PNG], 'photo.png', { type: 'image/png' });
    const event = await call('POST', '/posts/with-photo', {
      as: author,
      form: postForm({ type: 'EVENT', title: 'Street potluck', body: 'Bring one dish.', startsAt: new Date(T0.getTime() + 86_400_000).toISOString(), capacity: '20' }, png()),
    });
    expect(event.status).toBe(200);
    const help = await call('POST', '/posts/with-photo', { as: author, form: postForm({ type: 'HELP', title: 'Fix a gate', body: 'The latch is broken.' }, png()) });
    const give = await call('POST', '/posts/with-photo', { as: author, form: postForm({ type: 'GIVE', title: 'Spare chairs', body: 'Two folding chairs.' }) }); // no photo
    const feed = (await call('GET', '/posts?mine=true', { as: author })).data.items as { id: string; has_photo: boolean; capacity: number | null }[];
    const byId = (id: string) => feed.find((p) => p.id === id)!;
    expect(byId(event.data.id)).toMatchObject({ has_photo: true, capacity: 20 });
    expect(byId(help.data.id).has_photo).toBe(true);
    expect(byId(give.data.id).has_photo).toBe(false);
    expect((await call('GET', `/posts/${give.data.id}/photo`, { as: author })).status).toBe(404);

    // The same rules as the JSON form, with the same field messages.
    const missing = await call('POST', '/posts/with-photo', { as: author, form: postForm({ type: 'LEND', title: '', body: 'A drill.' }) });
    expect(missing.error!.code).toBe('VALIDATION_FAILED');
    expect(missing.error!.details.fields.title).toBeTruthy();
    expect((await call('POST', '/posts/with-photo', { as: author, form: postForm({ type: 'EVENT', title: 'Badminton', body: 'All levels.' }) })).error!.code).toBe('EVENT_NEEDS_DATE');
    // A file that only pretends to be an image is refused, and no post is left behind.
    const count = async () => (await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM posts WHERE author_id = $1', [author.id]))!.n;
    const before = await count();
    const fake = new File(['<script>alert(1)</script>'], 'x.png', { type: 'image/png' });
    expect((await call('POST', '/posts/with-photo', { as: author, form: postForm({ type: 'LEND', title: 'Ladder', body: 'Three metres.' }, fake) })).status).toBe(400);
    expect(await count()).toBe(before);
    // JSON posts still work, without a photo.
    expect((await call('POST', '/posts', { as: author, body: { type: 'LEND', title: 'Ladder', body: 'Three metres.' } })).status).toBe(200);
  });

  it('shows a post photo only to whoever may see the post itself', async () => {
    const other = await makeWorld(db);
    const author = await makeResident(w);
    const neighbour = await makeResident(w);
    const form = new FormData();
    form.set('type', 'LEND');
    form.set('title', 'Pressure washer');
    form.set('body', 'For a weekend.');
    form.set('photo', new File([PNG], 'washer.png', { type: 'image/png' }));
    const id = (await call('POST', '/posts/with-photo', { as: author, form })).data.id as string;
    const status = async (as: Actor) => (await call('GET', `/posts/${id}/photo`, { as })).status;

    const photo = await call('GET', `/posts/${id}/photo`, { as: neighbour });
    expect(photo.status).toBe(200);
    expect(photo.headers.get('content-type')).toBe('image/png');
    expect(photo.headers.get('x-content-type-options')).toBe('nosniff');
    expect(photo.headers.get('cache-control')).toMatch(/^private/);
    expect(await status(await makeResident(other))).toBe(404); // another township: as if it did not exist
    expect(await status(other.admin)).toBe(404);
    expect(await status(w.staff)).toBe(200);
    expect(await status(w.hq)).toBe(200);

    expect((await call('POST', `/posts/${id}/close`, { as: author, body: {} })).status).toBe(200);
    expect(await status(neighbour)).toBe(200); // a closed post stays visible

    expect((await call('POST', `/admin/komuniti/posts/${id}/moderate`, { as: w.staff, body: { action: 'HIDE' } })).status).toBe(200);
    expect(await status(neighbour)).toBe(404);
    expect(await status(author)).toBe(200);
    expect(await status(w.staff)).toBe(200);

    expect((await call('POST', `/admin/komuniti/posts/${id}/moderate`, { as: w.admin, body: { action: 'REMOVE', note: 'Not allowed in Komuniti.' } })).status).toBe(200);
    expect(await status(neighbour)).toBe(404);
    expect(await status(author)).toBe(404);
    expect(await status(w.staff)).toBe(200);
    expect(await status(w.hq)).toBe(200);
    expect((await call('GET', `/admin/komuniti/posts/${id}`, { as: w.admin })).data.has_photo).toBe(true);
  });

  it('checks a suspension before reading the upload, and allows 10 photo posts an hour', async () => {
    const form = () => {
      const f = new FormData();
      f.set('type', 'HELP');
      f.set('title', 'Help with a box');
      f.set('body', 'Ten minutes.');
      return f;
    };
    const resident = await makeResident(w);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await call('POST', '/posts/with-photo', { as: resident, form: form() })).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);

    const suspended = await makeResident(w);
    expect((await call('POST', `/admin/komuniti/suspensions/${suspended.id}`, { as: w.admin, body: { days: 7, reason: 'Repeated scam posts.' } })).status).toBe(200);
    expect((await call('POST', '/posts/with-photo', { as: suspended, form: form() })).error!.code).toBe('KOMUNITI_SUSPENDED');
  });
});

describe('Komuniti moderation (township staff, township admins and HQ)', () => {
  const lastNotice = async (user: Actor) => one<{ title: string; body: string }>(db, 'SELECT title, body FROM notifications WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1', [user.id]);
  const report = (postId: string, as: Actor, body: Record<string, unknown> = { category: 'SCAM' }) => call('POST', `/posts/${postId}/flag`, { as, body });
  const queued = async (postId: string, as: Actor = w.staff) => (await call('GET', '/admin/komuniti/reports', { as })).data.some((p: { id: string }) => p.id === postId);

  it('hides a post after three different residents report it, and keeping it dismisses the reports (BR20)', async () => {
    const author = await makeResident(w);
    const post = await call('POST', '/posts', { as: author, body: { type: 'LEND', title: 'Totally legit offer', body: 'Send me your bank details.' } });
    const id = post.data.id as string;
    const listed = async () => (await call('GET', '/posts?type=LEND', { as: w.staff })).data.items.some((p: { id: string }) => p.id === id);
    expect((await report(id, await makeResident(w), { category: 'OTHER' })).error!.code).toBe('REASON_NEEDED');

    const reporters = [await makeResident(w), await makeResident(w), await makeResident(w)];
    await report(id, reporters[0]!);
    await report(id, reporters[0]!); // a second report from the same resident does not count
    await report(id, reporters[1]!, { category: 'OTHER', reason: 'Asks for bank details' });
    expect(await listed()).toBe(true);
    expect(await queued(id)).toBe(true); // staff see reports before the post is hidden
    expect((await report(id, reporters[2]!)).data.hidden).toBe(true);
    expect(await listed()).toBe(false);

    const queue = (await call('GET', '/admin/komuniti/reports', { as: w.admin })).data;
    expect(queue[0]).toMatchObject({ id, status: 'HIDDEN', open_reports: 3, urgent: true });
    expect((await call('GET', '/admin/komuniti/overview', { as: w.admin })).data).toMatchObject({ reported: 1, hidden: 1 });

    const kept = await call('POST', `/admin/komuniti/posts/${id}/moderate`, { as: w.staff, body: { action: 'KEEP' } });
    expect(kept.data.status).toBe('OPEN');
    expect(await listed()).toBe(true);
    expect(await queued(id)).toBe(false);
    expect((await lastNotice(reporters[0]!))!.title).toBe('We reviewed "Totally legit offer"');
    expect((await lastNotice(author))!.title).toBe('Your post "Totally legit offer" is visible again');
    // Dismissed reports stay on record but no longer count towards hiding it.
    const detail = (await call('GET', `/admin/komuniti/posts/${id}`, { as: w.admin })).data;
    expect(detail.reports.map((r: { status: string }) => r.status)).toEqual(['DISMISSED', 'DISMISSED', 'DISMISSED']);
    expect((await report(id, await makeResident(w))).data.hidden).toBe(false);
    expect((await call('POST', `/admin/komuniti/posts/${id}/moderate`, { as: w.staff, body: { action: 'KEEP' } })).status).toBe(200);
    expect((await call('POST', `/admin/komuniti/posts/${id}/moderate`, { as: w.staff, body: { action: 'KEEP' } })).error!.code).toBe('NOTHING_TO_REVIEW');
  });

  it('removes a post only with a reason, and tells the author, the reporters and anyone waiting on it', async () => {
    const author = await makeResident(w);
    const reporter = await makeResident(w);
    const borrower = await makeResident(w);
    const post = await call('POST', '/posts', { as: author, body: { type: 'LEND', title: 'Cheap phones, cash only', body: 'Message me.' } });
    const id = post.data.id as string;
    await call('POST', `/posts/${id}/respond`, { as: borrower, body: {} });
    await report(id, reporter, { category: 'SPAM' });

    expect((await call('POST', `/admin/komuniti/posts/${id}/moderate`, { as: w.admin, body: { action: 'REMOVE' } })).status).toBe(400);
    const removed = await call('POST', `/admin/komuniti/posts/${id}/moderate`, { as: w.admin, body: { action: 'REMOVE', note: 'Selling is not allowed in Komuniti.' } });
    expect(removed.data.status).toBe('REMOVED');
    expect(await lastNotice(author)).toMatchObject({ title: 'Your post "Cheap phones, cash only" was removed', body: 'Selling is not allowed in Komuniti.' });
    expect((await lastNotice(reporter))!.title).toBe('Thank you: "Cheap phones, cash only" was removed');
    expect((await lastNotice(borrower))!.title).toBe('"Cheap phones, cash only" is no longer available');
    expect((await report(id, await makeResident(w))).status).toBe(404);

    const detail = (await call('GET', `/admin/komuniti/posts/${id}`, { as: w.hq })).data;
    expect(detail).toMatchObject({ status: 'REMOVED', moderation_note: 'Selling is not allowed in Komuniti.', author: { removed: 1, upheld_reports: 1 } });
    const all = (await call('GET', '/admin/komuniti/posts?status=REMOVED', { as: w.admin })).data.items.map((p: { id: string }) => p.id);
    expect(all).toContain(id);
  });

  it('lets township admins and HQ suspend a resident from Komuniti, but not township staff', async () => {
    const resident = await makeResident(w);
    const post = await call('POST', '/posts', { as: await makeResident(w), body: { type: 'HELP', title: 'Help with groceries', body: 'Two bags from the car.' } });
    const suspend = (as: Actor) => call('POST', `/admin/komuniti/suspensions/${resident.id}`, { as, body: { days: 7, reason: 'Repeated scam posts.' } });

    expect((await suspend(w.staff)).status).toBe(403);
    expect((await suspend(w.admin)).status).toBe(200);
    expect((await lastNotice(resident))!.title).toBe('You are suspended from Komuniti');
    expect((await call('POST', '/posts', { as: resident, body: { type: 'GIVE', title: 'Old sofa', body: 'Free to collect.' } })).error!.code).toBe('KOMUNITI_SUSPENDED');
    expect((await call('POST', `/posts/${post.data.id}/respond`, { as: resident, body: {} })).error!.code).toBe('KOMUNITI_SUSPENDED');
    expect((await call('GET', '/admin/komuniti/suspensions', { as: w.staff })).data.map((s: { user_id: string }) => s.user_id)).toContain(resident.id);

    expect((await call('POST', `/admin/komuniti/suspensions/${resident.id}/lift`, { as: w.hq, body: {} })).status).toBe(200);
    expect((await call('POST', `/posts/${post.data.id}/respond`, { as: resident, body: {} })).status).toBe(200);
    expect((await call('POST', `/admin/komuniti/suspensions/${resident.id}/lift`, { as: w.admin, body: {} })).status).toBe(404);

    // The suspension ends on its own.
    expect((await suspend(w.hq)).status).toBe(200);
    clock.now = new Date(T0.getTime() + 8 * 86_400_000);
    try {
      expect((await call('POST', '/posts', { as: resident, body: { type: 'GIVE', title: 'Old sofa', body: 'Free to collect.' } })).status).toBe(200);
    } finally {
      clock.now = T0;
    }
  });

  it('keeps each township admin to their own township, while HQ sees all of them or picks one', async () => {
    const other = await makeWorld(db);
    const post = await call('POST', '/posts', { as: await makeResident(other), body: { type: 'GIVE', title: 'Spare paint', body: 'Half a tin of white.' } });
    const id = post.data.id as string;
    await report(id, await makeResident(other), { category: 'UNSAFE' });

    expect(await queued(id, w.admin)).toBe(false);
    expect(await queued(id, other.admin)).toBe(true);
    expect(await queued(id, w.hq)).toBe(true);
    const picked = (await call('GET', `/admin/komuniti/reports?townshipId=${other.townshipId}`, { as: w.hq })).data;
    expect(picked.map((p: { id: string }) => p.id)).toEqual([id]);
    expect((await call('GET', `/admin/komuniti/reports?townshipId=${other.townshipId}`, { as: w.admin })).status).toBe(403);
    expect((await call('GET', `/admin/komuniti/posts/${id}`, { as: w.admin })).status).toBe(403);
    expect((await call('POST', `/admin/komuniti/posts/${id}/moderate`, { as: w.admin, body: { action: 'HIDE' } })).status).toBe(403);
    expect((await call('POST', `/admin/komuniti/posts/${id}/moderate`, { as: w.hq, body: { action: 'HIDE' } })).data.status).toBe('HIDDEN');
    expect((await call('GET', '/admin/komuniti/reports', { as: await makeResident(w) })).status).toBe(403);
  });
});

describe('Gerak and Kitar', () => {
  it('completes a loop when every checkpoint is scanned on the same day', async () => {
    await createLoop(db, w.staff, { name: 'Park Loop', description: 'Around the lake', mode: 'CYCLE', distanceM: 3_200, checkpoints: ['Lake gate', 'Boathouse'] });
    const loop = (await listLoopsForStaff(db, w.staff)).find((l) => (l as unknown as { name: string }).name === 'Park Loop') as unknown as { checkpoints: { code: string }[] };
    const [first, second] = loop.checkpoints.map((c) => c.code);
    const rider = await makeResident(w);

    const a = await call('POST', '/gerak/checkins', { as: rider, body: { code: first } });
    expect(a.data).toMatchObject({ loopCompleted: false, remaining: 1, reward: { xp: 5 } });
    expect((await call('POST', '/gerak/checkins', { as: rider, body: { code: first } })).error!.code).toBe('ALREADY_SCANNED');
    const b = await call('POST', '/gerak/checkins', { as: rider, body: { code: second } });
    expect(b.data).toMatchObject({ loopCompleted: true, reward: { xp: 45 } });
    expect((await call('GET', '/gerak', { as: rider })).data).toMatchObject({ monthMetres: 3_200, monthLoops: 1 });
    // Residents never see the codes.
    expect(JSON.stringify((await call('GET', '/gerak', { as: rider })).data)).not.toContain(first);
  });

  it('gives XP and sponsor-funded points for a kiosk drop-off, within the daily limit (BR6)', async () => {
    const sponsor = await makeSponsorUser(w);
    await makeCampaign(w, { sponsorId: sponsor.sponsorId, activity: 'KITAR_DROPOFF', rewardPoints: 300 });
    await createKiosk(db, w.staff, { name: 'Kiosk Central', location: 'Community hall' });
    const kiosk = await one<{ code: string }>(db, `SELECT code FROM kitar_kiosks WHERE name = 'Kiosk Central'`);
    const resident = await makeResident(w);
    const body = { kioskCode: kiosk!.code, material: 'PLASTIC_PET', weightG: 250 };

    const first = await call('POST', '/kitar/dropoffs', { as: resident, body });
    expect(first.data.reward).toMatchObject({ xp: 20, points: 300 });
    expect(first.data.reward.fundedBy[0]).toMatch(/^Sponsor/);
    await call('POST', '/kitar/dropoffs', { as: resident, body });
    const third = await call('POST', '/kitar/dropoffs', { as: resident, body });
    expect(third.error!.code).toBe('DAILY_LIMIT');
    expect((await call('GET', '/kitar', { as: resident })).data).toMatchObject({ monthGrams: 500, dropOffs: 2 });
    expect((await call('POST', '/kitar/dropoffs', { as: resident, body: { ...body, kioskCode: 'KWRONGCODE' } })).status).toBe(404);
    await expectFloatBalanced(db);
  });
});

describe('Banjir', () => {
  it('raises a warning at 75%, a danger alert at 90%, and puts the danger alert first (BR19)', async () => {
    const inZone = await makeResident(w);
    const zoneB = await one<{ id: string }>(db, `INSERT INTO flood_zones (township_id, name, safe_route, assembly_point) VALUES ($1, 'Zone B', 'Go east', 'School') RETURNING id`, [w.townshipId]);
    const homeB = await one<{ id: string }>(db, `INSERT INTO homes (township_id, zone_id, unit_code, street) VALUES ($1, $2, 'B-1', 'Jalan B') RETURNING id`, [w.townshipId, zoneB!.id]);
    const elsewhere = await makeResident(w, { homeId: homeB!.id });
    const setLevel = (levelPct: number) => call('POST', `/admin/banjir/zones/${w.zoneId}/level`, { as: w.staff, body: { levelPct } });

    expect((await call('POST', `/admin/banjir/zones/${w.zoneId}/level`, { as: inZone, body: { levelPct: 99 } })).status).toBe(403);
    expect((await setLevel(74)).data.status).toBe('NORMAL');
    expect((await setLevel(75)).data.status).toBe('WARNING');
    expect((await setLevel(89)).data).toMatchObject({ status: 'WARNING', changed: false });
    expect((await setLevel(90)).data).toMatchObject({ status: 'DANGER', changed: true });

    const alerts = await call('GET', '/alerts/active', { as: inZone });
    expect(alerts.data[0]).toMatchObject({ level: 'DANGER', zone_name: 'Zone A', safe_route: 'Take Jalan 1 north' });
    expect((await call('GET', '/alerts/active', { as: elsewhere })).data).toHaveLength(0);
    const inbox = await call('GET', '/notifications', { as: inZone });
    expect(inbox.data.items[0]).toMatchObject({ priority: 'URGENT', title: 'Flood danger in Zone A' });

    expect((await setLevel(40)).data.status).toBe('NORMAL');
    expect((await call('GET', '/alerts/active', { as: inZone })).data).toHaveLength(0);
  });

  it('accepts sensor readings only with the ingest token', async () => {
    const body = { zoneId: w.zoneId, levelPct: 10 };
    expect((await call('POST', '/ingest/flood', { body, origin: null })).status).toBe(401);
    expect((await call('POST', '/ingest/flood', { body, origin: null, bearer: 'wrong-token-wrong-token-wrong-token-000' })).status).toBe(401);
    expect((await call('POST', '/ingest/flood', { body, origin: null, bearer: process.env.SENSOR_INGEST_TOKEN })).status).toBe(200);
  });
});

describe('insights, jobs and personal data', () => {
  it('shows staff township totals with the float matched to the sen (BR9)', async () => {
    const res = await call('GET', '/insights', { as: w.staff });
    expect(res.status).toBe(200);
    const f = res.data.float;
    expect(f.trustSen).toBe(f.walletsSen + f.payablesSen + f.poolsSen + f.communitySen);
    expect(res.data.planet.recycled_g).toBeGreaterThan(0);
    expect(res.data.daily).toHaveLength(14);
    // Only features in use today: archived Taman and Jimat activities are not reported.
    const archived = (await db.query<{ label: string }>(`SELECT label FROM activity_rules WHERE activity IN ('TAMAN_WATERING', 'TAMAN_SIGHTING', 'JIMAT_READING', 'JIMAT_SAVER')`)).map((r) => r.label);
    expect(archived.length).toBeGreaterThan(0);
    for (const label of archived) expect((res.data.byActivity as { label: string }[]).map((a) => a.label)).not.toContain(label);
    expect((res.data.byActivity as { label: string }[]).map((a) => a.label)).toContain('Access report or place confirmed');
    // Accessibility comes from Akses+, and practice drop-offs never count.
    for (const k of ['access_resolved', 'access_on_time', 'access_open', 'access_places', 'access_verified', 'access_blocked']) expect(typeof res.data.smart[k]).toBe('number');
    const live = await one<{ g: number }>(db, `SELECT coalesce(sum(d.weight_g), 0)::int AS g FROM kitar_dropoffs d JOIN kitar_kiosks k ON k.id = d.kiosk_id
      WHERE d.source = 'LIVE' AND k.township_id = $1 AND d.created_at >= $2::timestamptz - interval '30 days'`, [w.townshipId, clock.now]);
    expect(res.data.planet.recycled_g).toBe(live!.g);
  });

  it('runs scheduled jobs only with the cron token', async () => {
    expect((await call('POST', '/internal/jobs/float-check', { origin: null })).status).toBe(401);
    const ok = await call('POST', '/internal/jobs/float-check', { origin: null, bearer: process.env.CRON_SECRET });
    expect(ok.data).toEqual({ ok: true, issues: [] });
    expect((await call('POST', '/internal/jobs/settle', { origin: null, bearer: process.env.CRON_SECRET })).status).toBe(200);
    expect((await call('POST', '/internal/jobs/cleanup', { origin: null, bearer: process.env.CRON_SECRET })).status).toBe(200);
    expect((await call('POST', '/internal/jobs/expire-points', { origin: null, bearer: process.env.CRON_SECRET })).status).toBe(200);
    expect((await call('POST', '/internal/jobs/unknown', { origin: null, bearer: process.env.CRON_SECRET })).status).toBe(404);
  });

  it('lets a resident download their data and delete their account (BR18)', async () => {
    const shop = await makeMerchant(w, 10_000);
    const resident = await makeResident(w);
    await db.query('UPDATE users SET password_hash = $2, email = $3 WHERE id = $1', [resident.id, await hashPassword('leaving-kita-plus-1'), 'leaver@kita.test']);
    await sell(w, shop, resident, 5_000);
    const photoPost = new FormData();
    photoPost.set('type', 'GIVE');
    photoPost.set('title', 'Old bookshelf');
    photoPost.set('body', 'Free to collect.');
    photoPost.set('photo', new File([PNG], 'shelf.png', { type: 'image/png' }));
    const postId = (await call('POST', '/posts/with-photo', { as: resident, form: photoPost })).data.id as string;

    const exported = await call('GET', '/me/export', { as: resident });
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-disposition')).toMatch(/attachment/);
    expect(exported.json.account.email).toBe('leaver@kita.test');
    expect(exported.json.sales).toHaveLength(1);

    expect((await call('POST', '/me/delete', { as: resident, body: { password: 'not-my-password' } })).error!.code).toBe('WRONG_PASSWORD');
    expect((await call('POST', '/me/delete', { as: resident, body: { password: 'leaving-kita-plus-1' } })).status).toBe(200);
    expect((await call('GET', '/me', { as: resident })).status).toBe(401);
    expect((await call('POST', '/auth/login', { body: { email: 'leaver@kita.test', password: 'leaving-kita-plus-1' } })).status).toBe(401);

    const row = await one<{ full_name: string; email: string }>(db, 'SELECT full_name, email FROM users WHERE id = $1', [resident.id]);
    expect(row).toMatchObject({ full_name: 'Deleted user' });
    expect(row!.email).not.toContain('leaver');
    // A post's photo goes with the rest of their uploads.
    expect(await one(db, 'SELECT photo_id FROM posts WHERE id = $1', [postId])).toMatchObject({ photo_id: null });
    expect((await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM uploads WHERE owner_id = $1', [resident.id]))!.n).toBe(0);
    expect(await walletOf(db, resident)).toBe(0); // unused points went back to the shop that funded them
    await expectFloatBalanced(db);
  });

  it('expires nothing early when the daily job runs', async () => {
    const res = await call('POST', '/internal/jobs/expire-points', { origin: null, bearer: process.env.CRON_SECRET });
    expect(res.data.points).toBe(0);
  });
});
