import { malay } from './i18n-messages';
import { messageTemplates } from './i18n-templates';
import { extraMalay } from './i18n-extra';

export type Lang = 'en' | 'ms';
export const normalizeMessage = (text: string) => text.replace(/\s+/g, ' ').trim();
const lookup = (dictionary: Record<string, string>, key: string) => Object.hasOwn(dictionary, key) ? dictionary[key] : undefined;

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** "{0} word" templates whose value is a name or a word, not a number. */
const NAMED_COUNT_TEMPLATES = new Set([
  '{0} is expected today', '{0} is approved', '{0} not found.', '{0} will fix it', '{0} assurance', '{0} (simulated)',
  '{0} (simulated sign-in)', '{0} is full', '{0} clear', '{0} assigned to you', '{0} has no responders.',
]);
/**
 * Count templates ("{0} points", "{0} verified") and the date range "{0} to {1}" are only ever filled with a
 * number, amount, distance or date. Requiring a digit keeps them from matching ordinary sentences that end
 * with the same word ("Also earns offer-backed points", "It is verified"), which would come out half translated.
 */
const isCountTemplate = (english: string) =>
  english === '{0} to {1}' || (
    /^\{0\} [a-z]/.test(english) && !/\{[1-9]\}/.test(english) && !NAMED_COUNT_TEMPLATES.has(english)
    // A short tail ("{0} points", "{0} days left"); a longer one is a sentence about someone ("{0} asked you to …"),
    // and so is one that starts with a verb ("{0} is expected").
    && english.slice(4).trim().split(/\s+/).length <= 3
    && !/^\{0\} (is|has|was|will|needs|asked|applied|went|says|said|signed)\b/.test(english)
  );
/**
 * Templates that only give a sentence its shape ("Label (details).") and add no Malay of their own: they
 * translate a part only when the catalogue has it word for word, so a person's own text is never mixed.
 */
const SHAPE_ONLY_TEMPLATES = new Set(['{0}.', '{0} ({1}).', '{0} ({1})']);
/**
 * Case summaries with several parts in brackets. No part contains a bracket, and saying so keeps matching linear:
 * four open parts would otherwise backtrack for seconds on a long, repetitive comment.
 */
const NO_BRACKET_TEMPLATES = new Set(['{0} ({1}, {2} door {3}).', '{0} ({1}, shelf {2}).']);
const templates = messageTemplates.map(([english, ms]) => {
  const ids: string[] = [];
  /** Placeholders limited to a fixed list of application words: their value is translated too. */
  const fixed = new Set<string>();
  const parts = english.split(/(\{\d+\})/g);
  const pattern = parts.map((part) => {
    if (/^\{\d+\}$/.test(part)) {
      ids.push(part.slice(1, -1));
      // These short templates would otherwise match ordinary personal sentences.
      if (english.startsWith('{0} of {1}')) return '([\\d,.]+)';
      // A count template's value starts with the number: "3", "RM5.00", "+2", "1.2 km", "Tue, 3 Nov".
      if (part === '{0}' && isCountTemplate(english)) return '((?:RM ?|[+\\-−~≈]|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,? )?\\d.*?)';
      if (NO_BRACKET_TEMPLATES.has(english)) return '([^()]*?)';
      if (english === '{0} is {1}' && part === '{1}') return fixed.add(part.slice(1, -1)), '(normal|warning|danger|offline|online|full)';
      if (english === '{0} in {1}.{2}' && part === '{0}') return fixed.add(part.slice(1, -1)), '(Warning|Danger|Flood warning|Flood danger|Update: flood warning continues|Update: flood danger continues)';
      return '(.*?)';
    }
    return escapeRegex(part);
  }).join('');
  return {
    pattern: new RegExp(`^${pattern}$`, 's'),
    ids,
    fixed,
    ms,
    // "{0} ({1})." keeps its shape in Malay: it only translates the parts the catalogue knows word for word.
    shapeOnly: SHAPE_ONLY_TEMPLATES.has(english),
    // A template whose placeholder only takes listed words is the most precise match, so it goes first.
    specificity: english.replace(/\{\d+\}/g, '').length + (fixed.size ? 1_000 : 0),
  };
}).sort((a, b) => b.specificity - a.specificity);

const calendarWords: Record<string, string> = {
  Monday: 'Isnin', Tuesday: 'Selasa', Wednesday: 'Rabu', Thursday: 'Khamis', Friday: 'Jumaat', Saturday: 'Sabtu', Sunday: 'Ahad',
  Mon: 'Isn', Tue: 'Sel', Wed: 'Rab', Thu: 'Kha', Fri: 'Jum', Sat: 'Sab', Sun: 'Ahd',
  January: 'Januari', February: 'Februari', March: 'Mac', April: 'April', May: 'Mei', June: 'Jun', July: 'Julai', August: 'Ogos', September: 'September', October: 'Oktober', November: 'November', December: 'Disember',
  Jan: 'Jan', Feb: 'Feb', Mar: 'Mac', Apr: 'Apr', Jun: 'Jun', Jul: 'Jul', Aug: 'Ogo', Sept: 'Sep', Sep: 'Sep', Oct: 'Okt', Nov: 'Nov', Dec: 'Dis',
};

/** Only date-shaped application values, never a person's name such as May. */
const dateShaped = (text: string) =>
  /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,? )?\d{1,2} [A-Z][a-z]+(?: \d{4})?(?:,? (?:at )?\d{1,2}:\d{2}(?: ?[ap]m)?)?$/.test(text) || /^[A-Z][a-z]+ \d{4}$/.test(text);

/**
 * Limits that keep translation fast on any input, such as a very long or repetitive comment: a value inside a
 * message is translated at most 3 levels deep and only when it is a short phrase, and templates are not tried on
 * text far longer than any of them.
 */
const MAX_DEPTH = 3;
const MAX_NESTED_LENGTH = 500;
const MAX_TEMPLATE_INPUT = 4_000;
let depth = 0;
const nested = (value: string) => (depth < MAX_DEPTH && value.length <= MAX_NESTED_LENGTH ? translateMessage('ms', value) : value);

function translateGenerated(text: string): string | undefined {
  depth += 1;
  try {
    return translateGeneratedAt(text);
  } finally {
    depth -= 1;
  }
}

function translateGeneratedAt(text: string): string | undefined {
  const validation = /^Too (small|big): expected (string|number|array) to have ([<>]=)(\d+) (characters|items)$/.exec(text);
  if (validation) return `Mesti mempunyai ${validation[1] === 'small' ? 'sekurang-kurangnya' : 'maksimum'} ${validation[4]} ${validation[5] === 'characters' ? 'aksara' : 'item'}.`;
  if (/^Invalid (input|option):/.test(text)) return 'Sila masukkan nilai yang sah.';
  if (text.endsWith(' (cancelled)')) return `${nested(text.slice(0, -12))} (dibatalkan)`;
  if (text.includes(' · ') && text.startsWith('+')) return text.split(' · ').map(part => nested(part)).join(' · ');
  const relative = /^(\d+) (min|h|d) ago$/.exec(text);
  if (relative) return `${relative[1]} ${{ min: 'min', h: 'j', d: 'hari' }[relative[2]!]} lalu`;
  // Only date-shaped application values, never a person's name such as May.
  if (dateShaped(text)) {
    return text.replace(/[A-Za-z]+/g, word => calendarWords[word] ?? word);
  }
  if (text.length > MAX_TEMPLATE_INPUT) return undefined;
  for (const { pattern, ids, fixed, ms, shapeOnly } of templates) {
    const match = pattern.exec(text);
    if (!match) continue;
    if (shapeOnly) {
      const parts = ids.map((_, i) => match[i + 1] ?? '');
      // A catalogue phrase, a date or a relative time ("2 h ago"); anything else stays exactly as written.
      const known = parts.map((part) => {
        const p = part.trim();
        return lookup(extraMalay, p) ?? lookup(malay, p) ?? (dateShaped(p) || /^\d+ (min|h|d) ago$/.test(p) ? nested(p) : undefined);
      });
      if (known.every((k) => k === undefined)) continue;
      const values = Object.fromEntries(ids.map((id, i) => [id, known[i] ?? parts[i]]));
      return ms.replace(/\{(\d+)\}/g, (_, id: string) => values[id] ?? '');
    }
    const semanticValues = new Set(['normal', 'warning', 'danger', 'low', 'medium', 'high', 'urgent', 'tomorrow from 9am', 'from now', 'in progress', 'resolved', 'rejected', 'closed', 's']);
    const values = Object.fromEntries(ids.map((id, i) => {
      const value = match[i + 1] ?? '';
      if (value === 's') return [id, ''];
      if (semanticValues.has(value) || fixed.has(id)) return [id, extraMalay[value] ?? malay[value] ?? value];
      // A whole application sentence ("Water is at 92%.") or a date ("Tue, 3 Nov, 3:00 pm") inside a
      // message is translated as well; anything not in the catalogue, such as a township's own
      // safe-route text, stays as written.
      if ((/\s/.test(value.trim()) && /[.!?]$/.test(value.trim())) || dateShaped(value.trim())) return [id, nested(value)];
      // So are a count, amount or time ("3 times", "2 h ago", "RM5.00 left") and a whole phrase the
      // catalogue knows ("just now", "A vehicle is blocking it"). A name or a single word stays as written.
      const trimmed = value.trim();
      if (/^(?:RM ?)?\d/.test(trimmed) || (/\s/.test(trimmed) && (lookup(extraMalay, trimmed) ?? lookup(malay, trimmed)) !== undefined)) return [id, nested(value)];
      return [id, value];
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
