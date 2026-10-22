/**
 * Runs once when the Next.js server starts. In local development only, it starts the flood agent's
 * clock, so the demo behaves like the live server, where a scheduler calls the `flood-agent` job.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startDevClock } = await import('./server/dev-clock');
    startDevClock();
  }
}
