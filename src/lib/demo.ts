/**
 * Demo environment (NEXT_PUBLIC_DEMO_MODE, on unless set to "false"). In demo mode the
 * app carries one consistent marker instead of explanations on every screen, and shows
 * the notes on simulated parts (sensors, machine, payments) that a real launch would not have.
 */
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false';
