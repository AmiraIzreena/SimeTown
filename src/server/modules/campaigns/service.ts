import type { Activity } from '@/shared/domain';
import { one, type Db, type Queryable } from '../../db/client';
import { assertTownshipAccess, type Actor } from '../../auth/actor';
import { conflict, forbidden, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { createAccount, credit, debit, getAccount, postTxn, systemAccounts } from '../ledger/ledger';
import { getSettings } from '../settings';
import { resolveTownship } from '../townships';

/** SimeTown Partner Hub: challenges with a fixed, prefunded reward pool. */

export interface CampaignInput {
  townshipId?: string;
  sponsorId: string | null;
  title: string;
  description: string;
  activity: Activity;
  goalMetric: 'COUNT' | 'QUANTITY';
  goalTarget: number;
  rewardPoints: number;
  perPersonCap: number;
  budgetSen: number;
  poolBps: number;
  feeBps: number;
  costsBps: number;
  startsAt: Date;
  endsAt: Date;
}

export async function createCampaign(db: Db, actor: Actor, input: CampaignInput) {
  return db.tx(async (tx) => {
    const townshipId = await resolveTownship(tx, actor, input.townshipId);
    if (input.sponsorId && !(await one(tx, 'SELECT 1 FROM sponsors WHERE id = $1', [input.sponsorId]))) {
      throw notFound('Sponsor');
    }
    const poolSen = Math.floor((input.budgetSen * input.poolBps) / 10_000);
    if (poolSen < input.rewardPoints) {
      throw ruleViolation('POOL_TOO_SMALL', 'The reward pool would not cover even one reward.');
    }
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO campaigns (township_id, sponsor_id, title, description, activity, goal_metric, goal_target, reward_points,
                              per_person_cap, budget_sen, pool_bps, fee_bps, costs_bps, starts_at, ends_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
      [
        townshipId, input.sponsorId, input.title, input.description, input.activity, input.goalMetric, input.goalTarget,
        input.rewardPoints, input.perPersonCap, input.budgetSen, input.poolBps, input.feeBps, input.costsBps,
        input.startsAt, input.endsAt, actor.id,
      ],
    );
    await createAccount(tx, 'FUNDER_POOL', { campaignId: row!.id });
    await audit(tx, actor.id, 'CAMPAIGN_CREATED', 'campaign', row!.id, { title: input.title, budgetSen: input.budgetSen });
    return { id: row!.id };
  });
}

interface CampaignRow {
  id: string;
  township_id: string;
  sponsor_id: string | null;
  title: string;
  status: 'DRAFT' | 'FUNDED' | 'CLOSED';
  budget_sen: number;
  pool_bps: number;
  fee_bps: number;
  ends_at: Date;
}

async function lockCampaign(tx: Queryable, actor: Actor, id: string): Promise<CampaignRow> {
  const c = await one<CampaignRow>(
    tx,
    'SELECT id, township_id, sponsor_id, title, status, budget_sen, pool_bps, fee_bps, ends_at FROM campaigns WHERE id = $1 FOR UPDATE',
    [id],
  );
  if (!c) throw notFound('Campaign');
  assertTownshipAccess(actor, c.township_id);
  return c;
}

/**
 * Records that the funder's money has arrived. The reward pool goes into the
 * ring-fenced float; the platform fee and running costs go to SimeTown's own
 * account. Nothing can be awarded before this step (BR8).
 */
export async function fundCampaign(db: Db, actor: Actor, id: string, bankRef: string, now: Date) {
  return db.tx(async (tx) => {
    const c = await lockCampaign(tx, actor, id);
    if (c.status !== 'DRAFT') throw conflict('ALREADY_FUNDED', 'This campaign has already been funded.');
    if (await one(tx, 'SELECT 1 FROM deposits WHERE bank_ref = $1', [bankRef])) {
      throw conflict('DUPLICATE_BANK_REF', 'A deposit with this bank reference is already recorded.');
    }
    const poolSen = Math.floor((c.budget_sen * c.pool_bps) / 10_000);
    const feeSen = Math.floor((c.budget_sen * c.fee_bps) / 10_000);
    const costsSen = c.budget_sen - poolSen - feeSen;
    const sys = await systemAccounts(tx);
    const pool = await getAccount(tx, 'FUNDER_POOL', { campaignId: id }, true);
    const txnId = await postTxn(tx, {
      kind: 'CAMPAIGN_FUND',
      label: `Campaign funded · ${c.title}`,
      refType: 'campaign',
      refId: id,
      actorId: actor.id,
      at: now,
      entries: [
        debit(sys.TRUST_BANK, poolSen),
        credit(pool.id, poolSen),
        debit(sys.OPERATING_BANK, feeSen + costsSen),
        credit(sys.REVENUE_CAMPAIGN_FEE, feeSen),
        credit(sys.REVENUE_CAMPAIGN_COSTS, costsSen),
      ],
    });
    await tx.query(
      'INSERT INTO deposits (campaign_id, amount_sen, bank_ref, txn_id, recorded_by, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, c.budget_sen, bankRef, txnId, actor.id, now],
    );
    await tx.query(`UPDATE campaigns SET status = 'FUNDED', funded_at = $2 WHERE id = $1`, [id, now]);
    await audit(tx, actor.id, 'CAMPAIGN_FUNDED', 'campaign', id, { poolSen, feeSen, costsSen, bankRef });
    return { poolSen, feeSen, costsSen };
  });
}

/** Ends a campaign and refunds whatever was never given out to the funder (BR10). */
export async function closeCampaign(db: Db, actor: Actor, id: string, now: Date) {
  return db.tx(async (tx) => {
    const c = await lockCampaign(tx, actor, id);
    if (c.status === 'CLOSED') throw conflict('ALREADY_CLOSED', 'This campaign is already closed.');
    let refundSen = 0;
    if (c.status === 'FUNDED') {
      const pool = await getAccount(tx, 'FUNDER_POOL', { campaignId: id }, true);
      refundSen = pool.balance;
      if (refundSen > 0) {
        await postTxn(tx, {
          kind: 'CAMPAIGN_REFUND',
          label: `Unused pool refunded · ${c.title}`,
          refType: 'campaign',
          refId: id,
          actorId: actor.id,
          at: now,
          entries: [debit(pool.id, refundSen), credit((await systemAccounts(tx)).TRUST_BANK, refundSen)],
        });
      }
    }
    await tx.query(`UPDATE campaigns SET status = 'CLOSED', closed_at = $2, refunded_sen = $3 WHERE id = $1`, [id, now, refundSen]);
    await audit(tx, actor.id, 'CAMPAIGN_CLOSED', 'campaign', id, { refundSen });
    return { refundSen };
  });
}

const CAMPAIGN_LIST = `
  SELECT c.id, c.title, c.description, c.activity, c.goal_metric, c.goal_target, c.reward_points, c.per_person_cap,
         c.budget_sen, c.pool_bps, c.fee_bps, c.costs_bps, c.starts_at, c.ends_at, c.status, c.refunded_sen,
         coalesce(s.name, 'Sime Darby Property') AS funder, r.quantity_unit,
         CASE WHEN c.status = 'FUNDED' AND c.starts_at <= $1 AND c.ends_at > $1 THEN true ELSE false END AS live,
         coalesce(a.balance, 0) AS pool_left_sen
    FROM campaigns c
    JOIN activity_rules r ON r.activity = c.activity
    LEFT JOIN sponsors s ON s.id = c.sponsor_id
    LEFT JOIN ledger_accounts a ON a.campaign_id = c.id AND a.kind = 'FUNDER_POOL'`;

/**
 * The public Challenges page: every live, funded challenge and every action
 * that earns Impact XP. Titles, rewards and funders only: no budgets, pools or
 * anything about a person.
 */
export async function publicChallenges(db: Db, now: Date) {
  const challenges = await db.query(
    `SELECT c.id, c.title, c.description, c.activity, r.label AS activity_label, c.goal_metric, c.goal_target, r.quantity_unit,
            c.reward_points, c.per_person_cap, c.ends_at, coalesce(s.name, 'Sime Darby Property') AS funder, t.name AS township
       FROM campaigns c
       JOIN activity_rules r ON r.activity = c.activity
       JOIN townships t ON t.id = c.township_id
       LEFT JOIN sponsors s ON s.id = c.sponsor_id
      WHERE c.status = 'FUNDED' AND c.starts_at <= $1 AND c.ends_at > $1
        AND c.activity NOT IN ('TAMAN_WATERING', 'TAMAN_SIGHTING')
      ORDER BY c.ends_at`,
    [now],
  );
  const everyday = await db.query(
    `SELECT activity, label, xp, quantity_unit, daily_cap_person, offer_points, offer_per_quantity
       FROM activity_rules WHERE xp > 0 AND activity NOT IN ('TAMAN_WATERING', 'TAMAN_SIGHTING') ORDER BY xp DESC, label`,
  );
  return { challenges, everyday };
}

/**
 * Residents see live campaigns in their township with their own progress.
 * Sponsors see only their own. Staff see their township's; HQ sees all.
 */
export async function listCampaigns(db: Db, actor: Actor, now: Date) {
  if (actor.role === 'RESIDENT') {
    return db.query(
      `SELECT x.*,
              (SELECT coalesce(CASE x.goal_metric WHEN 'COUNT' THEN count(*) ELSE sum(e.quantity) END, 0)::int
                 FROM xp_events e
                WHERE e.user_id = $3 AND e.activity = x.activity AND e.created_at >= x.starts_at AND e.created_at < x.ends_at) AS my_progress,
              (SELECT count(*)::int FROM campaign_awards w WHERE w.campaign_id = x.id AND w.user_id = $3) AS my_rewards
         FROM (${CAMPAIGN_LIST} WHERE c.township_id = $2 AND c.status = 'FUNDED' AND c.starts_at <= $1 AND c.ends_at > $1
           AND c.activity NOT IN ('TAMAN_WATERING', 'TAMAN_SIGHTING')) x
        ORDER BY x.ends_at`,
      [now, actor.townshipId, actor.id],
    );
  }
  if (actor.role === 'SPONSOR') {
    return db.query(`${CAMPAIGN_LIST} WHERE c.sponsor_id = $2 AND c.status <> 'DRAFT' ORDER BY c.starts_at DESC`, [now, actor.sponsorId]);
  }
  return db.query(`${CAMPAIGN_LIST} WHERE ($2::uuid IS NULL OR c.township_id = $2) ORDER BY c.created_at DESC`, [now, actor.townshipId]);
}

/**
 * Results for one campaign: totals only, never a list of people (BR16). A
 * sponsor gets no numbers at all until enough residents have taken part that
 * no one could be singled out.
 */
export async function campaignReport(db: Db, actor: Actor, id: string, now: Date) {
  const c = await one<{ id: string; township_id: string; sponsor_id: string | null } & Record<string, unknown>>(
    db,
    `SELECT x.*, c.township_id, c.sponsor_id FROM (${CAMPAIGN_LIST}) x JOIN campaigns c ON c.id = x.id WHERE x.id = $2`,
    [now, id],
  );
  if (!c) throw notFound('Campaign');
  if (actor.role === 'SPONSOR') {
    // A sponsor asking for someone else's campaign gets "not found", not "forbidden", so ids cannot be probed.
    if (c.sponsor_id !== actor.sponsorId) throw notFound('Campaign');
  } else if (actor.role === 'TOWNSHIP_STAFF' || actor.role === 'TOWNSHIP_ADMIN' || actor.role === 'HQ_ADMIN') {
    assertTownshipAccess(actor, c.township_id);
  } else {
    throw forbidden();
  }

  const totals = await one<{ participants: number; rewards: number; issued: number; spent: number; held: number }>(
    db,
    `SELECT (SELECT count(DISTINCT user_id)::int FROM campaign_awards WHERE campaign_id = $1) AS participants,
            (SELECT count(*)::int FROM campaign_awards WHERE campaign_id = $1) AS rewards,
            coalesce(sum(l.amount), 0)::int AS issued,
            coalesce(sum(l.redeemed), 0)::int AS spent,
            coalesce(sum(l.remaining), 0)::int AS held
       FROM point_lots l JOIN ledger_accounts a ON a.id = l.funder_account_id
      WHERE a.campaign_id = $1`,
    [id],
  );
  const minGroup = (await getSettings(db)).min_group_size;
  const suppressed = actor.role === 'SPONSOR' && totals!.participants < minGroup;
  return {
    campaign: c,
    suppressed,
    minGroupSize: minGroup,
    results: suppressed
      ? null
      : {
          participants: totals!.participants,
          rewardsGiven: totals!.rewards,
          pointsIssued: totals!.issued,
          pointsSpentAtShops: totals!.spent,
          pointsStillHeld: totals!.held,
          pointsExpiredOrReturned: totals!.issued - totals!.spent - totals!.held,
        },
  };
}

// --- Sponsors ---------------------------------------------------------------

export async function listSponsors(q: Queryable) {
  return q.query('SELECT id, name, created_at FROM sponsors ORDER BY name');
}

export async function createSponsor(db: Db, actor: Actor, name: string) {
  return db.tx(async (tx) => {
    if (await one(tx, 'SELECT 1 FROM sponsors WHERE lower(name) = lower($1)', [name])) {
      throw conflict('SPONSOR_EXISTS', 'A sponsor with this name already exists.');
    }
    const row = await one<{ id: string }>(tx, 'INSERT INTO sponsors (name) VALUES ($1) RETURNING id', [name]);
    await audit(tx, actor.id, 'SPONSOR_CREATED', 'sponsor', row!.id, { name });
    return { id: row!.id, name };
  });
}
