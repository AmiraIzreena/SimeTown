import { getSettings } from '../settings';
import { KNOWLEDGE, searchKnowledge } from './knowledge';
import { parsePassRequest } from './pass-request';
import { runTool, type ToolContext, type ToolResult } from './tools';

/**
 * Answers without a model: when no AI provider is set, the daily AI limit is
 * reached, or the AI fails. Each rule matches whole words only, looks the
 * answer up with the same tools the AI uses, and anything it cannot answer is
 * offered to the township office.
 */

export interface RuleReply {
  text: string;
  link?: { href: string; label: string };
  sources: ToolResult['sources'];
  actionId?: string;
  meta: { mode: 'RULES'; rule: string };
}

const has = (q: string, pattern: string) => new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${pattern})(?:$|[^\\p{L}\\p{N}])`, 'iu').test(q);

/** Danger words: the answer leads with 999, whatever else is asked. */
export const EMERGENCY = 'emergency|kecemasan|fire|kebakaran|terbakar|ambulance|ambulans|accident|kemalangan|injured|cedera|drowning|lemas|robbery|rompakan|samun|intruder|pencuri|heart attack|serangan jantung|unconscious|pengsan|help me|tolong saya';
export const isEmergency = (question: string) => has(question, EMERGENCY);

type Data = Record<string, unknown>;

const knowledgeReply = (id: string, rule: string): RuleReply => {
  const entry = KNOWLEDGE.find((e) => e.id === id)!;
  return { text: entry.short, link: entry.appLink, sources: entry.sources.map((s) => ({ ...s, checked: entry.checked })), meta: { mode: 'RULES', rule } };
};

const failed = (r: ToolResult) => (r.data as Data).error as string | undefined;

export async function answerByRules(ctx: ToolContext, question: string): Promise<RuleReply> {
  const q = question.trim();
  const reply = (text: string, r: ToolResult, rule: string): RuleReply => ({ text: failed(r) ?? text, link: r.link, sources: r.sources ?? [], actionId: r.actionId, meta: { mode: 'RULES', rule } });

  if (isEmergency(q)) return knowledgeReply('emergency', 'emergency');

  if (has(q, 'flood|floods|flooding|flooded|banjir|water level|paras air|air naik')) {
    const r = await runTool(ctx, 'get_flood_status', {});
    const d = r.data as Data;
    const message = d.officialMessage as Data | null;
    const text =
      d.status === 'NORMAL'
        ? `${d.area} is normal: the water is at ${d.waterLevelPercent}%. I only repeat the official status; I never raise or end an alert.`
        : `${d.area} is under a ${String(d.status).toLowerCase()} alert, with water at ${d.waterLevelPercent}%. ${message?.whatToDo ?? `Safe route: ${d.safeRoute}`} If anyone is in danger, call 999.`;
    return reply(text, r, 'flood');
  }

  if (has(q, 'report|lapor|aduan|pothole|potholes|lubang|street ?lights?|lampu|drain|drains|longkang|tersumbat|clogged')) {
    return { text: 'You can report it in Lapor. Add a photo and the place, and you will see who fixes it and by when. Council matters can also go to MBSA on 03-5510 5133.', link: { href: '/app/lapor', label: 'Report a problem' }, sources: [], meta: { mode: 'RULES', rule: 'report' } };
  }

  if (has(q, 'collection|collect|kutipan|kutip|sampah|rubbish|garbage|trash|bulky|pukal')) return knowledgeReply('waste-collection', 'waste');

  if (has(q, 'visitor|visitors|pelawat|tetamu|guest|guests|visitor pass|pas pelawat|delivery pass|pass for|passes for|pas untuk')) {
    const tz = (await getSettings(ctx.db)).timezone;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ctx.now);
    const request = parsePassRequest(q, today);
    if (!request.visitorName) {
      const r = await runTool(ctx, 'get_my_visitor_passes', {});
      const passes = ((r.data as Data).passes as Data[] | undefined) ?? [];
      return reply(
        passes.length
          ? `Your passes: ${passes.map((p) => `${p.visitor} (${p.status})`).join('; ')}. To make one, try “Make a visitor pass for Ali tomorrow”.`
          : 'Who is the pass for? Try “Make a visitor pass for Ali tomorrow”.',
        r,
        'passes',
      );
    }
    // Whatever was not said falls back to today from now, or 9am for 12 hours on a later day.
    const r = await runTool(ctx, 'create_visitor_pass', { ...request, date: request.date ?? 'today' });
    return reply('Here is the pass. Check the details, tap Change if anything is wrong, then Yes to make it.', r, 'pass');
  }

  if (has(q, 'points?|mata|balance|baki|saved|simpanan')) {
    const r = await runTool(ctx, 'get_my_points', {});
    const d = r.data as Data;
    return reply(`You have ${d.totalPoints} points, worth ${d.worth}: ${d.cashBackedPoints} cash-backed and ${d.offerPoints} offer points. You have saved ${d.savedSoFar} so far.`, r, 'points');
  }

  if (has(q, 'offers?|tawaran|discounts?|diskaun|promos?|promotions?')) {
    const r = await runTool(ctx, 'get_shop_offers', {});
    const d = r.data as Data;
    const live = ((d.offers as Data[] | undefined) ?? []).filter((o) => o.usableNow);
    return reply(live.length ? `Available now: ${live.map((o) => `${o.shop}: ${o.offer}`).join('; ')}. You have ${d.offerPoints} offer points.` : 'No Shop Offers can be used right now. Some only run at set hours.', r, 'offers');
  }

  if (has(q, 'recycle|recycling|kitar|kitar semula|kiosk|kiosks|smart machine|mesin pintar')) {
    const r = await runTool(ctx, 'get_recycling_places', {});
    const d = r.data as Data;
    const places = [...((d.smartMachines as Data[] | undefined) ?? []), ...((d.kiosks as Data[] | undefined) ?? [])].map((p) => `${p.name} (${p.location})`);
    return reply(places.length ? `You can recycle at ${places.join('; ')}. Each drop-off earns Impact XP.` : 'There are no recycling kiosks set up yet.', r, 'recycling');
  }

  const hit = searchKnowledge(q, 1)[0];
  if (hit) return knowledgeReply(hit.entry.id, 'knowledge');

  // Nothing fits: offer to pass the question on, for real.
  const r = await runTool(ctx, 'hand_over_to_staff', { question: q });
  return reply('I am not sure about that one. Shall I send your question to the township office? They will reply here.', r, 'handoff');
}
