import { z } from 'zod';

/**
 * The only place environment variables are read. Everything else imports
 * `getConfig()`, so a missing or malformed value fails fast with a clear message.
 */
const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
    APP_URL: z.url(),
    DATABASE_URL: z.string().min(1),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DB_SSL: z.enum(['require', 'disable']).optional(),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(168),
    TRUST_PROXY: z.enum(['none', 'cloudflare', 'forwarded']).default('none'),
    // With TRUST_PROXY=forwarded: how many proxies you run in front of the app. Each appends one address.
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(5).default(1),
    CRON_SECRET: z.string().min(32).optional(),
    SENSOR_INGEST_TOKEN: z.string().min(32).optional(),
    // Derives smart-locker pickup PINs and QR codes, which are never stored. Required in production to use lockers.
    LOCKER_CREDENTIAL_SECRET: z.string().min(32).optional(),
    AI_PROVIDER: z.enum(['none', 'anthropic', 'openai']).default('none'),
    AI_API_URL: z.url().optional(),
    AI_API_KEY: z.string().min(1).optional(),
    AI_MODEL: z.string().min(1).optional(),
    // Reasoning models spend hidden tokens before they answer: raise both for them.
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(100).max(32_000).optional(),
    AI_TIMEOUT_SECONDS: z.coerce.number().int().min(2).max(120).default(8),
    // Questions each resident may ask the AI Assistant in 24 hours (cost control). Rule answers do not count.
    AI_ASSISTANT_DAILY_LIMIT: z.coerce.number().int().min(1).max(2_000).default(100),
    // Optional: a water-level model server (for example a CNN trained on township CCTV frames). When set, it reads
    // drain camera photos instead of the hosted AI. Contract: POST JSON {image, mime} → {levelPct, confidence}.
    FLOOD_MODEL_URL: z.url().optional(),
    FLOOD_MODEL_TOKEN: z.string().min(16).optional(),
    // Optional Upstash Redis (REST). Rate limits and the session cache use it; without it they use PostgreSQL alone.
    UPSTASH_REDIS_REST_URL: z.url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(20).optional(),
    // How long a sign-in lookup may be served from Redis. 0 turns the cache off.
    SESSION_CACHE_SECONDS: z.coerce.number().int().min(0).max(300).default(60),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    // Optional: the mail account SimeTown sends email from (for example Gmail with an App Password). Without it,
    // emails wait in the outbox and are never sent. Port 465 uses TLS from the start; 587 upgrades with STARTTLS.
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(465),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASS: z.string().min(1).optional(),
    // The address shown as the sender. Defaults to SMTP_USER.
    SMTP_FROM: z.email().optional(),
  })
  .superRefine((env, ctx) => {
    const hosted = env.APP_ENV !== 'development';
    if (hosted && env.DATABASE_URL.startsWith('pglite:')) {
      ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'pglite is for local development and tests only' });
    }
    if (hosted && !env.APP_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'must be https outside development' });
    }
    // Without a trusted proxy the client address can be forged, so per-address limits would mean nothing.
    if (hosted && env.TRUST_PROXY === 'none') {
      ctx.addIssue({ code: 'custom', path: ['TRUST_PROXY'], message: 'set to cloudflare or forwarded outside development (see docs/DEPLOYMENT.md)' });
    }
    if (!env.UPSTASH_REDIS_REST_URL !== !env.UPSTASH_REDIS_REST_TOKEN) {
      ctx.addIssue({ code: 'custom', path: ['UPSTASH_REDIS_REST_URL'], message: 'set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN together, or neither' });
    }
    // The token travels in every request header, so it must never cross the network in clear text.
    if (env.UPSTASH_REDIS_REST_URL && !env.UPSTASH_REDIS_REST_URL.startsWith('https://') && hosted) {
      ctx.addIssue({ code: 'custom', path: ['UPSTASH_REDIS_REST_URL'], message: 'must be https outside development' });
    }
    // A photo of a drain goes to the model server, so it must not cross the network in clear text.
    if (env.FLOOD_MODEL_URL && !env.FLOOD_MODEL_URL.startsWith('https://') && hosted) {
      ctx.addIssue({ code: 'custom', path: ['FLOOD_MODEL_URL'], message: 'must be https outside development' });
    }
    if (env.SMTP_HOST && !(env.SMTP_USER && env.SMTP_PASS)) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'SMTP_USER and SMTP_PASS are required when SMTP_HOST is set' });
    }
    if (env.AI_PROVIDER !== 'none' && !(env.AI_API_KEY && env.AI_MODEL)) {
      ctx.addIssue({ code: 'custom', path: ['AI_PROVIDER'], message: 'AI_API_KEY and AI_MODEL are required when AI_PROVIDER is set' });
    }
  });

export type Config = z.infer<typeof schema> & { appOrigin: string; secureCookies: boolean; dbSsl: boolean };

let cached: Config | undefined;

/** Each provider's own endpoint, used when AI_API_URL is not set (set it for a proxy or a compatible service). */
const AI_DEFAULT_URLS = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/chat/completions',
} as const;

/** Validates a set of environment variables. Exported for tests; the app uses `getConfig()`. */
export function parseConfig(source: Record<string, string | undefined>): Config {
  // An empty value (as docker compose passes for unset optional variables) means "not set".
  const parsed = schema.safeParse(Object.fromEntries(Object.entries(source).filter(([, value]) => value !== '')));
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${lines}\nSee .env.example.`);
  }
  const env = parsed.data;
  return {
    ...env,
    AI_API_URL: env.AI_API_URL ?? (env.AI_PROVIDER === 'none' ? undefined : AI_DEFAULT_URLS[env.AI_PROVIDER]),
    appOrigin: new URL(env.APP_URL).origin,
    secureCookies: env.APP_URL.startsWith('https://'),
    dbSsl: (env.DB_SSL ?? (env.APP_ENV === 'development' ? 'disable' : 'require')) === 'require',
  };
}

export function getConfig(): Config {
  cached ??= parseConfig(process.env);
  return cached;
}
