import { randomUUID } from 'node:crypto';
import type { Role } from '@/shared/domain';
import type { Photo } from '@/server/ai/classifier';
import type { Actor } from '@/server/auth/actor';
import { ACTOR_COLUMNS, toActor } from '@/server/auth/session';
import { createDb, one, type Db } from '@/server/db/client';
import { migrate } from '@/server/db/migrate';
import { closeCampaign, createCampaign, fundCampaign, type CampaignInput } from '@/server/modules/campaigns/service';
import { randomCode } from '@/server/modules/identity/service';
import { createAccount } from '@/server/modules/ledger/ledger';
import { floatPosition, recordMerchantDeposit } from '@/server/modules/ledger/finance';
import { setMerchantStatus } from '@/server/modules/merchant/admin';
import { createSale, decideSale, type SaleView } from '@/server/modules/merchant/service';

/**
 * A fresh, migrated database per test file: in-process PostgreSQL by default,
 * or a real server when TEST_DATABASE_URL is set (the schema is reset first).
 */
export async function freshDb(): Promise<Db> {
  const url = process.env.DATABASE_URL!;
  const db = await createDb(url);
  if (!url.startsWith('pglite:')) await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db);
  return db;
}

export const T0 = new Date('2026-11-02T04:00:00Z'); // Monday noon in Kuala Lumpur
export const at = (days: number, from: Date = T0) => new Date(from.getTime() + days * 86_400_000);

export interface World {
  db: Db;
  townshipId: string;
  zoneId: string;
  admin: Actor;
  admin2: Actor;
  staff: Actor;
  hq: Actor;
}

let counter = 0;
const next = () => ++counter;

async function insertUser(db: Db, role: Role, fields: Record<string, unknown>): Promise<Actor> {
  const n = next();
  const values: Record<string, unknown> = { email: `user${n}@kita.test`, full_name: `Test ${role} ${n}`, role, ...fields };
  const keys = Object.keys(values);
  const row = await one<Parameters<typeof toActor>[0]>(
    db,
    `INSERT INTO users AS u (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING ${ACTOR_COLUMNS}`,
    Object.values(values),
  );
  return toActor(row!);
}

export async function makeWorld(db?: Db): Promise<World> {
  db ??= await freshDb();
  const township = await one<{ id: string }>(db, `INSERT INTO townships (name) VALUES ($1) RETURNING id`, [`Township ${next()}`]);
  const townshipId = township!.id;
  const zone = await one<{ id: string }>(
    db,
    `INSERT INTO flood_zones (township_id, name, safe_route, assembly_point) VALUES ($1, 'Zone A', 'Take Jalan 1 north', 'Community hall') RETURNING id`,
    [townshipId],
  );
  return {
    db,
    townshipId,
    zoneId: zone!.id,
    admin: await insertUser(db, 'TOWNSHIP_ADMIN', { township_id: townshipId }),
    admin2: await insertUser(db, 'TOWNSHIP_ADMIN', { township_id: townshipId }),
    staff: await insertUser(db, 'TOWNSHIP_STAFF', { township_id: townshipId }),
    hq: await insertUser(db, 'HQ_ADMIN', {}),
  };
}

/** A home with a full postal address, as the property record holds it. */
export async function makeHome(w: World, street = 'Jalan Satu', precinct = 'Precinct 1'): Promise<string> {
  const n = next();
  const home = await one<{ id: string }>(
    w.db,
    `INSERT INTO homes (township_id, zone_id, unit_code, street, precinct, house_no, postcode, city, state)
     VALUES ($1, $2, $3, $4, $5, $6, '41050', 'Klang', 'Selangor') RETURNING id`,
    [w.townshipId, w.zoneId, `U-${n}`, street, precinct, String(n)],
  );
  return home!.id;
}

/** A resident with a wallet. Verified unless told otherwise. */
export async function makeResident(w: World, opts: { homeId?: string; status?: Actor['residencyStatus']; occupancy?: 'OWNER' | 'TENANT' } = {}): Promise<Actor> {
  const actor = await insertUser(w.db, 'RESIDENT', {
    township_id: w.townshipId,
    home_id: opts.homeId ?? (await makeHome(w)),
    occupancy: opts.occupancy ?? 'OWNER',
    residency_status: opts.status ?? 'VERIFIED',
    member_code: randomCode(8),
  });
  await createAccount(w.db, 'WALLET', { userId: actor.id });
  return actor;
}

/** An approved shop with a cashier login and, optionally, money in its reward pool. */
export async function makeMerchant(w: World, poolSen = 0): Promise<Actor> {
  const n = next();
  const merchant = await one<{ id: string }>(
    w.db,
    `INSERT INTO merchants (township_id, name, registration_no, category) VALUES ($1, $2, $3, 'Food') RETURNING id`,
    [w.townshipId, `Kedai ${n}`, `REG-${n}`],
  );
  await setMerchantStatus(w.db, w.admin, merchant!.id, 'ACTIVE', T0);
  if (poolSen > 0) await recordMerchantDeposit(w.db, w.admin, merchant!.id, { amountSen: poolSen, bankRef: `BANK-${n}` }, T0);
  return insertUser(w.db, 'MERCHANT', { township_id: w.townshipId, merchant_id: merchant!.id });
}

export async function makeSponsorUser(w: World): Promise<Actor> {
  const sponsor = await one<{ id: string }>(w.db, 'INSERT INTO sponsors (name) VALUES ($1) RETURNING id', [`Sponsor ${next()}`]);
  return insertUser(w.db, 'SPONSOR', { sponsor_id: sponsor!.id });
}

export async function makeCampaign(w: World, overrides: Partial<CampaignInput> = {}, fund = true): Promise<string> {
  const { id } = await createCampaign(w.db, w.admin, {
    sponsorId: null,
    title: `Campaign ${next()}`,
    description: 'Test campaign',
    activity: 'KITAR_DROPOFF',
    goalMetric: 'COUNT',
    goalTarget: 1,
    rewardPoints: 300,
    perPersonCap: 1,
    budgetSen: 2_000_000,
    poolBps: 6000,
    feeBps: 2500,
    costsBps: 1500,
    startsAt: at(-1),
    endsAt: at(30),
    ...overrides,
  });
  if (fund) await fundCampaign(w.db, w.admin, id, `CAMP-${next()}`, T0);
  return id;
}
export { closeCampaign };

/** A cash sale: completes at once. */
export function sell(w: World, shop: Actor, member: Actor, billSen: number, now: Date = T0): Promise<SaleView> {
  return createSale(w.db, shop, { memberCode: member.memberCode!, billSen, redeemPoints: 0, idempotencyKey: randomUUID() }, now);
}

/** A sale part-paid with points: the cashier asks, the resident confirms on their phone. */
export async function sellWithPoints(w: World, shop: Actor, member: Actor, billSen: number, redeemPoints: number, now: Date = T0): Promise<SaleView> {
  const pending = await createSale(w.db, shop, { memberCode: member.memberCode!, billSen, redeemPoints, idempotencyKey: randomUUID() }, now);
  return decideSale(w.db, member, pending.id, true, now);
}

export async function balanceOf(db: Db, kind: string, owner: { merchantId?: string | null; campaignId?: string; userId?: string } = {}): Promise<number> {
  const row = await one<{ balance: number }>(
    db,
    `SELECT balance FROM ledger_accounts WHERE kind = $1 AND merchant_id IS NOT DISTINCT FROM $2
        AND campaign_id IS NOT DISTINCT FROM $3 AND user_id IS NOT DISTINCT FROM $4`,
    [kind, owner.merchantId ?? null, owner.campaignId ?? null, owner.userId ?? null],
  );
  return row?.balance ?? 0;
}

export const walletOf = (db: Db, user: Actor) => balanceOf(db, 'WALLET', { userId: user.id });

/** BR9, to the sen: the float equals everything it owes, and the batches add up to the wallets. */
export async function expectFloatBalanced(db: Db): Promise<void> {
  const p = await floatPosition(db);
  if (p.trustSen !== p.walletsSen + p.payablesSen + p.poolsSen + p.communitySen) {
    throw new Error(`Float out of balance: ${JSON.stringify(p)}`);
  }
  if (p.lotsSen !== p.walletsSen) throw new Error(`Lots do not match wallets: ${JSON.stringify(p)}`);
}

/** A report photo as the server stores it (Lapor needs one on every new report). */
export const REPORT_PHOTO: Photo = { mime: 'image/jpeg', bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]) };

/** A real JPEG for upload tests, big enough for a report photo (at least 400 px on its longer side). */
export async function reportPhotoFile(width = 640, height = 480): Promise<File> {
  const { default: sharp } = await import('sharp');
  const bytes = await sharp({ create: { width, height, channels: 3, background: { r: 120, g: 120, b: 110 } } }).jpeg().toBuffer();
  return new File([new Uint8Array(bytes)], 'photo.jpg', { type: 'image/jpeg' });
}
