import { getConfig } from './config';
import { getDb } from './db/client';
import { runAccessChecks } from './modules/akses/automation';
import { runAgentClock } from './modules/banjir/agent';

/**
 * Local development only: run the flood agent every minute, as the live server's scheduler does with
 * POST /internal/jobs/flood-agent. Without it, nothing reads the (simulated) sensors, sends the
 * 15-minute updates or checks for the all clear unless staff have the Banjir console open, so the
 * public status page goes stale. It never runs outside APP_ENV=development, and FLOOD_DEV_CLOCK=off
 * turns it off. It changes no flood rule: it only calls the same job the scheduler would.
 * Every fifth minute it also runs the Akses+ checks (the `access` job): reminders, escalations, and routing
 * any accessibility problem still waiting for a team once one can take it.
 */

const EVERY_MS = 60_000;
const store = globalThis as unknown as { __kitaDevClock?: ReturnType<typeof setInterval> };

export function startDevClock() {
  const config = getConfig();
  if (config.APP_ENV !== 'development' || process.env.NODE_ENV === 'test' || process.env.FLOOD_DEV_CLOCK === 'off') return;
  if (store.__kitaDevClock) return; // one clock per process, also across hot reloads
  let running = false;
  let ticks = 0;
  const tick = async () => {
    if (running) return; // a slow run is never overlapped by the next one
    running = true;
    try {
      const db = await getDb();
      await runAgentClock(db, new Date());
      if (++ticks % 5 === 1) await runAccessChecks(db, new Date());
    } catch (error) {
      console.warn('[dev clock] flood agent run failed:', error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };
  store.__kitaDevClock = setInterval(() => void tick(), EVERY_MS);
  // The first run waits a little, so it never slows the server's first page.
  setTimeout(() => void tick(), 15_000);
  console.log('[dev clock] Flood agent runs every minute (local development only; FLOOD_DEV_CLOCK=off to stop).');
}
