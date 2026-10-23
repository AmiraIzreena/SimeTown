import { describe, expect, it } from 'vitest';
import { parseConfig } from '@/server/config';

/**
 * Development mode uses fallback keys written in the public code, so it may only run on your own computer or local
 * network. A hosted demo runs as staging (demo data allowed), a real launch as production.
 */
describe('Where development mode may run', () => {
  const dev = (APP_URL: string) => parseConfig({ APP_ENV: 'development', APP_URL, DATABASE_URL: 'pglite://memory' });

  it('runs on your own computer, a local network and test names', () => {
    for (const url of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000', 'http://kita.test', 'http://app.localhost', 'http://192.168.1.20:3000', 'http://10.0.0.5:3000', 'http://172.20.1.1:3000']) {
      expect(() => dev(url), url).not.toThrow();
    }
  });

  it('refuses a public address, so public fallback keys are never used by a hosted copy', () => {
    for (const url of ['https://simetown.onrender.com', 'http://simetown.example.com', 'http://8.8.8.8', 'http://172.32.0.1', 'https://192.168.1.20.nip.io']) {
      expect(() => dev(url), url).toThrow(/APP_ENV/);
    }
  });

  it('lets a hosted demo run as staging, with the usual hosted checks', () => {
    const hosted = { APP_ENV: 'staging', APP_URL: 'https://simetown.example.com', DATABASE_URL: 'postgres://u:p@db/kita', TRUST_PROXY: 'forwarded' };
    expect(parseConfig(hosted).APP_ENV).toBe('staging');
    expect(() => parseConfig({ ...hosted, APP_URL: 'http://simetown.example.com' })).toThrow(/https/);
    expect(() => parseConfig({ ...hosted, TRUST_PROXY: 'none' })).toThrow(/TRUST_PROXY/);
  });
});
