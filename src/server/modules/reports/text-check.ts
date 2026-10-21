/**
 * A first check on what a resident types into a Lapor report, before anything is saved: clear keyboard mash
 * ("asdfgh", "aaaaaa"), text with no words at all, and a short list of rude words in English and Malay. It is
 * deliberately narrow, so a genuine report is almost never refused; the issue threshold and the written titles do
 * the rest. Returns a message per field, or null when the text is fine.
 */

// Whole words only. Words that are also ordinary nouns in reports (such as "babi" for wild boar or "anjing" for
// stray dogs) are left out on purpose.
const RUDE = [
  'fuck', 'fucking', 'fucker', 'shit', 'bullshit', 'bitch', 'bastard', 'asshole', 'dick', 'cunt', 'pussy', 'wanker', 'motherfucker',
  'bodoh', 'sial', 'celaka', 'keparat', 'bangsat', 'pukimak', 'puki', 'kimak', 'lancau', 'butoh', 'pantat', 'sundal', 'haramjadah', 'bahlul', 'babai',
];
const RUDE_WORDS = new RegExp(`(^|[^a-z])(${RUDE.join('|')})(?=[^a-z]|$)`, 'i');

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

export const hasRudeWords = (text: string) => RUDE_WORDS.test(text);

export function checkReportText(input: { description: string; locationText: string }): Record<string, string> | null {
  const fields: Record<string, string> = {};
  if (hasRudeWords(input.description)) fields.description = 'Please describe the problem without rude words.';
  else if (looksLikeJunk(input.description)) fields.description = 'Please describe the problem in a few words, so the township office can act on it.';
  if (hasRudeWords(input.locationText)) fields.locationText = 'Please give the place without rude words.';
  else if (looksLikeJunk(input.locationText, 'place')) fields.locationText = 'Please name the street, landmark or nearest house, so it can be found.';
  return Object.keys(fields).length ? fields : null;
}
