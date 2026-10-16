import { ModelError, type ChatMessage } from '../../ai/chat';
import { assertTownshipAccess, type Actor } from '../../auth/actor';
import { getConfig } from '../../config';
import { one, type Db, type Queryable } from '../../db/client';
import { AppError, conflict, notFound, ruleViolation } from '../../errors';
import { log } from '../../logger';
import { audit } from '../audit';
import { notify } from '../notifications';
import { createPass } from '../tamu/service';
import { CONTEXT_MESSAGES, runAgent } from './agent';
import { answerByRules, isEmergency } from './rules';
import { getSettings } from '../settings';
import { ACTION_TTL_MINUTES, handoffSummary, passDetails, planVisitorPass, type ToolResult } from './tools';

/**
 * SimeTown Assistant: conversations saved to each resident's account, the
 * agent (or the rules) answering each question, actions the resident confirms,
 * and questions handed to the township office.
 *
 * Only the owner can read, reopen or delete a conversation. Kept for
 * ASSISTANT_RETENTION_DAYS after the last message, included in the data
 * export and removed with the account.
 */

export const ASSISTANT_RETENTION_DAYS = 90;
/** A long conversation is started afresh; the list shows the most recent ones. */
const MAX_MESSAGES_PER_CONVERSATION = 200;
const LIST_LIMIT = 50;

type Role = 'USER' | 'ASSISTANT' | 'STAFF';
type Link = { href: string; label: string };
type Sources = NonNullable<ToolResult['sources']>;

export interface SavedMessage {
  role: Role;
  text: string;
  link?: Link;
  sources?: Sources;
  actionId?: string;
  meta?: Record<string, unknown>;
}

export async function listConversations(db: Db, actor: Actor) {
  return db.query<{ id: string; title: string; updated_at: Date; messages: number }>(
    `SELECT c.id, c.title, c.updated_at, (SELECT count(*)::int FROM assistant_messages m WHERE m.conversation_id = c.id) AS messages
       FROM assistant_conversations c WHERE c.user_id = $1 ORDER BY c.updated_at DESC LIMIT $2`,
    [actor.id, LIST_LIMIT],
  );
}

async function ownConversation(q: Queryable, actor: Actor, id: string, lock = false) {
  const row = await one<{ id: string; title: string }>(q, `SELECT id, title FROM assistant_conversations WHERE id = $1 AND user_id = $2${lock ? ' FOR UPDATE' : ''}`, [id, actor.id]);
  // Someone else's conversation looks exactly like one that does not exist.
  if (!row) throw notFound('Conversation');
  return row;
}

type ActionKind = 'CREATE_VISITOR_PASS' | 'HAND_OVER_TO_STAFF';
type ActionStatus = 'PROPOSED' | 'DONE' | 'CANCELLED' | 'EXPIRED' | 'FAILED' | 'SUPERSEDED';
interface ActionRow {
  id: string;
  kind: ActionKind;
  summary: string;
  status: ActionStatus;
  params: Record<string, unknown>;
  expires_at: Date;
}

/** A proposal as the card shows it, with the details the resident can change before Yes. */
const actionView = (a: ActionRow, now: Date, tz: string) => ({
  id: a.id,
  kind: a.kind,
  summary: a.summary,
  status: (a.status === 'PROPOSED' && new Date(a.expires_at).getTime() <= now.getTime() ? 'EXPIRED' : a.status) as ActionStatus,
  expiresAt: a.expires_at,
  details:
    a.kind === 'CREATE_VISITOR_PASS'
      ? passDetails(a.params as unknown as Parameters<typeof passDetails>[0], tz)
      : { question: String((a.params as { question?: string }).question ?? '') },
});
const ACTION_COLUMNS = 'id, kind, summary, status, params, expires_at';
const timezone = async (q: Queryable) => (await getSettings(q)).timezone;

export async function getConversation(db: Db, actor: Actor, id: string, now: Date) {
  const conversation = await ownConversation(db, actor, id);
  const tz = await timezone(db);
  const messages = await db.query<{
    role: Role;
    content: string;
    link_href: string | null;
    link_label: string | null;
    sources: Sources;
    created_at: Date;
    action: ActionRow | null;
  }>(
    `SELECT m.role, m.content, m.link_href, m.link_label, m.sources, m.created_at,
            CASE WHEN a.id IS NULL THEN NULL ELSE json_build_object('id', a.id, 'kind', a.kind, 'summary', a.summary, 'status', a.status, 'params', a.params, 'expires_at', a.expires_at) END AS action
       FROM assistant_messages m LEFT JOIN assistant_actions a ON a.id = m.action_id
      WHERE m.conversation_id = $1 ORDER BY m.id`,
    [id],
  );
  return {
    ...conversation,
    messages: messages.map((m) => ({
      role: m.role,
      text: m.content,
      link: m.link_href ? { href: m.link_href, label: m.link_label ?? 'Open' } : undefined,
      sources: m.sources,
      action: m.action ? actionView(m.action, now, tz) : undefined,
      createdAt: m.created_at,
    })),
  };
}

/** Adds messages to a conversation, starting one (named after its first question) when there is no id. */
export async function saveMessages(q: Db | Queryable, actor: Actor, input: { conversationId?: string; messages: SavedMessage[] }, now: Date): Promise<{ conversationId: string }> {
  const run = async (tx: Queryable) => {
    let id = input.conversationId;
    if (id) {
      await ownConversation(tx, actor, id, true);
      const count = (await one<{ n: number }>(tx, 'SELECT count(*)::int AS n FROM assistant_messages WHERE conversation_id = $1', [id]))!.n;
      if (count + input.messages.length > MAX_MESSAGES_PER_CONVERSATION) {
        throw ruleViolation('CONVERSATION_FULL', 'This conversation is full. Start a new chat to keep going.');
      }
      await tx.query('UPDATE assistant_conversations SET updated_at = $2 WHERE id = $1', [id, now]);
    } else {
      const first = input.messages.find((m) => m.role === 'USER')?.text ?? input.messages[0]!.text;
      const title = first.replace(/\s+/g, ' ').trim().slice(0, 80);
      id = (await one<{ id: string }>(tx, 'INSERT INTO assistant_conversations (user_id, title, created_at, updated_at) VALUES ($1, $2, $3, $3) RETURNING id', [actor.id, title, now]))!.id;
    }
    for (const m of input.messages) {
      await tx.query(
        `INSERT INTO assistant_messages (conversation_id, role, content, link_href, link_label, sources, action_id, meta, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9)`,
        [id, m.role, m.text.slice(0, 4000), m.link?.href ?? null, m.link?.label ?? null, JSON.stringify(m.sources ?? []), m.actionId ?? null, m.meta ? JSON.stringify(m.meta) : null, now],
      );
    }
    return { conversationId: id };
  };
  return 'tx' in q ? q.tx(run) : run(q);
}

/** AI answers this resident has had in the last 24 hours, for the daily limit. */
async function aiAnswersToday(db: Db, actor: Actor, now: Date) {
  return (await one<{ n: number }>(
    db,
    `SELECT count(*)::int AS n FROM assistant_messages m JOIN assistant_conversations c ON c.id = m.conversation_id
      WHERE c.user_id = $1 AND m.role = 'ASSISTANT' AND m.meta->>'mode' = 'AI' AND m.created_at > $2::timestamptz - interval '24 hours'`,
    [actor.id, now],
  ))!.n;
}

/** Whether answers come from the AI or the rules, and how much of today's AI limit is used. */
export async function assistantStatus(db: Db, actor: Actor, now: Date) {
  const config = getConfig();
  const ai = config.AI_PROVIDER !== 'none';
  const used = ai ? await aiAnswersToday(db, actor, now) : 0;
  return {
    mode: ai && used < config.AI_ASSISTANT_DAILY_LIMIT ? ('AI' as const) : ('RULES' as const),
    provider: ai ? (config.AI_PROVIDER === 'openai' ? 'OpenAI' : 'Anthropic') : null,
    dailyLimit: ai ? config.AI_ASSISTANT_DAILY_LIMIT : null,
    usedToday: used,
    retentionDays: ASSISTANT_RETENTION_DAYS,
  };
}

/** The conversation so far, as the model sees it: oldest first, the township office's replies included. */
async function contextFor(db: Db, conversationId: string): Promise<ChatMessage[]> {
  const rows = await db.query<{ role: Role; content: string }>(
    `SELECT role, content FROM (SELECT id, role, content FROM assistant_messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT $2) r ORDER BY id`,
    [conversationId, CONTEXT_MESSAGES],
  );
  return rows.map((r) =>
    r.role === 'USER' ? { role: 'user' as const, text: r.content } : { role: 'assistant' as const, text: r.role === 'STAFF' ? `(The township office replied:) ${r.content}` : r.content },
  );
}

/**
 * One question: saved, answered by the agent (or by the rules when there is
 * no AI, the daily AI limit is reached or the AI fails), and the answer saved.
 */
export async function ask(db: Db, actor: Actor, input: { conversationId?: string; message: string; lang: 'en' | 'ms' }, now: Date) {
  const question = input.message.replace(/\s+/g, ' ').trim();
  const config = getConfig();
  const history = input.conversationId ? (await ownConversation(db, actor, input.conversationId), await contextFor(db, input.conversationId)) : [];
  const { conversationId } = await saveMessages(db, actor, { conversationId: input.conversationId, messages: [{ role: 'USER', text: question }] }, now);
  const ctx = { db, actor, now, conversationId };

  const aiOn = config.AI_PROVIDER !== 'none';
  const limited = aiOn && (await aiAnswersToday(db, actor, now)) >= config.AI_ASSISTANT_DAILY_LIMIT;
  let reply: { text: string; link?: Link; sources?: Sources; actionId?: string; meta: Record<string, unknown> };
  if (aiOn && !limited) {
    try {
      reply = await runAgent(ctx, { history, question, lang: input.lang, firstName: actor.fullName.split(' ')[0] ?? actor.fullName });
    } catch (error) {
      if (!(error instanceof ModelError)) throw error;
      log.warn('assistant AI unavailable, answering by the rules', { error: error.message });
      reply = { ...(await answerByRules(ctx, question)), meta: { mode: 'RULES', aiFailed: true } };
    }
  } else {
    reply = await answerByRules(ctx, question);
    if (limited) reply.meta = { ...reply.meta, aiLimited: true };
  }
  // A safety net under the prompt: a question about danger always gets 999 first.
  if (isEmergency(question) && !/\b999\b/.test(reply.text)) reply.text = `If anyone is in danger, call 999 now. ${reply.text}`;

  await saveMessages(db, actor, { conversationId, messages: [{ role: 'ASSISTANT', text: reply.text, link: reply.link, sources: reply.sources, actionId: reply.actionId, meta: reply.meta }] }, now);
  const action = reply.actionId
    ? actionView((await one<ActionRow>(db, `SELECT ${ACTION_COLUMNS} FROM assistant_actions WHERE id = $1`, [reply.actionId]))!, now, await timezone(db))
    : undefined;
  return {
    conversationId,
    mode: reply.meta.mode === 'AI' ? ('AI' as const) : ('RULES' as const),
    limited,
    reply: { text: reply.text, link: reply.link, sources: reply.sources ?? [], action },
  };
}

/** Claims a proposal for the resident who owns it, once, while it is still open. */
async function claimAction(db: Db, actor: Actor, id: string, status: 'DONE' | 'CANCELLED', now: Date) {
  const claimed = await one<{ id: string; conversation_id: string; kind: ActionKind; params: Record<string, unknown>; summary: string }>(
    db,
    `UPDATE assistant_actions SET status = $3, decided_at = $4 WHERE id = $1 AND user_id = $2 AND status = 'PROPOSED' AND expires_at > $4
      RETURNING id, conversation_id, kind, params, summary`,
    [id, actor.id, status, now],
  );
  if (claimed) return claimed;
  const existing = await one<{ status: string; expires_at: Date }>(db, 'SELECT status, expires_at FROM assistant_actions WHERE id = $1 AND user_id = $2', [id, actor.id]);
  if (!existing) throw notFound('Action');
  if (existing.status === 'SUPERSEDED') throw conflict('ACTION_REPLACED', 'This was replaced by a newer proposal below.');
  if (existing.status === 'PROPOSED') {
    await db.query(`UPDATE assistant_actions SET status = 'EXPIRED', decided_at = $2 WHERE id = $1`, [id, now]);
    throw ruleViolation('ACTION_EXPIRED', 'This has expired. Ask again and I will set it up.');
  }
  throw conflict('ACTION_DECIDED', 'You have already answered this.');
}

/**
 * The resident said Yes. The action runs with their own permissions and the
 * app's usual checks; the Assistant never acts on its own. A visitor pass's
 * share link is returned once and never saved in the chat.
 */
export async function confirmAction(db: Db, actor: Actor, id: string, now: Date) {
  const action = await claimAction(db, actor, id, 'DONE', now);
  let text: string;
  let link: Link | undefined;
  let shareUrl: string | undefined;
  try {
    if (action.kind === 'CREATE_VISITOR_PASS') {
      const p = action.params as { type: 'ONE_VISIT' | 'DELIVERY' | 'EVENT'; visitorName: string; vehicleNo?: string; validFrom: string; validUntil: string };
      const pass = await createPass(db, actor, { type: p.type, visitorName: p.visitorName, vehicleNo: p.vehicleNo, validFrom: new Date(p.validFrom), validUntil: new Date(p.validUntil) }, now);
      shareUrl = `${getConfig().appOrigin}/pass/${pass.token}`;
      text = `Done. ${action.summary} Pass code ${pass.code}. Share the link below with ${p.visitorName}; you can make a new link in Tamu any time.`;
      link = { href: '/app/tamu', label: 'Open Tamu' };
    } else {
      const { question } = action.params as { question: string };
      await handOver(db, actor, action.conversation_id, question, now);
      text = 'Sent to the township office. You will get a notification when they reply, and their answer will appear in this chat.';
    }
  } catch (error) {
    await db.query(`UPDATE assistant_actions SET status = 'FAILED' WHERE id = $1`, [id]);
    text = error instanceof AppError ? `That did not work: ${error.message}` : 'That did not work. Please try again in a moment.';
    if (!(error instanceof AppError)) log.error('assistant action failed', { actionId: id, error: String(error) });
  }
  await saveMessages(db, actor, { conversationId: action.conversation_id, messages: [{ role: 'ASSISTANT', text, link, meta: { mode: 'ACTION', kind: action.kind } }] }, now);
  return { message: { role: 'ASSISTANT' as const, text, link }, shareUrl };
}

export async function cancelAction(db: Db, actor: Actor, id: string, now: Date) {
  const action = await claimAction(db, actor, id, 'CANCELLED', now);
  const text = action.kind === 'CREATE_VISITOR_PASS' ? 'OK, no pass was made.' : 'OK, nothing was sent.';
  await saveMessages(db, actor, { conversationId: action.conversation_id, messages: [{ role: 'ASSISTANT', text, meta: { mode: 'ACTION', kind: action.kind, cancelled: true } }] }, now);
  return { message: { role: 'ASSISTANT' as const, text } };
}

/**
 * The resident changed the details on the card before saying Yes. The new
 * details go through the same checks as the Assistant's own proposal, and the
 * proposal gets a fresh 15 minutes.
 */
export async function editAction(
  db: Db,
  actor: Actor,
  id: string,
  input: { pass?: Record<string, unknown>; question?: string },
  now: Date,
) {
  return db.tx(async (tx) => {
    const action = await one<ActionRow>(tx, `SELECT ${ACTION_COLUMNS} FROM assistant_actions WHERE id = $1 AND user_id = $2 FOR UPDATE`, [id, actor.id]);
    if (!action) throw notFound('Action');
    if (action.status === 'SUPERSEDED') throw conflict('ACTION_REPLACED', 'This was replaced by a newer proposal below.');
    if (action.status !== 'PROPOSED') throw conflict('ACTION_DECIDED', 'You have already answered this.');
    if (new Date(action.expires_at).getTime() <= now.getTime()) throw ruleViolation('ACTION_EXPIRED', 'This has expired. Ask again and I will set it up.');
    let params: unknown;
    let summary: string;
    if (action.kind === 'CREATE_VISITOR_PASS') {
      const plan = await planVisitorPass(tx, now, input.pass ?? {});
      if (!plan.ok) throw ruleViolation('PASS_DETAILS', plan.error);
      ({ params, summary } = plan);
    } else {
      const question = (input.question ?? '').replace(/\s+/g, ' ').trim();
      if (question.length < 5) throw ruleViolation('QUESTION_TOO_SHORT', 'Please write your question for the township office.');
      params = { question };
      summary = handoffSummary(question);
    }
    const updated = await one<ActionRow>(
      tx,
      `UPDATE assistant_actions SET params = $2::jsonb, summary = $3, expires_at = $4::timestamptz + make_interval(mins => $5)
        WHERE id = $1 RETURNING ${ACTION_COLUMNS}`,
      [id, JSON.stringify(params), summary, now, ACTION_TTL_MINUTES],
    );
    return actionView(updated!, now, await timezone(tx));
  });
}

async function handOver(db: Db, actor: Actor, conversationId: string, question: string, now: Date) {
  if (!actor.townshipId) throw ruleViolation('NO_TOWNSHIP', 'Your account is not linked to a township yet.');
  await db.query('INSERT INTO assistant_handoffs (township_id, user_id, conversation_id, question, created_at) VALUES ($1, $2, $3, $4, $5)', [
    actor.townshipId,
    actor.id,
    conversationId,
    question,
    now,
  ]);
  const staff = await db.query<{ id: string }>(`SELECT id FROM users WHERE township_id = $1 AND role IN ('TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN') AND status = 'ACTIVE'`, [actor.townshipId]);
  await notify(db, staff.map((s) => s.id), {
    title: 'A resident asked the township office',
    body: question.length > 140 ? `${question.slice(0, 137)}…` : question,
    link: '/console/assistant',
  });
}

// --- Staff: questions handed over by the Assistant -----------------------------------------------

/** Staff see the question and who asked it, never the rest of the resident's conversation. */
export async function listHandoffs(db: Db, actor: Actor) {
  return db.query(
    `SELECT h.id, h.question, h.status, h.answer, h.created_at, h.answered_at, u.full_name AS resident,
            (SELECT a.full_name FROM users a WHERE a.id = h.answered_by) AS answered_by
       FROM assistant_handoffs h JOIN users u ON u.id = h.user_id
      WHERE ($1::uuid IS NULL OR h.township_id = $1)
      ORDER BY (h.status = 'OPEN') DESC, h.created_at DESC LIMIT 200`,
    [actor.townshipId],
  );
}

export async function answerHandoff(db: Db, actor: Actor, id: string, answer: string, now: Date) {
  return db.tx(async (tx) => {
    const h = await one<{ township_id: string; user_id: string; conversation_id: string | null; status: string }>(
      tx,
      'SELECT township_id, user_id, conversation_id, status FROM assistant_handoffs WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (!h) throw notFound('Question');
    assertTownshipAccess(actor, h.township_id);
    if (h.status !== 'OPEN') throw conflict('ALREADY_ANSWERED', 'This question has already been answered.');
    await tx.query(`UPDATE assistant_handoffs SET status = 'ANSWERED', answer = $2, answered_by = $3, answered_at = $4 WHERE id = $1`, [id, answer, actor.id, now]);
    // The reply goes into the resident's chat, if they still have it.
    if (h.conversation_id) {
      await tx.query(`INSERT INTO assistant_messages (conversation_id, role, content, created_at) VALUES ($1, 'STAFF', $2, $3)`, [h.conversation_id, answer, now]);
      await tx.query('UPDATE assistant_conversations SET updated_at = $2 WHERE id = $1', [h.conversation_id, now]);
    }
    await notify(tx, [h.user_id], {
      title: 'The township office replied',
      body: answer.length > 140 ? `${answer.slice(0, 137)}…` : answer,
      link: h.conversation_id ? `/app/assistant?c=${h.conversation_id}` : '/app/assistant',
    });
    await audit(tx, actor.id, 'ASSISTANT_HANDOFF_ANSWERED', 'assistant_handoff', id);
    return { ok: true };
  });
}

// --- Deleting --------------------------------------------------------------------------------------

export async function deleteConversation(db: Db, actor: Actor, id: string) {
  const rows = await db.query('DELETE FROM assistant_conversations WHERE id = $1 AND user_id = $2 RETURNING id', [id, actor.id]);
  if (rows.length === 0) throw notFound('Conversation');
  return { ok: true };
}

export async function deleteAllConversations(db: Db, actor: Actor) {
  const rows = await db.query('DELETE FROM assistant_conversations WHERE user_id = $1 RETURNING id', [actor.id]);
  return { deleted: rows.length };
}

/**
 * Daily cleanup: conversations untouched for the retention period go with
 * their messages and actions; answered questions to the office go after the
 * same period; proposals nobody answered are marked expired.
 */
export async function deleteOldConversations(q: Queryable, now: Date): Promise<number> {
  await q.query(`UPDATE assistant_actions SET status = 'EXPIRED', decided_at = $1 WHERE status = 'PROPOSED' AND expires_at <= $1`, [now]);
  await q.query(`DELETE FROM assistant_handoffs WHERE status = 'ANSWERED' AND answered_at < $1::timestamptz - make_interval(days => $2)`, [now, ASSISTANT_RETENTION_DAYS]);
  const rows = await q.query(`DELETE FROM assistant_conversations WHERE updated_at < $1::timestamptz - make_interval(days => $2) RETURNING id`, [now, ASSISTANT_RETENTION_DAYS]);
  return rows.length;
}
