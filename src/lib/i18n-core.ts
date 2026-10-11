import { malay } from './i18n-messages';
import { messageTemplates } from './i18n-templates';
import { extraMalay } from './i18n-extra';

export type Lang = 'en' | 'ms';
export const normalizeMessage = (text: string) => text.replace(/\s+/g, ' ').trim();
const lookup = (dictionary: Record<string, string>, key: string) => Object.hasOwn(dictionary, key) ? dictionary[key] : undefined;

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const templates = messageTemplates.map(([english, ms]) => {
  const ids: string[] = [];
  const parts = english.split(/(\{\d+\})/g);
  const pattern = parts.map((part) => {
    if (/^\{\d+\}$/.test(part)) {
      ids.push(part.slice(1, -1));
      // These short templates would otherwise match ordinary personal sentences.
      if (english.startsWith('{0} of {1}')) return '([\\d,.]+)';
      if (english === '{0} is {1}' && part === '{1}') return '(normal|warning|danger|offline|online)';
      if (english === '{0} in {1}.{2}' && part === '{0}') return '(Warning|Danger|Flood warning|Flood danger)';
      return '(.*?)';
    }
    return escapeRegex(part);
  }).join('');
  return { pattern: new RegExp(`^${pattern}$`, 's'), ids, ms, specificity: english.replace(/\{\d+\}/g, '').length };
}).sort((a, b) => b.specificity - a.specificity);

const calendarWords: Record<string, string> = {
  Monday: 'Isnin', Tuesday: 'Selasa', Wednesday: 'Rabu', Thursday: 'Khamis', Friday: 'Jumaat', Saturday: 'Sabtu', Sunday: 'Ahad',
  Mon: 'Isn', Tue: 'Sel', Wed: 'Rab', Thu: 'Kha', Fri: 'Jum', Sat: 'Sab', Sun: 'Ahd',
  January: 'Januari', February: 'Februari', March: 'Mac', April: 'April', May: 'Mei', June: 'Jun', July: 'Julai', August: 'Ogos', September: 'September', October: 'Oktober', November: 'November', December: 'Disember',
  Jan: 'Jan', Feb: 'Feb', Mar: 'Mac', Apr: 'Apr', Jun: 'Jun', Jul: 'Jul', Aug: 'Ogo', Sept: 'Sep', Sep: 'Sep', Oct: 'Okt', Nov: 'Nov', Dec: 'Dis',
};

function translateGenerated(text: string): string | undefined {
  const validation = /^Too (small|big): expected (string|number|array) to have ([<>]=)(\d+) (characters|items)$/.exec(text);
  if (validation) return `Mesti mempunyai ${validation[1] === 'small' ? 'sekurang-kurangnya' : 'maksimum'} ${validation[4]} ${validation[5] === 'characters' ? 'aksara' : 'item'}.`;
  if (/^Invalid (input|option):/.test(text)) return 'Sila masukkan nilai yang sah.';
  if (text.endsWith(' (cancelled)')) return `${translateMessage('ms', text.slice(0, -12))} (dibatalkan)`;
  if (text.includes(' · ') && text.startsWith('+')) return text.split(' · ').map(part => translateMessage('ms', part)).join(' · ');
  const relative = /^(\d+) (min|h|d) ago$/.exec(text);
  if (relative) return `${relative[1]} ${{ min: 'min', h: 'j', d: 'hari' }[relative[2]!]} lalu`;
  // Only date-shaped application values, never a person's name such as May.
  if (/^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,? )?\d{1,2} [A-Z][a-z]+(?: \d{4})?(?:,? (?:at )?\d{1,2}:\d{2}(?: ?[ap]m)?)?$/.test(text) || /^[A-Z][a-z]+ \d{4}$/.test(text)) {
    return text.replace(/[A-Za-z]+/g, word => calendarWords[word] ?? word);
  }
  for (const { pattern, ids, ms } of templates) {
    const match = pattern.exec(text);
    if (!match) continue;
    const semanticValues = new Set(['normal', 'warning', 'danger', 'low', 'medium', 'high', 'urgent', 'tomorrow from 9am', 'from now', 'in progress', 'resolved', 'rejected', 'closed', 's']);
    const values = Object.fromEntries(ids.map((id, i) => {
      const value = match[i + 1] ?? '';
      return [id, value === 's' ? '' : semanticValues.has(value) ? (extraMalay[value] ?? malay[value] ?? value) : value];
    }));
    return ms.replace(/\{(\d+)\}/g, (_, id: string) => values[id] ?? '');
  }
  return undefined;
}

/** Only application messages belong in the catalogue. Personal content is left verbatim. */
export function translateMessage(lang: Lang, text: string, vars?: Record<string, string | number>): string {
  const key = normalizeMessage(text);
  const translated = lang === 'ms' ? (lookup(extraMalay, key) ?? lookup(malay, key) ?? translateGenerated(key)) : undefined;
  const base = translated === undefined ? text : text.replace(/\S[\s\S]*\S|\S/, () => translated);
  return vars ? base.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`)) : base;
}
