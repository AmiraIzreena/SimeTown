import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { hashPassword } from '@/server/auth/password';
import { createSession } from '@/server/auth/session';
import { parseConfig, type Config } from '@/server/config';
import { one, type Db } from '@/server/db/client';
import { T0, at, freshDb, makeResident, makeWorld, type World } from './helpers';

/**
 * SimeTown Assistant: the rules (no AI), the agent (with a fake AI service),
 * actions that need the resident's Yes, questions handed to the township
 * office, and the history kept for each account.
 */

let config: Config = parseConfig(process.env);
vi.mock('@/server/config', async (actual) => ({ ...(await actual<typeof import('@/server/config')>()), getConfig: () => config }));
const { routes } = await import('@/server/http/api');
const { createRouter } = await import('@/server/http/router');
const { deleteAccount, exportMyData } = await import('@/server/modules/identity/service');
const { retentionCleanup } = await import('@/server/modules/retention');

let db: Db;
let w: World;
let handle: (req: Request) => Promise<Response>;
const ORIGIN = 'http://kita.test';

async function call(method: string, path: string, opts: { as?: Actor; body?: unknown } = {}) {
  // Like the app's own client, a POST without fields still sends an empty JSON object.
  const body = method === 'POST' && opts.body === undefined ? {} : opts.body;
  const headers = new Headers();
  if (opts.as) headers.set('cookie', `kita_session=${await createSession(db, opts.as.id, T0)}`);
  if (method !== 'GET') headers.set('origin', ORIGIN);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const res = await handle(new Request(`${ORIGIN}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const payload = (await res.json()) as { data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { status: res.status, data: payload.data, error: payload.error };
}
const ask = (as: Actor, message: string, conversationId?: string) => call('POST', '/assistant/ask', { as, body: { message, conversationId } });
const passesOf = async (resident: Actor) => (await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM visitor_passes WHERE host_user_id = $1', [resident.id]))!.n;

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
  handle = createRouter(routes, { prefix: '/api/v1', db: async () => db, now: () => T0 }).handle;
});
afterAll(() => db.close());
afterEach(() => {
  vi.unstubAllGlobals();
  config = parseConfig(process.env);
});

describe('answers without AI (the rules)', () => {
  it('saves each question and answer to a conversation named after the first question', async () => {
    const resident = await makeResident(w);
    const first = await ask(resident, 'How many points do I have?');
    expect(first.status).toBe(200);
    expect(first.data).toMatchObject({ mode: 'RULES', reply: { text: expect.stringMatching(/^You have 0 points/), link: { href: '/app/wallet' } } });
    await ask(resident, 'Is my area flooding?', first.data.conversationId);

    const list = await call('GET', '/assistant/conversations', { as: resident });
    expect(list.data).toEqual([expect.objectContaining({ id: first.data.conversationId, title: 'How many points do I have?', messages: 4 })]);
    const opened = await call('GET', `/assistant/conversations/${first.data.conversationId}`, { as: resident });
    expect(opened.data.messages.map((m: { role: string }) => m.role)).toEqual(['USER', 'ASSISTANT', 'USER', 'ASSISTANT']);
  });

  it('matches whole words, so a drain is not a flood and a password is not a visitor pass', async () => {
    const resident = await makeResident(w);
    expect((await ask(resident, 'The drain outside is blocked')).data.reply.link).toEqual({ href: '/app/lapor', label: 'Report a problem' });
    const password = (await ask(resident, 'I forgot my password')).data.reply;
    expect(password.text).not.toMatch(/pass for/i);
    expect(password.action?.kind).toBe('HAND_OVER_TO_STAFF');
    expect((await ask(resident, 'I have a doctor appointment')).data.reply.text).not.toMatch(/points/);
  });

  it('answers Elmina and Sime Darby questions from checked facts, with their sources', async () => {
    const resident = await makeResident(w);
    const homes = (await ask(resident, 'What homes is Sime Darby selling in Elmina?')).data.reply;
    expect(homes.text).toMatch(/Persiaran Garcinia/);
    expect(homes.sources.map((s: { url: string }) => s.url)).toContain('https://www.simedarbyproperty.com/city-of-elmina/');
    // The old made-up "Tuesday and Friday" schedule is gone: collection is MBSA's, with the source.
    const rubbish = (await ask(resident, 'Bila kutipan sampah?')).data.reply;
    expect(rubbish.text).toMatch(/KDEB/);
    expect(rubbish.text).not.toMatch(/Tuesday and Friday mornings/);
    expect(rubbish.sources[0].url).toMatch(/mbsa\.gov\.my/);
  });

  it('puts 999 first when someone may be in danger', async () => {
    const resident = await makeResident(w);
    expect((await ask(resident, 'There is a fire at the house next door')).data.reply.text).toMatch(/999/);
  });
});

describe('actions need the resident’s Yes', () => {
  it('proposes a visitor pass, makes it only on Yes, and never saves the share link', async () => {
    const resident = await makeResident(w);
    const proposed = (await ask(resident, 'Make a visitor pass for Ali tomorrow')).data;
    const action = proposed.reply.action;
    expect(action).toMatchObject({ kind: 'CREATE_VISITOR_PASS', status: 'PROPOSED', summary: expect.stringContaining('Ali') });
    expect(await passesOf(resident)).toBe(0);

    const neighbour = await makeResident(w);
    expect((await call('POST', `/assistant/actions/${action.id}/confirm`, { as: neighbour })).status).toBe(404);

    const done = await call('POST', `/assistant/actions/${action.id}/confirm`, { as: resident });
    expect(done.data.shareUrl).toMatch(/^http:\/\/kita\.test\/pass\/.+/);
    expect(await passesOf(resident)).toBe(1);
    expect((await call('POST', `/assistant/actions/${action.id}/confirm`, { as: resident })).error!.code).toBe('ACTION_DECIDED');

    const token = done.data.shareUrl.split('/pass/')[1];
    const saved = await db.query<{ content: string }>('SELECT content FROM assistant_messages WHERE conversation_id = $1', [proposed.conversationId]);
    expect(saved.some((m) => m.content.includes(token))).toBe(false);
    const reopened = await call('GET', `/assistant/conversations/${proposed.conversationId}`, { as: resident });
    expect(reopened.data.messages[1].action.status).toBe('DONE');
  });

  it('lets a proposal expire, and No does nothing', async () => {
    const resident = await makeResident(w);
    const a = (await ask(resident, 'Make a visitor pass for Siti tomorrow')).data.reply.action;
    await db.query('UPDATE assistant_actions SET expires_at = $2 WHERE id = $1', [a.id, at(-1)]);
    expect((await call('POST', `/assistant/actions/${a.id}/confirm`, { as: resident })).error!.code).toBe('ACTION_EXPIRED');
    const b = (await ask(resident, 'Make a visitor pass for Ravi tomorrow')).data.reply.action;
    expect((await call('POST', `/assistant/actions/${b.id}/cancel`, { as: resident })).data.message.text).toBe('OK, no pass was made.');
    expect(await passesOf(resident)).toBe(0);
  });
});

describe('questions handed to the township office', () => {
  it('sends the question only on Yes, and the office’s answer comes back into the chat', async () => {
    const resident = await makeResident(w);
    const asked = (await ask(resident, 'Can I hold a kenduri at the clubhouse next month?')).data;
    expect(asked.reply.action.kind).toBe('HAND_OVER_TO_STAFF');
    const before = (await call('GET', '/admin/assistant/handoffs', { as: w.staff })).data;
    expect(before.some((h: { resident: string }) => h.resident === resident.fullName)).toBe(false);

    await call('POST', `/assistant/actions/${asked.reply.action.id}/confirm`, { as: resident });
    const queue = (await call('GET', '/admin/assistant/handoffs', { as: w.staff })).data;
    const handoff = queue.find((h: { resident: string }) => h.resident === resident.fullName);
    expect(handoff).toMatchObject({ status: 'OPEN', question: 'Can I hold a kenduri at the clubhouse next month?' });
    expect(await one(db, `SELECT 1 FROM notifications WHERE user_id = $1 AND title = 'A resident asked the township office'`, [w.staff.id])).toBeDefined();

    expect((await call('POST', `/admin/assistant/handoffs/${handoff.id}/answer`, { as: w.staff, body: { answer: 'Yes: book it at the management office.' } })).status).toBe(200);
    const chat = await call('GET', `/assistant/conversations/${asked.conversationId}`, { as: resident });
    expect(chat.data.messages.at(-1)).toMatchObject({ role: 'STAFF', text: 'Yes: book it at the management office.' });
    expect(await one(db, `SELECT 1 FROM notifications WHERE user_id = $1 AND title = 'The township office replied'`, [resident.id])).toBeDefined();
    expect((await call('POST', `/admin/assistant/handoffs/${handoff.id}/answer`, { as: w.staff, body: { answer: 'Again' } })).error!.code).toBe('ALREADY_ANSWERED');
    expect((await call('GET', '/admin/assistant/handoffs', { as: resident })).status).toBe(403);
  });
});

describe('the AI agent (with a fake AI service)', () => {
  /** A fake OpenAI: answers in turn from `replies` (repeating the last), and keeps what it was sent. */
  function fakeOpenai(replies: unknown[], status = 200) {
    const sent: { url: string; body: any }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        sent.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify(replies[Math.min(sent.length - 1, replies.length - 1)]), { status });
      }),
    );
    return sent;
  }
  const toolCall = (name: string, args: unknown = {}) => ({
    choices: [{ message: { content: null, tool_calls: [{ id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }],
    usage: { prompt_tokens: 900, completion_tokens: 20 },
  });
  const final = (text: string) => ({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 1000, completion_tokens: 40 } });
  const useAi = (extra: Record<string, string> = {}) => {
    config = parseConfig({ ...process.env, AI_PROVIDER: 'openai', AI_API_KEY: 'sk-test', AI_MODEL: 'gpt-test', ...extra });
  };

  it('looks things up with tools before answering, and remembers the conversation', async () => {
    useAi();
    const resident = await makeResident(w);
    const sent = fakeOpenai([toolCall('get_flood_status'), final('Your area is normal right now.')]);
    const first = (await ask(resident, 'Is my area flooding?')).data;
    expect(first).toMatchObject({ mode: 'AI', reply: { text: 'Your area is normal right now.', link: { href: '/app/banjir' } } });
    expect(sent[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(sent[0]!.body.tools.map((t: { function: { name: string } }) => t.function.name)).toContain('search_elmina_info');
    expect(sent[0]!.body.messages[0].content).toMatch(/Never make up prices/);
    expect(sent[1]!.body.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call_get_flood_status', content: expect.stringContaining('Zone A') });

    const second = fakeOpenai([final('You are welcome.')]);
    await ask(resident, 'Thanks!', first.conversationId);
    expect(second[0]!.body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    const meta = await one<{ meta: { mode: string; tools: string[] } }>(db, `SELECT meta FROM assistant_messages WHERE conversation_id = $1 AND role = 'ASSISTANT' ORDER BY id LIMIT 1`, [first.conversationId]);
    expect(meta!.meta).toMatchObject({ mode: 'AI', tools: ['get_flood_status'] });
  });

  it('shows the checked sources behind an Elmina answer', async () => {
    useAi();
    const resident = await makeResident(w);
    fakeOpenai([toolCall('search_elmina_info', { query: 'homes for sale' }), final('Ask Sime Darby Property’s sales gallery for current launches.')]);
    const reply = (await ask(resident, 'What is Sime Darby selling?')).data.reply;
    expect(reply.sources.length).toBeGreaterThan(0);
    expect(reply.sources.every((s: { url: string; checked: string }) => s.url.startsWith('https://') && s.checked === '2026-10-14')).toBe(true);
  });

  it('can only propose an action, one at a time', async () => {
    useAi();
    const resident = await makeResident(w);
    const pass = (id: string, visitorName: string) => ({ id, type: 'function', function: { name: 'create_visitor_pass', arguments: JSON.stringify({ visitorName, date: 'tomorrow' }) } });
    const sent = fakeOpenai([{ choices: [{ message: { content: null, tool_calls: [pass('a', 'Ali'), pass('b', 'Abu')] } }] }, final('I have set up a pass for Ali. Please check and tap Yes.')]);
    const reply = (await ask(resident, 'Passes for Ali and Abu tomorrow')).data.reply;
    expect(reply.action).toMatchObject({ kind: 'CREATE_VISITOR_PASS', status: 'PROPOSED', summary: expect.stringContaining('Ali') });
    expect(JSON.parse(sent[1]!.body.messages.at(-1).content).error).toMatch(/One action at a time/);
    expect(await passesOf(resident)).toBe(0);
  });

  it('answers by the rules when the AI fails or goes round in circles', async () => {
    useAi();
    const resident = await makeResident(w);
    fakeOpenai([{ error: { message: 'Incorrect API key' } }], 401);
    expect((await ask(resident, 'How many points do I have?')).data).toMatchObject({ mode: 'RULES', reply: { text: expect.stringMatching(/^You have/) } });
    fakeOpenai([toolCall('get_my_points')]); // never gives a final answer
    expect((await ask(resident, 'How many points do I have?')).data.mode).toBe('RULES');
  });

  it('switches to the rules once the daily AI limit is reached', async () => {
    useAi({ AI_ASSISTANT_DAILY_LIMIT: '1' });
    const resident = await makeResident(w);
    fakeOpenai([final('Hello!')]);
    expect((await ask(resident, 'Hello')).data).toMatchObject({ mode: 'AI', limited: false });
    expect((await ask(resident, 'How many points do I have?')).data).toMatchObject({ mode: 'RULES', limited: true });
    expect((await call('GET', '/assistant/status', { as: resident })).data).toMatchObject({ mode: 'RULES', dailyLimit: 1, usedToday: 1 });
  });

  it('adds 999 if the AI forgets it in an emergency', async () => {
    useAi();
    const resident = await makeResident(w);
    fakeOpenai([final('Please stay calm and move away.')]);
    expect((await ask(resident, 'My neighbour is unconscious')).data.reply.text).toMatch(/^If anyone is in danger, call 999 now\./);
  });
});

describe('history and privacy', () => {
  it('shows a conversation only to the person who had it', async () => {
    const [owner, neighbour] = [await makeResident(w), await makeResident(w)];
    const { data } = await ask(owner, 'How many points do I have?');
    expect((await call('GET', `/assistant/conversations/${data.conversationId}`, { as: neighbour })).status).toBe(404);
    expect((await ask(neighbour, 'Sneaky', data.conversationId)).status).toBe(404);
    expect((await call('POST', `/assistant/conversations/${data.conversationId}/delete`, { as: neighbour })).status).toBe(404);
    expect((await call('GET', '/assistant/conversations', { as: neighbour })).data).toEqual([]);
    expect((await call('GET', '/assistant/conversations', { as: w.staff })).status).toBe(403);
  });

  it('deletes one conversation or all of them on request', async () => {
    const resident = await makeResident(w);
    const a = (await ask(resident, 'How many points do I have?')).data.conversationId;
    await ask(resident, 'Is my area flooding?');
    await ask(resident, 'Any shop offers today?');
    expect((await call('POST', `/assistant/conversations/${a}/delete`, { as: resident })).status).toBe(200);
    expect((await call('GET', '/assistant/conversations', { as: resident })).data).toHaveLength(2);
    expect((await call('POST', '/assistant/conversations/delete-all', { as: resident })).data).toEqual({ deleted: 2 });
  });

  it('forgets conversations 90 days after the last message', async () => {
    const resident = await makeResident(w);
    const id = (await ask(resident, 'How many points do I have?')).data.conversationId;
    expect((await retentionCleanup(db, at(89))).assistantConversationsDeleted).toBe(0);
    expect((await retentionCleanup(db, at(91))).assistantConversationsDeleted).toBeGreaterThanOrEqual(1);
    expect(await one(db, 'SELECT 1 FROM assistant_conversations WHERE id = $1', [id])).toBeUndefined();
  });

  it('is in the data export, and goes with the account', async () => {
    const resident = await makeResident(w);
    await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [resident.id, await hashPassword('leaving-kita-plus-1')]);
    await ask(resident, 'How many points do I have?');
    const exported = await exportMyData(db, resident);
    expect((exported.assistant[0] as { content: string }).content).toBe('How many points do I have?');
    await deleteAccount(db, resident, 'leaving-kita-plus-1', T0);
    expect(await one(db, 'SELECT 1 FROM assistant_conversations WHERE user_id = $1', [resident.id])).toBeUndefined();
  });
});

describe('changing a proposal before Yes', () => {
  const edit = (as: Actor, id: string, body: unknown) => call('POST', `/assistant/actions/${id}/edit`, { as, body });
  const pass = { visitorName: 'Ali bin Abu', date: '2026-11-04', startTime: '15:30', hours: 3, type: 'ONE_VISIT' };

  it('reads the time, day and length the resident asked for', async () => {
    const resident = await makeResident(w);
    const action = (await ask(resident, 'Make a visitor pass for Ali tomorrow at 3pm for 4 hours')).data.reply.action;
    expect(action.summary).toMatch(/Ali, from Tue, 3 Nov, 3:00 pm for 4 hours\./);
    expect(action.details).toEqual({ visitorName: 'Ali', vehicleNo: '', type: 'ONE_VISIT', date: '2026-11-03', startTime: '15:00', hours: 4 });
    const malay = (await ask(resident, 'Buat pas pelawat untuk Siti hari Sabtu pukul 10 pagi selama 2 jam')).data.reply.action;
    expect(malay.details).toMatchObject({ visitorName: 'Siti', date: '2026-11-07', startTime: '10:00', hours: 2 });
  });

  it('makes the pass with the changed details, checked like any other', async () => {
    const resident = await makeResident(w);
    const action = (await ask(resident, 'Make a visitor pass for Ali tomorrow')).data.reply.action;
    expect(action.details).toMatchObject({ date: '2026-11-03', startTime: '09:00', hours: 12 });

    expect((await edit(resident, action.id, { pass: { ...pass, date: '2026-11-02', startTime: '08:00' } })).error!.code).toBe('PASS_DETAILS'); // already passed
    expect((await edit(resident, action.id, { pass: { ...pass, type: 'DELIVERY', hours: 30 } })).error!.code).toBe('PASS_DETAILS'); // a delivery lasts a day at most
    expect((await edit(await makeResident(w), action.id, { pass })).status).toBe(404);

    const changed = await edit(resident, action.id, { pass });
    expect(changed.data).toMatchObject({ status: 'PROPOSED', summary: 'One visit pass for Ali bin Abu, from Wed, 4 Nov, 3:30 pm for 3 hours.', details: { startTime: '15:30', hours: 3 } });
    await call('POST', `/assistant/actions/${action.id}/confirm`, { as: resident });
    const made = await one<{ visitor_name: string; valid_from: Date; valid_until: Date }>(db, 'SELECT visitor_name, valid_from, valid_until FROM visitor_passes WHERE host_user_id = $1', [resident.id]);
    expect(made).toEqual({ visitor_name: 'Ali bin Abu', valid_from: new Date('2026-11-04T07:30:00Z'), valid_until: new Date('2026-11-04T10:30:00Z') });
    expect((await edit(resident, action.id, { pass })).error!.code).toBe('ACTION_DECIDED');
  });

  it('lets the resident reword a question before it goes to the office', async () => {
    const resident = await makeResident(w);
    const action = (await ask(resident, 'Can I park a lorry outside overnight?')).data.reply.action;
    expect(action.details).toEqual({ question: 'Can I park a lorry outside overnight?' });
    await edit(resident, action.id, { question: 'Can I park a small lorry outside my house on Saturday night?' });
    await call('POST', `/assistant/actions/${action.id}/confirm`, { as: resident });
    expect(await one(db, 'SELECT 1 FROM assistant_handoffs WHERE user_id = $1 AND question = $2', [resident.id, 'Can I park a small lorry outside my house on Saturday night?'])).toBeDefined();
  });

  it('keeps only the newest proposal open in a conversation', async () => {
    const resident = await makeResident(w);
    const first = (await ask(resident, 'Make a visitor pass for Ali tomorrow')).data;
    const second = (await ask(resident, 'Make it for Ali on Saturday at 2pm instead, pass for Ali', first.conversationId)).data;
    expect(second.reply.action.details).toMatchObject({ date: '2026-11-07', startTime: '14:00' });
    const chat = await call('GET', `/assistant/conversations/${first.conversationId}`, { as: resident });
    expect(chat.data.messages.filter((m: { action?: unknown }) => m.action).map((m: { action: { status: string } }) => m.action.status)).toEqual(['SUPERSEDED', 'PROPOSED']);
    expect((await call('POST', `/assistant/actions/${first.reply.action.id}/confirm`, { as: resident })).error!.code).toBe('ACTION_REPLACED');
    expect(await passesOf(resident)).toBe(0);
  });
});
