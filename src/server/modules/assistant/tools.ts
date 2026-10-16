import { z } from 'zod';
import { PASS_TYPE_INFO } from '@/shared/domain';
import type { ToolSpec } from '../../ai/chat';
import type { Actor } from '../../auth/actor';
import { one, type Db, type Queryable } from '../../db/client';
import { AppError } from '../../errors';
import { banjirOverview } from '../banjir/service';
import { jimatOverview } from '../jimat/service';
import { kitarOverview } from '../kitar/service';
import { listLiveOffers, offerBalance } from '../offers/service';
import { getSettings } from '../settings';
import { tamanOverview } from '../taman/service';
import { tamuOverview } from '../tamu/service';
import { walletOverview } from '../wallet/service';
import { searchKnowledge, type KnowledgeSource } from './knowledge';

/**
 * The Assistant's tools. Read tools look things up as the signed-in resident,
 * with the same checks as the app's own screens, and return only what an
 * answer needs. Action tools never act: they record a proposal that the
 * resident can change and must confirm in the app (assistant/service.ts).
 */

export interface ToolContext {
  db: Db;
  actor: Actor;
  now: Date;
  conversationId: string;
}

export interface ToolResult {
  /** What the model sees. */
  data: unknown;
  /** Where in the app the answer continues. */
  link?: { href: string; label: string };
  /** Checked sources behind the answer (knowledge entries only). */
  sources?: (KnowledgeSource & { checked: string })[];
  /** Set by an action tool: the proposal the resident must confirm. */
  actionId?: string;
}

interface Tool {
  spec: ToolSpec;
  kind: 'read' | 'action';
  run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult>;
}

export const ACTION_TTL_MINUTES = 15;
const sen = (n: number) => `RM${(n / 100).toFixed(2)}`;
const noArgs = { type: 'object', properties: {}, additionalProperties: false };

async function propose(ctx: ToolContext, kind: 'CREATE_VISITOR_PASS' | 'HAND_OVER_TO_STAFF', params: unknown, summary: string): Promise<ToolResult> {
  // One live proposal per conversation: a new one replaces any the resident has not answered.
  await ctx.db.query(`UPDATE assistant_actions SET status = 'SUPERSEDED', decided_at = $3 WHERE conversation_id = $1 AND user_id = $2 AND status = 'PROPOSED'`, [
    ctx.conversationId,
    ctx.actor.id,
    ctx.now,
  ]);
  const row = await one<{ id: string }>(
    ctx.db,
    `INSERT INTO assistant_actions (user_id, conversation_id, kind, params, summary, created_at, expires_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $6::timestamptz + make_interval(mins => $7)) RETURNING id`,
    [ctx.actor.id, ctx.conversationId, kind, JSON.stringify(params), summary, ctx.now, ACTION_TTL_MINUTES],
  );
  return {
    data: { status: 'awaiting_resident_confirmation', summary, note: 'Nothing has been done yet. The resident can change the details on the card, then tap Yes in the app.' },
    actionId: row!.id,
  };
}

export const passArgs = z.object({
  visitorName: z.string().trim().min(2).max(80),
  date: z.union([z.enum(['today', 'tomorrow']), z.string().regex(/^20\d{2}-\d{2}-\d{2}$/)]),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  hours: z.number().int().min(1).max(48).optional(),
  type: z.enum(['ONE_VISIT', 'DELIVERY', 'EVENT']).optional(),
  vehicleNo: z.string().trim().max(15).optional(),
});

export interface PassParams {
  type: 'ONE_VISIT' | 'DELIVERY' | 'EVENT';
  visitorName: string;
  vehicleNo?: string;
  validFrom: Date;
  validUntil: Date;
}

/**
 * Turns pass details (from the AI, the rules or the resident's own changes on
 * the card) into the times and summary of a pass, with the pass rules checked
 * up front. The pass itself is only made when the resident taps Yes.
 */
export async function planVisitorPass(db: Queryable, now: Date, args: unknown): Promise<{ ok: true; params: PassParams; summary: string } | { ok: false; error: string }> {
  const parsed = passArgs.safeParse(args);
  if (!parsed.success) return { ok: false, error: 'The pass needs the visitor’s name and the day.' };
  const a = parsed.data;
  const type = a.type ?? 'ONE_VISIT';
  const tz = (await getSettings(db)).timezone;
  const fromNow = a.date === 'today' && !a.startTime;
  const window = await one<{ from: Date }>(
    db,
    `SELECT CASE WHEN $5 THEN $1::timestamptz
                 ELSE ((CASE $2 WHEN 'today' THEN ($1::timestamptz AT TIME ZONE $3)::date
                                WHEN 'tomorrow' THEN ($1::timestamptz AT TIME ZONE $3)::date + 1
                                ELSE $2::date END) + $4::time) AT TIME ZONE $3 END AS from`,
    [now, a.date, tz, a.startTime ?? '09:00', fromNow],
  ).catch(() => undefined);
  if (!window) return { ok: false, error: 'That date is not valid.' };
  const hours = a.hours ?? 12;
  const maxHours = PASS_TYPE_INFO[type].maxDays * 24;
  if (hours > maxHours) return { ok: false, error: `A ${PASS_TYPE_INFO[type].label.toLowerCase()} pass can last at most ${maxHours} hours.` };
  const validFrom = new Date(window.from);
  const validUntil = new Date(validFrom.getTime() + hours * 3_600_000);
  if (validFrom.getTime() < now.getTime() - 3_600_000) return { ok: false, error: 'That time has already passed.' };
  if (validFrom.getTime() > now.getTime() + 60 * 86_400_000) return { ok: false, error: 'Passes can be made up to 60 days ahead.' };
  const when = validFrom.toLocaleString('en-MY', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const vehicleNo = a.vehicleNo?.toUpperCase() || undefined;
  return {
    ok: true,
    params: { type, visitorName: a.visitorName, vehicleNo, validFrom, validUntil },
    summary: `${PASS_TYPE_INFO[type].label} pass for ${a.visitorName}${vehicleNo ? ` (${vehicleNo})` : ''}, from ${when} for ${hours} hours.`,
  };
}

/** A pass proposal as the card's form shows it: the local date and time in the township. */
export function passDetails(params: { type: PassParams['type']; visitorName: string; vehicleNo?: string; validFrom: string | Date; validUntil: string | Date }, tz: string) {
  const from = new Date(params.validFrom);
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, ...o }).format(from);
  return {
    visitorName: params.visitorName,
    vehicleNo: params.vehicleNo ?? '',
    type: params.type,
    date: part({ year: 'numeric', month: '2-digit', day: '2-digit' }),
    startTime: part({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    hours: Math.round((new Date(params.validUntil).getTime() - from.getTime()) / 3_600_000),
  };
}

const TOOLS: Tool[] = [
  {
    kind: 'read',
    spec: {
      name: 'get_flood_status',
      description: "The official flood status of the resident's own area: level, status, the latest official message, the safe route and the assembly point. Repeat it; never change it.",
      parameters: noArgs,
    },
    run: async ({ db, actor }) => {
      const b = await banjirOverview(db, actor);
      const zone = (b.zones as Record<string, unknown>[]).find((z) => z.id === b.myZoneId);
      if (!zone) return { data: { error: 'This resident’s home is not linked to a flood area yet.' }, link: { href: '/app/banjir', label: 'Open Banjir' } };
      return {
        data: {
          area: zone.name,
          status: zone.status,
          waterLevelPercent: zone.level_pct,
          updatedAt: zone.updated_at,
          officialMessage: zone.what ? { what: zone.what, where: zone.where_text, whatToDo: zone.todo, sentAt: zone.sent_at } : null,
          safeRoute: zone.safe_route,
          assemblyPoint: zone.assembly_point,
          warningAtPercent: b.warningPct,
          dangerAtPercent: b.dangerPct,
        },
        link: { href: '/app/banjir', label: 'Open Banjir' },
      };
    },
  },
  {
    kind: 'read',
    spec: { name: 'get_my_points', description: "The resident's points (1 point = 1 sen), offer points, points expiring soon, and money saved so far.", parameters: noArgs },
    run: async ({ db, actor, now }) => {
      const w = await walletOverview(db, actor, now);
      return {
        data: {
          totalPoints: w.totalPoints,
          worth: sen(w.totalPoints),
          cashBackedPoints: w.points,
          offerPoints: w.offerPoints,
          expiring: w.expiring,
          savedSoFar: sen(w.saved.totalSen),
          level: w.level,
        },
        link: { href: '/app/wallet', label: 'Open Points & XP' },
      };
    },
  },
  {
    kind: 'read',
    spec: { name: 'get_shop_offers', description: 'Shop Offers from township shops, which ones can be used right now, and the resident’s offer points.', parameters: noArgs },
    run: async ({ db, actor, now }) => {
      const offers = await listLiveOffers(db, actor.townshipId!, now);
      const balance = actor.residencyStatus === 'VERIFIED' ? await offerBalance(db, actor.id) : 0;
      return {
        data: {
          offerPoints: balance,
          offers: offers.slice(0, 15).map((o) => ({ shop: o.merchantName, offer: o.title, discount: sen(o.discountSen), minimumSpend: o.minSpendSen ? sen(o.minSpendSen) : null, usableNow: o.usable })),
        },
        link: { href: '/app/wallet', label: 'See all offers' },
      };
    },
  },
  {
    kind: 'read',
    spec: { name: 'get_my_bill_readings', description: "The home's latest electricity (kWh) and water (litres) readings in Jimat, and the change from the month before.", parameters: noArgs },
    run: async ({ db, actor }) => {
      const j = await jimatOverview(db, actor);
      return {
        data: {
          latest: j.readings.slice(-3).map((r) => ({ month: r.month.slice(0, 7), electricityKwh: r.electricity_kwh, waterLitres: r.water_litres })),
          electricityChangePercent: j.electricityPct,
          waterChangePercent: j.waterPct,
          possibleLeak: j.leakSuspected,
        },
        link: { href: '/app/jimat', label: 'Open Jimat' },
      };
    },
  },
  {
    kind: 'read',
    spec: { name: 'get_recycling_places', description: "The township's recycling kiosks and smart machines, with where they are, and the resident's recycling this month.", parameters: noArgs },
    run: async ({ db, actor, now }) => {
      const k = await kitarOverview(db, actor, now);
      return {
        data: {
          kiosks: (k.kiosks as { name: string; location: string }[]).map((x) => ({ name: x.name, location: x.location })),
          smartMachines: (k.machines as { name: string; status: string; location: string }[]).map((x) => ({ name: x.name, status: x.status, location: x.location })),
          myRecyclingThisMonthKg: Math.round(k.monthGrams / 100) / 10,
          note: 'Household rubbish collection days come from MBSA, not from this app: use search_elmina_info for that.',
        },
        link: { href: '/app/kitar', label: 'Open Kitar' },
      };
    },
  },
  {
    kind: 'read',
    spec: { name: 'get_my_visitor_passes', description: "The home's current and upcoming visitor passes.", parameters: noArgs },
    run: async ({ db, actor, now }) => {
      const t = await tamuOverview(db, actor, now);
      return {
        data: {
          passes: t.passes
            .filter((p) => new Date(p.validUntil).getTime() > now.getTime())
            .slice(0, 10)
            .map((p) => ({ visitor: p.visitorName, type: p.type, code: p.code, from: p.validFrom, until: p.validUntil, status: p.status })),
        },
        link: { href: '/app/tamu', label: 'Open Tamu' },
      };
    },
  },
  {
    kind: 'read',
    spec: { name: 'get_my_garden', description: "The resident's garden plot or place on a garden's waiting list, and free plots.", parameters: noArgs },
    run: async ({ db, actor, now }) => {
      const t = await tamanOverview(db, actor, now);
      return {
        data: {
          plotsGivenOutBy: 'ballot, one per home, for six months',
          gardens: t.gardens.map((g) => ({
            name: g.name,
            location: g.location,
            myPlot: g.plots.find((p) => p.mine)?.plot_no ?? null,
            myPlotUntil: g.plots.find((p) => p.mine)?.booked_until ?? null,
            onWaitingList: Boolean(g.myApplication),
            freePlots: g.freePlots,
            waiting: g.waiting,
          })),
        },
        link: { href: '/app/taman', label: 'Open Taman' },
      };
    },
  },
  {
    kind: 'read',
    spec: {
      name: 'search_elmina_info',
      description:
        'Checked facts about City of Elmina, Sime Darby Property and local services: precincts, homes for sale, contacting Sime Darby Property, parks, the mall, schools, rubbish collection, MBSA, emergencies, roads, and what the SimeTown app does. Use it for any such question.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'What to look up, in a few words.' } }, required: ['query'], additionalProperties: false },
    },
    run: async (_ctx, args) => {
      const query = typeof args.query === 'string' ? args.query.slice(0, 200) : '';
      const hits = searchKnowledge(query);
      if (hits.length === 0) return { data: { results: [], note: 'Nothing checked on this. Say you do not know and offer to send the question to the township office.' } };
      return {
        data: { results: hits.map(({ entry }) => ({ title: entry.title, facts: entry.details, lastChecked: entry.checked, sources: entry.sources.map((s) => s.title) })) },
        link: hits[0]!.entry.appLink,
        sources: hits.flatMap(({ entry }) => entry.sources.map((s) => ({ ...s, checked: entry.checked }))),
      };
    },
  },
  {
    kind: 'action',
    spec: {
      name: 'create_visitor_pass',
      description:
        'Propose a visitor pass for the resident’s home, with the details they gave. It is only made after the resident taps Yes, and they can change any detail on the card first. Times are Malaysia time. ONE_VISIT lasts up to 48 hours, DELIVERY 24, EVENT 48. To change a pass you proposed, call this again with the new details: the new proposal replaces the old one.',
      parameters: {
        type: 'object',
        properties: {
          visitorName: { type: 'string', description: "The visitor's name as the resident gave it." },
          date: { type: 'string', description: '"today", "tomorrow" or YYYY-MM-DD (work out weekdays and dates from today).' },
          startTime: { type: 'string', description: 'HH:MM, 24-hour, Malaysia time. Omit for "from now" today or 09:00 on a later day.' },
          hours: { type: 'integer', description: 'How long the pass lasts, 1 to 48. Default 12.' },
          type: { type: 'string', enum: ['ONE_VISIT', 'DELIVERY', 'EVENT'] },
          vehicleNo: { type: 'string', description: 'Car plate, if the resident gave one.' },
        },
        required: ['visitorName', 'date'],
        additionalProperties: false,
      },
    },
    run: async (ctx, args) => {
      const plan = await planVisitorPass(ctx.db, ctx.now, args);
      if (!plan.ok) return { data: { error: `${plan.error} Ask the resident.` } };
      return propose(ctx, 'CREATE_VISITOR_PASS', plan.params, plan.summary);
    },
  },
  {
    kind: 'action',
    spec: {
      name: 'hand_over_to_staff',
      description:
        'Propose sending the resident’s question to the township office, when the tools cannot answer it or the resident asks for a person. Only sent after the resident taps Yes, and they can reword it first. Write the question so staff can answer it without the chat.',
      parameters: {
        type: 'object',
        properties: { question: { type: 'string', description: 'The question for staff, in the resident’s words, with any details they gave.' } },
        required: ['question'],
        additionalProperties: false,
      },
    },
    run: async (ctx, args) => {
      const question = typeof args.question === 'string' ? args.question.trim().slice(0, 1000) : '';
      if (question.length < 5) return { data: { error: 'Ask the resident what they would like to ask the township office.' } };
      return propose(ctx, 'HAND_OVER_TO_STAFF', { question }, handoffSummary(question));
    },
  },
];

export const handoffSummary = (question: string) => `Send this question to the township office: “${question}”`;

export const TOOL_SPECS: ToolSpec[] = TOOLS.map((t) => t.spec);
export const isActionTool = (name: string) => TOOLS.find((t) => t.spec.name === name)?.kind === 'action';

/** Runs a tool by name. Failures come back as data the model can explain, never as exceptions. */
export async function runTool(ctx: ToolContext, name: string, args: Record<string, unknown> | null): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.spec.name === name);
  if (!tool) return { data: { error: `There is no tool called ${name}.` } };
  if (!args) return { data: { error: 'The arguments were not valid JSON.' } };
  try {
    return await tool.run(ctx, args);
  } catch (error) {
    // Expected refusals (not verified yet, not found) are explained; anything else stays vague.
    return { data: { error: error instanceof AppError ? error.message : 'That could not be looked up just now.' } };
  }
}
