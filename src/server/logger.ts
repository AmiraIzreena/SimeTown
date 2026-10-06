/**
 * Structured JSON logs on stdout/stderr. The host (container platform, Cloudflare
 * Logpush, etc.) collects them; no logging dependency is needed.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

// Read directly so logging works even when the rest of the configuration is invalid.
const threshold = LEVELS[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? LEVELS.info;

function write(level: Level, message: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < threshold) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...fields });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const log = {
  debug: (message: string, fields?: Record<string, unknown>) => write('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
  error: (message: string, error?: unknown, fields?: Record<string, unknown>) =>
    write('error', message, {
      ...fields,
      ...(error instanceof Error ? { error: error.message, stack: error.stack } : error !== undefined ? { error: String(error) } : {}),
    }),
};
