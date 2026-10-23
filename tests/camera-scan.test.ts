import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ZXING_WASM_SHA256, ZXING_WASM_VERSION } from 'barcode-detector/ponyfill';
import { SCANNER_WASM_VERSION } from '@/components/features/camera-scan';

/**
 * The camera scanner's stand-in reader loads its WebAssembly file from public/vendor. If that copy and the installed
 * package ever disagree, scanning on laptops breaks: after updating barcode-detector, run npm run scanner:sync.
 */
describe('Camera scanner reader file', () => {
  it('is served from our own site, matching the installed reader exactly', () => {
    expect(SCANNER_WASM_VERSION).toBe(ZXING_WASM_VERSION);
    const file = path.join(process.cwd(), 'public/vendor', `zxing-wasm-${ZXING_WASM_VERSION}`, 'zxing_reader.wasm');
    expect(fs.existsSync(file), 'run npm run scanner:sync').toBe(true);
    expect(createHash('sha256').update(fs.readFileSync(file)).digest('hex')).toBe(ZXING_WASM_SHA256);
  });

  it('allows WebAssembly in the security policy, and nothing more', () => {
    const proxy = fs.readFileSync(path.join(process.cwd(), 'src/proxy.ts'), 'utf8');
    expect(proxy).toContain("'wasm-unsafe-eval'");
    // Plain eval stays off outside development.
    expect(proxy).toMatch(/\$\{dev \? ` 'unsafe-eval'` : ''\}/);
  });
});
