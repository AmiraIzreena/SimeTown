import { describe, expect, it } from 'vitest';
import { NAV } from '@/components/shell/nav';
import { translateMessage } from '@/lib/i18n-core';
import { malay } from '@/lib/i18n-messages';
import { extraMalay } from '@/lib/i18n-extra';
import { messageTemplates } from '@/lib/i18n-templates';
import { ACCESS_NEED_LABELS, ROLE_LABELS, REPORT_CATEGORY_LABELS, SPONSOR_TIER_INFO, PLACE_KIND_LABELS, MATERIAL_INFO } from '@/shared/domain';

describe('English and Bahasa Malaysia coverage', () => {
  it('covers navigation for every role and shared domain labels', () => {
    const labels = [
      ...Object.values(NAV).flatMap(area => [area.title, ...area.items.flatMap(item => [item.label, ...(item.gloss ? [item.gloss] : [])])]),
      ...Object.values(ROLE_LABELS), ...Object.values(ACCESS_NEED_LABELS), ...Object.values(REPORT_CATEGORY_LABELS), ...Object.values(PLACE_KIND_LABELS),
      ...Object.values(SPONSOR_TIER_INFO).flatMap(tier => [tier.label, ...tier.benefits]),
      ...Object.values(MATERIAL_INFO).flatMap(material => [material.label, material.tip]),
    ];
    const brands = new Set(['Kitar', 'Gerak', 'Lapor', 'Jiran', 'Kongsi', 'Jimat', 'Banjir', 'Tamu', 'Taman', 'Akses+', 'KITA Home']);
    for (const label of labels) {
      expect(brands.has(label) || Object.hasOwn(malay, label) || Object.hasOwn(extraMalay, label), label).toBe(true);
      expect(translateMessage('en', label)).toBe(label);
    }
  });

  it('translates the HQ report screen and preserves text whitespace', () => {
    expect(translateMessage('ms', 'Reports')).toBe('Laporan');
    expect(translateMessage('ms', '  Closed, no action ')).toBe('  Ditutup, tiada tindakan ');
    expect(translateMessage('ms', 'Pothole or road damage')).toBe('Jalan berlubang atau rosak');
    expect(translateMessage('ms', 'Your details, your password and your personal data.')).toBe('Butiran, kata laluan dan data peribadi anda.');
  });

  it('keeps every template placeholder, including amounts and names', () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\d+)\}/g)].map(m => m[1]).sort();
    for (const [en, ms] of messageTemplates) expect(placeholders(ms), en).toEqual(placeholders(en));
    expect(translateMessage('ms', 'Collect RM12.50 from Aisyah.')).toBe('Terima RM12.50 daripada Aisyah.');
    expect(translateMessage('ms', 'Your report is in progress')).toBe('Laporan anda sedang diproses');
    expect(translateMessage('ms', 'You have {n} points, worth {rm}.', { n: 300, rm: 'RM3.00' })).toBe('Anda ada 300 mata, bernilai RM3.00.');
  });

  it('localizes dates and elapsed time without translating arbitrary names', () => {
    expect(translateMessage('ms', '6 d ago')).toBe('6 hari lalu');
    expect(translateMessage('ms', '11 October 2026')).toBe('11 Oktober 2026');
    expect(translateMessage('ms', 'Sunday, 11 October')).toBe('Ahad, 11 Oktober');
    expect(translateMessage('ms', 'May')).toBe('May');
    expect(translateMessage('ms', 'Nur Aisyah · Jalan Melur 2/KT2')).toBe('Nur Aisyah · Jalan Melur 2/KT2');
    expect(translateMessage('ms', 'constructor')).toBe('constructor');
    expect(translateMessage('ms', 'A box of books')).toBe('A box of books');
    expect(translateMessage('ms', 'Aisyah is happy')).toBe('Aisyah is happy');
    expect(translateMessage('ms', '2 of 5')).toBe('2 daripada 5');
  });

  it('handles UI errors and does not corrupt URLs or currency', () => {
    expect(translateMessage('ms', 'The email or password is not correct.')).toBe('E-mel atau kata laluan tidak betul.');
    expect(translateMessage('ms', 'Too small: expected string to have >=10 characters')).toBe('Mesti mempunyai sekurang-kurangnya 10 aksara.');
    expect(translateMessage('ms', 'https://example.test/pass/ABC')).toBe('https://example.test/pass/ABC');
    expect(translateMessage('en', 'Collect RM12.50 from Aisyah.')).toBe('Collect RM12.50 from Aisyah.');
  });
});
