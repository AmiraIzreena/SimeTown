import { getConfig } from '../config';

/**
 * One turn of a tool-using conversation with the hosted model, in either
 * provider's format (OpenAI Chat Completions or Anthropic Messages). The agent
 * speaks this neutral shape; only this file knows the wire formats.
 */

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Parsed arguments; null when the model sent something that is not JSON. */
  args: Record<string, unknown> | null;
}

export type ChatMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ChatReply {
  text: string;
  toolCalls: ToolCall[];
  usage: { inputTokens: number; outputTokens: number };
}

export class ModelError extends Error {}

const parseArgs = (raw: unknown): Record<string, unknown> | null => {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return null;
  try {
    const value = JSON.parse(raw || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};

function openaiBody(model: string, system: string, messages: ChatMessage[], tools: ToolSpec[], maxTokens: number) {
  return {
    model,
    max_completion_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      ...messages.map((m) =>
        m.role === 'tool'
          ? { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
          : m.role === 'assistant'
            ? {
                role: 'assistant',
                content: m.text || null,
                ...(m.toolCalls?.length
                  ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })) }
                  : {}),
              }
            : { role: 'user', content: m.text },
      ),
    ],
    ...(tools.length ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
  };
}

function readOpenai(data: unknown): ChatReply {
  const d = data as {
    choices?: { message?: { content?: string | null; tool_calls?: { id: string; function?: { name?: string; arguments?: string } }[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const message = d.choices?.[0]?.message;
  if (!message) throw new ModelError('The AI service sent no answer.');
  return {
    text: message.content ?? '',
    toolCalls: (message.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function?.name ?? '', args: parseArgs(c.function?.arguments) })),
    usage: { inputTokens: d.usage?.prompt_tokens ?? 0, outputTokens: d.usage?.completion_tokens ?? 0 },
  };
}

function anthropicBody(model: string, system: string, messages: ChatMessage[], tools: ToolSpec[], maxTokens: number) {
  // Tool results go back as one user message holding every result of the previous turn.
  const out: { role: 'user' | 'assistant'; content: unknown[] }[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last?.role === 'user' && (last.content[0] as { type?: string })?.type === 'tool_result') last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    } else if (m.role === 'assistant') {
      const content: unknown[] = m.text ? [{ type: 'text', text: m.text }] : [];
      for (const c of m.toolCalls ?? []) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args ?? {} });
      out.push({ role: 'assistant', content });
    } else {
      out.push({ role: 'user', content: [{ type: 'text', text: m.text }] });
    }
  }
  return {
    model,
    max_tokens: maxTokens,
    system,
    messages: out,
    ...(tools.length ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
  };
}

function readAnthropic(data: unknown): ChatReply {
  const d = data as { content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  if (!d.content) throw new ModelError('The AI service sent no answer.');
  return {
    text: d.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(''),
    toolCalls: d.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id ?? '', name: b.name ?? '', args: parseArgs(b.input) })),
    usage: { inputTokens: d.usage?.input_tokens ?? 0, outputTokens: d.usage?.output_tokens ?? 0 },
  };
}

/** Sends the conversation so far and returns the model's next turn. Throws ModelError on any failure. */
export async function chat(system: string, messages: ChatMessage[], tools: ToolSpec[], signal?: AbortSignal): Promise<ChatReply> {
  const config = getConfig();
  if (config.AI_PROVIDER === 'none') throw new ModelError('No AI provider is configured.');
  const maxTokens = config.AI_MAX_OUTPUT_TOKENS ?? 1_000;
  const openai = config.AI_PROVIDER === 'openai';
  const body = openai ? openaiBody(config.AI_MODEL!, system, messages, tools, maxTokens) : anthropicBody(config.AI_MODEL!, system, messages, tools, maxTokens);
  const timeout = AbortSignal.timeout(config.AI_TIMEOUT_SECONDS * 1000);
  let response: Response;
  try {
    response = await fetch(config.AI_API_URL!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(openai ? { authorization: `Bearer ${config.AI_API_KEY}` } : { 'x-api-key': config.AI_API_KEY!, 'anthropic-version': '2023-06-01' }),
      },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    throw new ModelError(`The AI service could not be reached: ${String(error)}`);
  }
  if (!response.ok) throw new ModelError(`The AI service answered ${response.status}.`);
  const data: unknown = await response.json().catch(() => {
    throw new ModelError('The AI service sent something that is not JSON.');
  });
  return openai ? readOpenai(data) : readAnthropic(data);
}
