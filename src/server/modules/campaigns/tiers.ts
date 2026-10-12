import { SPONSOR_TIER_INFO, type SponsorTier } from '@/shared/domain';
import { one, type Db } from '../../db/client';
import type { Actor } from '../../auth/actor';
import { conflict, notFound } from '../../errors';
import { audit } from '../audit';
import { credit, debit, postTxn, systemAccounts } from '../ledger/ledger';
import { getSettings } from '../settings';

/**
 * Sponsor tiers (proposal section 12). The yearly tier fee pays for
 * visibility; it is SimeTown's income and never touches the reward float. Any
 * reward money a sponsor adds goes into a campaign's prefunded pool as before.
 *
 * Rules that keep residents' trust (BR31): sponsored content is labelled,
 * never shown on safety screens (Banjir, Tamu, Lapor), sponsors get grouped
 * totals only, and Sime Darby Property approves the sponsor categories.
 */

/** Records a tier payment and gives the sponsor that tier for a year. HQ only. */
export async function setSponsorTier(db: Db, actor: Actor, sponsorId: string, input: { tier: SponsorTier; bankRef: string; category?: string; tagline?: string }, now: Date) {
  return db.tx(async (tx) => {
    const sponsor = await one<{ id: string; name: string; category: string | null }>(tx, 'SELECT id, name, category FROM sponsors WHERE id = $1 FOR UPDATE', [sponsorId]);
    if (!sponsor) throw notFound('Sponsor');
    if ((await one(tx, 'SELECT 1 FROM deposits WHERE bank_ref = $1', [input.bankRef])) || (await one(tx, 'SELECT 1 FROM sponsor_tier_payments WHERE bank_ref = $1', [input.bankRef]))) {
      throw conflict('DUPLICATE_BANK_REF', 'A payment with this bank reference is already recorded.');
    }
    const tz = (await getSettings(tx)).timezone;
    const today = (await one<{ d: string }>(tx, `SELECT ($1::timestamptz AT TIME ZONE $2)::date::text AS d`, [now, tz]))!.d;
    const category = input.category ?? sponsor.category;

    // One Title Partner; one Green Champion (or Title Partner) per category. A lapsed holder makes way.
    if (input.tier === 'TITLE_PARTNER') {
      const holder = await one<{ id: string; tier_until: string | null }>(tx, `SELECT id, tier_until::text AS tier_until FROM sponsors WHERE tier = 'TITLE_PARTNER' AND id <> $1 FOR UPDATE`, [sponsorId]);
      if (holder && holder.tier_until && holder.tier_until >= today) throw conflict('TIER_TAKEN', 'There is already a Title Partner this year.');
      if (holder) await tx.query(`UPDATE sponsors SET tier = 'NONE' WHERE id = $1`, [holder.id]);
    }
    if ((input.tier === 'GREEN_CHAMPION' || input.tier === 'TITLE_PARTNER') && category) {
      const rival = await one(
        tx,
        `SELECT 1 FROM sponsors WHERE id <> $1 AND lower(category) = lower($2) AND tier IN ('GREEN_CHAMPION', 'TITLE_PARTNER') AND tier_until >= $3::date`,
        [sponsorId, category, today],
      );
      if (rival) throw conflict('CATEGORY_TAKEN', `Another sponsor already holds the ${category} category at this tier.`);
    }

    const fee = SPONSOR_TIER_INFO[input.tier].feeSen;
    const sys = await systemAccounts(tx);
    const txnId = await postTxn(tx, {
      kind: 'SPONSOR_TIER',
      label: `${SPONSOR_TIER_INFO[input.tier].label} tier · ${sponsor.name}`,
      refType: 'sponsor',
      refId: sponsorId,
      actorId: actor.id,
      at: now,
      entries: [debit(sys.OPERATING_BANK, fee), credit(sys.REVENUE_SPONSOR_TIER, fee)],
    });
    await tx.query(
      `INSERT INTO sponsor_tier_payments (sponsor_id, tier, amount_sen, bank_ref, period_start, period_end, txn_id, recorded_by, created_at)
       VALUES ($1, $2, $3, $4, $5::date, ($5::date + interval '1 year')::date, $6, $7, $8)`,
      [sponsorId, input.tier, fee, input.bankRef, today, txnId, actor.id, now],
    );
    await tx.query(
      `UPDATE sponsors SET tier = $2, tier_until = ($3::date + interval '1 year')::date, category = $4, tagline = coalesce($5, tagline) WHERE id = $1`,
      [sponsorId, input.tier, today, category ?? null, input.tagline ?? null],
    );
    await audit(tx, actor.id, 'SPONSOR_TIER_SET', 'sponsor', sponsorId, { tier: input.tier, feeSen: fee, bankRef: input.bankRef });
    return { tier: input.tier, feeSen: fee };
  });
}

/** The sponsor's own view: their tier, its benefits, and challenges used against the allowance this year. */
export async function myTier(db: Db, actor: Actor, now: Date) {
  const sponsor = await one<{ name: string; tier: SponsorTier | 'NONE'; tier_until: string | null; category: string | null; tagline: string | null; challenges: number }>(
    db,
    `SELECT s.name, s.tier, s.tier_until::text AS tier_until, s.category, s.tagline,
            (SELECT count(*)::int FROM campaigns c WHERE c.sponsor_id = s.id AND c.status <> 'DRAFT' AND c.starts_at >= date_trunc('year', $2::timestamptz)) AS challenges
       FROM sponsors s WHERE s.id = $1`,
    [actor.sponsorId, now],
  );
  if (!sponsor) throw notFound('Sponsor');
  const active = sponsor.tier !== 'NONE' && sponsor.tier_until !== null && sponsor.tier_until >= now.toISOString().slice(0, 10);
  const info = active ? SPONSOR_TIER_INFO[sponsor.tier as SponsorTier] : null;
  return {
    name: sponsor.name,
    tier: active ? sponsor.tier : 'NONE',
    tierLabel: info?.label ?? 'No tier: one-off campaigns',
    until: active ? sponsor.tier_until : null,
    category: sponsor.category,
    tagline: sponsor.tagline,
    benefits: info?.benefits ?? ['Run a one-off challenge with a campaign fee (about 25% of the budget)', 'Grouped results report'],
    challengesThisYear: sponsor.challenges,
    challengeAllowance: info ? info.challenges : null,
  };
}

/** The public Partners page: sponsors with a current tier, names and taglines only. */
export async function publicPartners(db: Db, now: Date) {
  const rows = await db.query<{ name: string; tier: SponsorTier; category: string | null; tagline: string | null }>(
    `SELECT name, tier, category, tagline FROM sponsors WHERE tier <> 'NONE' AND tier_until >= $1::date ORDER BY name`,
    [now.toISOString().slice(0, 10)],
  );
  const order: SponsorTier[] = ['TITLE_PARTNER', 'GREEN_CHAMPION', 'TOWNSHIP_PARTNER', 'COMMUNITY_FRIEND'];
  return order.map((tier) => ({ tier, label: SPONSOR_TIER_INFO[tier].label, sponsors: rows.filter((r) => r.tier === tier) })).filter((g) => g.sponsors.length > 0);
}

/**
 * One sponsored banner for the resident's home screen and the guest page:
 * Township Partner and above, a different one each day, always labelled
 * "Sponsored" by the screen. Never requested by a safety screen.
 */
export async function sponsoredBanner(db: Db, now: Date) {
  const rows = await db.query<{ name: string; tagline: string | null; tier: SponsorTier }>(
    `SELECT name, tagline, tier FROM sponsors WHERE tier IN ('TOWNSHIP_PARTNER', 'GREEN_CHAMPION', 'TITLE_PARTNER') AND tier_until >= $1::date ORDER BY name`,
    [now.toISOString().slice(0, 10)],
  );
  if (rows.length === 0) return null;
  const pick = rows[Math.floor(now.getTime() / 86_400_000) % rows.length]!;
  return { name: pick.name, tagline: pick.tagline, tierLabel: SPONSOR_TIER_INFO[pick.tier].label };
}

export async function listSponsorsWithTiers(db: Db) {
  return db.query(
    `SELECT s.id, s.name, s.tier, s.tier_until::text AS tier_until, s.category, s.tagline, s.created_at,
            (SELECT count(*)::int FROM campaigns c WHERE c.sponsor_id = s.id) AS campaigns
       FROM sponsors s ORDER BY s.name`,
  );
}
