import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { translate } from '@/lib/i18n';
import { translateMessage } from '@/lib/i18n-core';
import { PLAIN_ENTRIES, plainWording } from '@/lib/i18n-plain';

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : /\.(ts|tsx)$/.test(d.name) ? [path.join(dir, d.name)] : []));
const sources = walk('src').filter((file) => !/[\\/]i18n-[^\\/]+\.ts$/.test(file)).map((file) => fs.readFileSync(file, 'utf8'));
const css = fs.readFileSync('src/app/globals.css', 'utf8');

describe('Simple Mode plain wording', () => {
  // Built by the server from a template ("{0} not found."), so the whole sentence is not in the code.
  const BUILT = new Set(['Resource not found.', 'Endpoint not found.']);

  it('only lists sentences that residents can actually meet', () => {
    for (const [english] of PLAIN_ENTRIES) {
      if (BUILT.has(english)) continue;
      expect(sources.some((source) => source.replace(/\s+/g, ' ').includes(english)), english).toBe(true);
    }
  });

  it('gives a different, everyday version in both languages', () => {
    for (const [english, [en, ms]] of PLAIN_ENTRIES) {
      expect(en, english).not.toBe(english);
      expect(ms.length, english).toBeGreaterThan(0);
      expect(ms, english).not.toBe(en);
    }
  });

  it('keeps outer spaces and leaves other text alone', () => {
    expect(plainWording('en', 'Offer-backed points: ')).toBe('Points for Shop Offers: ');
    expect(plainWording('ms', 'Offer-backed points: ')).toBe('Mata untuk Tawaran Kedai: ');
    expect(plainWording('en', 'Points & XP')).toBeUndefined();
  });

  it('changes nothing outside Simple Mode', () => {
    for (const [english] of PLAIN_ENTRIES) {
      expect(translate('en', english)).toBe(translateMessage('en', english));
      expect(translate('ms', english)).toBe(translateMessage('ms', english));
    }
    expect(translate('en', 'Something went wrong. Please try again.', undefined, true)).toBe('We could not finish that. Please try again.');
    expect(translate('ms', 'Points & XP', undefined, true)).toBe(translateMessage('ms', 'Points & XP'));
  });
});

describe('Accessible view styles', () => {
  it('scales every small fixed pixel text size used in the app', () => {
    // A fixed size such as text-[15px] does not follow the type tokens, so Accessible view must map it.
    const used = new Set(sources.flatMap((source) => [...source.matchAll(/(?<![\w:-])text-\[(\d+)px\]/g)].map((match) => Number(match[1]))));
    for (const size of [...used].filter((px) => px < 24)) {
      expect(css.includes(`html[data-akses-view]`) && new RegExp(`html\\[data-akses-view\\][^{]*\\.text-\\\\\\[${size}px\\\\\\]`).test(css), `text-[${size}px]`).toBe(true);
    }
  });

  it('marks <html>, so dialogs, toasts and the bars follow both modes', () => {
    expect(css).toMatch(/html\[data-akses-view\] \{[^}]*--text-sm:/);
    expect(css).toMatch(/html\[data-simple-mode\] \{[^}]*--text-xs:/);
    // The old rules only reached the page body and could shrink large text.
    expect(css).not.toMatch(/#main\.akses-view :is\(p/);
  });
});
