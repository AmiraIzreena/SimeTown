import { levelFor, type Activity } from '@/shared/domain';
import { one, type Db } from '../../db/client';
import { townshipOf, type Actor } from '../../auth/actor';
import { decodeCursor, toPage, type PageQuery } from '../../http/pagination';
import { pendingForResident } from '../merchant/service';
import { getSettings, startOf } from '../settings';

/** Points & XP: the resident's balance, history, level, badges and street league. */

const BADGES: { id: string; label: string; hint: string; activity?: Activity; need: number }[] = [
  { id: 'first-step', label: 'First Step', hint: 'Complete any verified action', need: 1 },
  { id: 'recycler', label: 'Recycler', hint: '5 recycling drop-offs', activity: 'KITAR_DROPOFF', need: 5 },
  { id: 'trailblazer', label: 'Trailblazer', hint: 'Finish 5 township loops', activity: 'GERAK_LOOP', need: 5 },
  { id: 'good-neighbour', label: 'Good Neighbour', hint: 'Help 3 neighbours', activity: 'JIRAN_HELP', need: 3 },
  { id: 'joiner', label: 'Joiner', hint: 'Join 3 township events', activity: 'JIRAN_EVENT', need: 3 },
  { id: 'sharer', label: 'Sharer', hint: 'Give or lend 3 items', activity: 'KONGSI_SHARE', need: 3 },
  { id: 'watchful-eye', label: 'Watchful Eye', hint: '3 reports confirmed by staff', activity: 'LAPOR_REPORT', need: 3 },
  { id: 'saver', label: 'Saver', hint: 'Use less energy or water than last month', activity: 'JIMAT_SAVER', need: 1 },
];

export async function walletOverview(db: Db, actor: Actor, now: Date) {
  const s = await getSettings(db);
  const [account, user, counts, used, expiring, pending] = await Promise.all([
    one<{ balance: number }>(db, `SELECT balance FROM ledger_accounts WHERE user_id = $1 AND kind = 'WALLET'`, [actor.id]),
    one<{ xp_total: number; last_points_activity_at: Date | null }>(db, 'SELECT xp_total, last_points_activity_at FROM users WHERE id = $1', [actor.id]),
    db.query<{ activity: Activity; n: number }>('SELECT activity, count(*)::int AS n FROM xp_events WHERE user_id = $1 GROUP BY activity', [actor.id]),
    one<{ day: number; month: number }>(
      db,
      `SELECT coalesce(sum(amount) FILTER (WHERE earned_at >= ${startOf('day', '$2', '$3')}), 0)::int AS day, coalesce(sum(amount), 0)::int AS month
         FROM point_lots WHERE user_id = $1 AND source IN ('PURCHASE', 'CAMPAIGN') AND earned_at >= ${startOf('month', '$2', '$3')}`,
      [actor.id, now, s.timezone],
    ),
    // The earliest date any of this resident's points will expire, and how many go on that date's 60-day horizon.
    one<{ points: number; on_date: string | null }>(
      db,
      `SELECT coalesce(sum(l.remaining), 0)::int AS points, min(e.expires)::date::text AS on_date
         FROM point_lots l JOIN users u ON u.id = l.user_id,
              LATERAL (SELECT LEAST(l.expires_at, coalesce(u.last_points_activity_at, l.earned_at) + make_interval(months => $3)) AS expires) e
        WHERE l.user_id = $1 AND l.remaining > 0 AND e.expires <= $2::timestamptz + interval '60 days'`,
      [actor.id, now, s.expiry_inactive_months],
    ),
    pendingForResident(db, actor.id, now),
  ]);
  const total = counts.reduce((sum, c) => sum + c.n, 0);
  const countOf = (activity?: Activity) => (activity ? (counts.find((c) => c.activity === activity)?.n ?? 0) : total);
  return {
    points: account?.balance ?? 0,
    xp: user!.xp_total,
    level: levelFor(user!.xp_total),
    memberCode: actor.memberCode,
    residencyStatus: actor.residencyStatus,
    badges: BADGES.map((b) => ({ id: b.id, label: b.label, hint: b.hint, earned: countOf(b.activity) >= b.need, progress: Math.min(countOf(b.activity), b.need), need: b.need })),
    limits: { dayUsed: used!.day, dayMax: s.points_daily_person, monthUsed: used!.month, monthMax: s.points_monthly_person },
    expiring: expiring!.points > 0 ? { points: expiring!.points, date: expiring!.on_date } : null,
    rules: { minRedeem: s.min_redeem_points, maxRedeemBps: s.max_redeem_bps, inactiveMonths: s.expiry_inactive_months, maxMonths: s.expiry_max_months },
    pending,
  };
}

/** Every movement in the wallet, newest first, with who funded or received it (BR8). */
export async function walletHistory(db: Db, actor: Actor, page: PageQuery) {
  const [, afterId] = decodeCursor(page.cursor, 'id');
  const rows = await db.query<{ id: number }>(
    `SELECT e.id, t.kind, t.label, -e.amount AS points, t.created_at
       FROM ledger_entries e JOIN ledger_txns t ON t.id = e.txn_id JOIN ledger_accounts a ON a.id = e.account_id
      WHERE a.user_id = $1 AND a.kind = 'WALLET' AND ($2::bigint IS NULL OR e.id < $2::bigint)
      ORDER BY e.id DESC LIMIT $3`,
    [actor.id, afterId, page.limit + 1],
  );
  return toPage(rows, page.limit, (r) => ['', r.id]);
}

/** This month's Impact XP by street. Streets, not people: nobody's own total is shown to neighbours. */
export async function streetLeague(db: Db, actor: Actor, now: Date) {
  const s = await getSettings(db);
  const streets = await db.query<{ street: string; xp: number; homes: number }>(
    `SELECT h.street, coalesce(sum(e.xp), 0)::int AS xp, count(DISTINCT h.id)::int AS homes
       FROM homes h
       LEFT JOIN users u ON u.home_id = h.id AND u.status = 'ACTIVE'
       LEFT JOIN xp_events e ON e.user_id = u.id AND e.created_at >= ${startOf('month', '$2', '$3')}
      WHERE h.township_id = $1 GROUP BY h.street ORDER BY xp DESC, h.street LIMIT 20`,
    [townshipOf(actor), now, s.timezone],
  );
  const mine = actor.homeId ? await one<{ street: string }>(db, 'SELECT street FROM homes WHERE id = $1', [actor.homeId]) : undefined;
  return { streets: streets.map((row, i) => ({ ...row, rank: i + 1, mine: row.street === mine?.street })) };
}
