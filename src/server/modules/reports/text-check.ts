import { checkRudeByModel } from '../../ai/classifier';

/**
 * A first check on what a resident types into a Lapor report, before anything is saved: clear keyboard mash
 * ("asdfgh", "aaaaaa"), text with no words at all, and rude words in English and Malay, including their common short
 * forms and disguised spellings ("fk", "sh1t", "f*ck", "bgst"). It is deliberately narrow, so a genuine report is
 * almost never refused; when a hosted model is configured it catches the slang the list misses
 * (checkReportTextByModel). Returns a message per field, or null when the text is fine.
 */

// Whole words only, matched after disguises are undone (see normalise). Words that are also ordinary nouns in
// reports (such as "babi" for wild boar or "anjing" for stray dogs) are left out on purpose, and so are two-letter
// short forms that are also ordinary abbreviations ("cb", "bs", "lc"): the model judges those in context.
const RUDE = [
  'fuck', 'fucking', 'fucker', 'fucked', 'shit', 'bullshit', 'bitch', 'bastard', 'asshole', 'dick', 'dickhead', 'cunt', 'pussy', 'wanker', 'motherfucker',
  'fk', 'fck', 'fcuk', 'fuk', 'fuq', 'fking', 'fkin', 'fcking', 'fuking', 'fkn', 'wtf', 'stfu', 'sht', 'shyt', 'btch', 'biatch', 'mofo',
  'bodoh', 'bodo', 'bdoh', 'bodow', 'sial', 'siol', 'celaka', 'cilaka', 'keparat', 'bangsat', 'bgst', 'bngst', 'bangang', 'mampus',
  'pukimak', 'pukimek', 'puki', 'pkm', 'kimak', 'kmk', 'lancau', 'lanjiao', 'lanciau', 'butoh', 'pantat', 'sundal', 'haramjadah', 'bahlul', 'babai', 'cibai', 'pundek',
];
/** Rude words in the same collapsed form as normalised text, so "fuuuck" and "bulshit" still match. */
const RUDE_WORDS = new RegExp(`(^|[^a-z])(${[...new Set(RUDE.map(collapse))].join('|')})(?=[^a-z]|$)`, 'i');

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };

/** Repeated letters as one ("fuuuck" → "fuck", "bullshit" → "bulshit"). */
function collapse(word: string): string {
  return word.replace(/([a-z])\1+/g, '$1');
}

/**
 * Undoes the usual disguises: digits and symbols for letters within or at the start of a word ("sh1t", "b@ngsat",
 * "$hit"; a trailing "!" stays punctuation), stars, dots or dashes between letters ("f*ck", "f.u.c.k"), "haram jadah"
 * written apart, and stretched letters.
 */
function normalise(text: string): string {
  return collapse(
    text
      .toLowerCase()
      .replace(/[0-9@$!]+(?=[a-z])/g, (m) => [...m].map((c) => LEET[c] ?? c).join(''))
      .replace(/(?<=[a-z])[*._-]+(?=[a-z])/g, '')
      .replace(/haram\s+jadah/g, 'haramjadah'),
  );
}

const KEYBOARD_RUNS = ['qwert', 'werty', 'asdfg', 'sdfgh', 'dfghj', 'fghjk', 'ghjkl', 'zxcvb', 'xcvbn', 'cvbnm', 'poiuy', 'lkjhg', 'mnbvc', 'qazwsx'];

/**
 * True when the text reads as mash or as nothing at all. A place may be mostly numbers ("U16/171 No 4", "B-12-3A"),
 * so it only needs a couple of letters and skips the letters-to-symbols test.
 */
export function looksLikeJunk(text: string, kind: 'description' | 'place' = 'description'): boolean {
  const lower = text.toLowerCase();
  const letters = lower.match(/\p{L}/gu) ?? [];
  if (letters.length < (kind === 'place' ? 2 : 3)) return true; // only numbers and symbols, or a letter or two
  if (/(\p{L})\1{3,}/u.test(lower)) return true; // "aaaa", "hhhhh"
  if (KEYBOARD_RUNS.some((run) => lower.includes(run))) return true;
  const words = lower.match(/\p{L}+/gu) ?? [];
  // A long "word" with no vowel at all is a keyboard run (Malay and English words all have one).
  if (words.some((w) => w.length >= 6 && /^[a-z]+$/.test(w) && !/[aeiouy]/.test(w))) return true;
  // Mostly symbols and digits, with hardly any letters.
  if (kind === 'description' && letters.length / lower.replace(/\s/g, '').length < 0.4) return true;
  return false;
}

export const hasRudeWords = (text: string) => RUDE_WORDS.test(normalise(text));

const RUDE_DESCRIPTION = 'Please describe the problem without rude words.';
const RUDE_PLACE = 'Please give the place without rude words.';

export function checkReportText(input: { description: string; locationText: string }): Record<string, string> | null {
  const fields: Record<string, string> = {};
  if (hasRudeWords(input.description)) fields.description = RUDE_DESCRIPTION;
  else if (looksLikeJunk(input.description)) fields.description = 'Please describe the problem in a few words, so the township office can act on it.';
  if (hasRudeWords(input.locationText)) fields.locationText = RUDE_PLACE;
  else if (looksLikeJunk(input.locationText, 'place')) fields.locationText = 'Please name the street, landmark or nearest house, so it can be found.';
  return Object.keys(fields).length ? fields : null;
}

/**
 * Recent verdicts, so a report checked when its match is looked for is not sent to the model again when it is
 * saved a moment later. Small and in memory: losing it only costs one more call.
 */
const verdicts = new Map<string, { description: boolean; place: boolean } | null>();

/**
 * The model's second look, for text the word list let through. With no model configured, or when it does not
 * answer, the text is accepted: the list has already run, and a resident is never blocked by an outage.
 */
export async function checkReportTextByModel(input: { description: string; locationText: string }): Promise<Record<string, string> | null> {
  const key = JSON.stringify([input.description, input.locationText]);
  let verdict = verdicts.get(key);
  if (verdict === undefined) {
    verdict = await checkRudeByModel({ description: input.description, place: input.locationText });
    if (verdicts.size >= 200) verdicts.delete(verdicts.keys().next().value!);
    if (verdict) verdicts.set(key, verdict);
  }
  if (!verdict) return null;
  const fields: Record<string, string> = {};
  if (verdict.description) fields.description = RUDE_DESCRIPTION;
  if (verdict.place) fields.locationText = RUDE_PLACE;
  return Object.keys(fields).length ? fields : null;
}
