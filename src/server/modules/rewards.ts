import type { Activity } from '@/shared/domain';
import { one, type Queryable } from '../db/client';
import { earnAllowance, issueFromPool } from './ledger/points';
import { getAccount } from './ledger/ledger';
import { giveOfferPoints, offerPointsFor } from './offers/service';
import { getSettings, startOf, type Settings } from './settings';

/**
 * The single door between "a resident did something good" and rewards.
 * Every People and Planet feature calls `recordAction` once its own check has
 * passed. It gives Impact XP (BR4), applies the limits (BR6) and then gives
 * SimeTown Points only where a funded campaign covers the action.
 */

export interface RewardUser {
  id: string;
  homeId: string;
  townshipId: string;
}

export interface ActionReward {
  xp: number;
  /** Cash-backed points from a funded campaign. */
  points: number;
  /** Offer-backed points, backed by what shops pledged this month (BR29). */
  offerPoints: number;
  /** Who paid for the points, so the screen can say so. */
  fundedBy: string[];
  /** Why no XP was given, if none was. */
  skipped?: 'DAILY_LIMIT' | 'MONTHLY_LIMIT' | 'ALREADY_COUNTED';
}

interface ActionInput {
  user: RewardUser;
  activity: Activity;
  /** Identifies the verified thing (a drop-off id, a report id …) so it can never count twice. */
  ref: string;
  /** Grams for Kitar, metres for Gerak loops; 1 otherwise. */
  quantity?: number;
  now: Date;
  /**
   * The action was checked by something stronger than the resident's own word (a signed
   * machine record, a tracked trip, a read bill), so it may earn
   * offer-backed points. Off by default.
   */
  offerEligible?: boolean;
  /** Impact XP only, never points: a guest recycling session claimed later (BR23). */
  xpOnly?: boolean;
  /** What the action is worth in offer-backed points, when the feature works it out itself (Kitar bins, per material). */
  offerWorth?: number;
}

export async function recordAction(tx: Queryable, input: ActionInput): Promise<ActionReward> {
  const { user, activity, now } = input;
  const settings = await getSettings(tx);
  const rule = (await one<{ xp: number; label: string; daily_cap_person: number; monthly_cap_home: number; offer_points: number; offer_per_quantity: number | null }>(
    tx,
    'SELECT xp, label, daily_cap_person, monthly_cap_home, offer_points, offer_per_quantity FROM activity_rules WHERE activity = $1',
    [activity],
  ))!;

  // Lock the home so limits hold when two household members act at once.
  await tx.query('SELECT id FROM homes WHERE id = $1 FOR UPDATE', [user.homeId]);
  const used = await one<{ today: number; month_home: number }>(
    tx,
    `SELECT count(*) FILTER (WHERE e.user_id = $1 AND e.created_at >= ${startOf('day', '$4', '$5')})::int AS today,
            count(*)::int AS month_home
       FROM xp_events e JOIN users u ON u.id = e.user_id
      WHERE u.home_id = $2 AND e.activity = $3 AND e.created_at >= ${startOf('month', '$4', '$5')}`,
    [user.id, user.homeId, activity, now, settings.timezone],
  );
  if (used!.today >= rule.daily_cap_person) return { xp: 0, points: 0, offerPoints: 0, fundedBy: [], skipped: 'DAILY_LIMIT' };
  if (used!.month_home >= rule.monthly_cap_home) return { xp: 0, points: 0, offerPoints: 0, fundedBy: [], skipped: 'MONTHLY_LIMIT' };

  const inserted = await tx.query(
    `INSERT INTO xp_events (user_id, activity, ref, xp, quantity, created_at) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, activity, ref) DO NOTHING RETURNING id`,
    [user.id, activity, input.ref, rule.xp, input.quantity ?? 1, now],
  );
  if (inserted.length === 0) return { xp: 0, points: 0, offerPoints: 0, fundedBy: [], skipped: 'ALREADY_COUNTED' };
  await tx.query('UPDATE users SET xp_total = xp_total + $2 WHERE id = $1', [user.id, rule.xp]);

  if (input.xpOnly) return { xp: rule.xp, points: 0, offerPoints: 0, fundedBy: [] };
  const awards = await awardCampaigns(tx, user, activity, now, settings);
  const offerPoints = input.offerEligible
    ? await giveOfferPoints(tx, {
        userId: user.id,
        homeId: user.homeId,
        townshipId: user.townshipId,
        points: input.offerWorth ?? offerPointsFor(rule, input.quantity ?? 1),
        ref: `${activity}:${input.ref}`,
        label: `${rule.label} · backed by township shop offers`,
        now,
        settings,
      })
    : 0;
  return { xp: rule.xp, points: awards.reduce((sum, a) => sum + a.points, 0), offerPoints, fundedBy: awards.map((a) => a.fundedBy) };
}

interface LiveCampaign {
  id: string;
  title: string;
  funder: string;
  goal_metric: 'COUNT' | 'QUANTITY';
  goal_target: number;
  reward_points: number;
  per_person_cap: number;
  starts_at: Date;
  ends_at: Date;
}

/**
 * Gives campaign points the resident has become entitled to. A reward is due
 * each time their verified total inside the campaign window passes another
 * multiple of the goal, up to the per-person cap, and only while the campaign's
 * prefunded pool can pay for it: no pool, no points (BR4, BR8).
 */
async function awardCampaigns(
  tx: Queryable,
  user: RewardUser,
  activity: Activity,
  now: Date,
  settings: Settings,
): Promise<{ points: number; fundedBy: string }[]> {
  if (settings.issuance_paused) return [];
  const campaigns = await tx.query<LiveCampaign>(
    `SELECT c.id, c.title, coalesce(s.name, 'Sime Darby Property') AS funder,
            c.goal_metric, c.goal_target, c.reward_points, c.per_person_cap, c.starts_at, c.ends_at
       FROM campaigns c LEFT JOIN sponsors s ON s.id = c.sponsor_id
      WHERE c.township_id = $1 AND c.activity = $2 AND c.status = 'FUNDED' AND c.starts_at <= $3 AND c.ends_at > $3
      ORDER BY c.created_at`,
    [user.townshipId, activity, now],
  );
  const given: { points: number; fundedBy: string }[] = [];
  for (const c of campaigns) {
    const progress = await one<{ total: number; awarded: number }>(
      tx,
      `SELECT (SELECT coalesce(${c.goal_metric === 'COUNT' ? 'count(*)' : 'sum(quantity)'}, 0)::int FROM xp_events
                WHERE user_id = $1 AND activity = $2 AND created_at >= $3 AND created_at < $4) AS total,
              (SELECT count(*)::int FROM campaign_awards WHERE campaign_id = $5 AND user_id = $1) AS awarded`,
      [user.id, activity, c.starts_at, c.ends_at, c.id],
    );
    const due = Math.min(Math.floor(progress!.total / c.goal_target), c.per_person_cap);
    const pool = await getAccount(tx, 'FUNDER_POOL', { campaignId: c.id }, true);
    let poolLeft = pool.balance;
    for (let seq = progress!.awarded + 1; seq <= due; seq++) {
      if (poolLeft < c.reward_points) break;
      if ((await earnAllowance(tx, user, now, settings)) < c.reward_points) break;
      const txnId = await issueFromPool(tx, {
        userId: user.id,
        poolAccountId: pool.id,
        points: c.reward_points,
        feeSen: 0, // sponsors pay the platform fee up front, when the campaign is funded
        source: 'CAMPAIGN',
        label: `${c.title} · funded by ${c.funder}`,
        refType: 'campaign',
        refId: c.id,
        now,
        settings,
      });
      await tx.query(
        'INSERT INTO campaign_awards (campaign_id, user_id, seq, points, txn_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [c.id, user.id, seq, c.reward_points, txnId, now],
      );
      poolLeft -= c.reward_points;
      given.push({ points: c.reward_points, fundedBy: c.funder });
    }
  }
  return given;
}

/** Adds up the rewards of several actions recorded together, for one message on screen. */
export function sumRewards(rewards: ActionReward[]): ActionReward {
  return {
    xp: rewards.reduce((sum, r) => sum + r.xp, 0),
    points: rewards.reduce((sum, r) => sum + r.points, 0),
    offerPoints: rewards.reduce((sum, r) => sum + r.offerPoints, 0),
    fundedBy: rewards.flatMap((r) => r.fundedBy),
  };
}

/** Loads what `recordAction` needs for someone other than the signed-in person (for example a report's author). */
export async function rewardUserById(q: Queryable, userId: string): Promise<RewardUser | undefined> {
  const row = await one<{ id: string; home_id: string; township_id: string }>(
    q,
    `SELECT id, home_id, township_id FROM users
      WHERE id = $1 AND role = 'RESIDENT' AND residency_status = 'VERIFIED' AND status = 'ACTIVE'`,
    [userId],
  );
  return row && { id: row.id, homeId: row.home_id, townshipId: row.township_id };
}
