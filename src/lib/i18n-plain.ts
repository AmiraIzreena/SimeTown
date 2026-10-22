import type { Lang } from './i18n-core';

/**
 * Plain wording for Simple Mode (Akses+). Each entry is a sentence residents can meet that uses technical words,
 * with an everyday version in English and Bahasa Malaysia that keeps the same meaning: no rule, amount or warning
 * is dropped. Only Simple Mode reads these; every other mode shows the original sentence.
 *
 * Keys are the English text exactly as written in the code (spacing is ignored).
 */
const PLAIN: Record<string, readonly [en: string, ms: string]> = {
  // Errors from the server or the network.
  'Something went wrong. Please try again.': ['We could not finish that. Please try again.', 'Kami tidak dapat menyelesaikannya. Sila cuba lagi.'],
  'Too many requests. Please wait a moment and try again.': ['You tried many times in a row. Please wait a moment, then try again.', 'Anda mencuba banyak kali berturut-turut. Sila tunggu sebentar, kemudian cuba lagi.'],
  'Please check the highlighted fields.': ['Some answers need fixing. Read the message under each one.', 'Beberapa jawapan perlu dibetulkan. Baca mesej di bawah setiap satu.'],
  'You do not have permission to do this.': ['Your account cannot do this.', 'Akaun anda tidak boleh melakukan ini.'],
  'A value in the request is out of range.': ['One of your answers is too big or too small. Please check it and try again.', 'Salah satu jawapan anda terlalu besar atau terlalu kecil. Sila semak dan cuba lagi.'],
  'An id in the request is not valid.': ['We could not find what you chose. Please go back and try again.', 'Kami tidak dapat mencari pilihan anda. Sila kembali dan cuba lagi.'],
  'The request is too large.': ['That is too big to send. Try a smaller photo or a shorter message.', 'Itu terlalu besar untuk dihantar. Cuba gambar yang lebih kecil atau mesej yang lebih pendek.'],
  'The form could not be read.': ['We could not read what you sent. Please try again.', 'Kami tidak dapat membaca apa yang anda hantar. Sila cuba lagi.'],
  'This action is not available here.': ['You cannot do this here.', 'Anda tidak boleh melakukan ini di sini.'],
  'Resource not found.': ['We could not find this. It may have been removed.', 'Kami tidak menjumpai ini. Mungkin ia telah dibuang.'],
  'Endpoint not found.': ['We could not find this. It may have been removed.', 'Kami tidak menjumpai ini. Mungkin ia telah dibuang.'],

  // Points & XP: "offer-backed", "cash-backed" and "float" are finance words.
  'Your offer-backed points': ['Your points for Shop Offers', 'Mata anda untuk Tawaran Kedai'],
  'Cash-backed points:': ['Points paid for with money:', 'Mata yang dibayar dengan wang:'],
  'Offer-backed points:': ['Points for Shop Offers:', 'Mata untuk Tawaran Kedai:'],
  'Two kinds of backing': ['Two kinds of points', 'Dua jenis mata'],
  'Cash-backed points have money in the locked reward float behind them. Offer-backed points are backed by discounts township shops pledged for the month, and are used on a Shop Offer.': [
    'Some points have real money set aside for them, locked in the reward fund. Other points come from discounts that township shops promised for this month. You use those on a Shop Offer.',
    'Sesetengah mata mempunyai wang sebenar yang diketepikan untuknya, dikunci dalam dana ganjaran. Mata lain datang daripada diskaun yang dijanjikan kedai perbandaran untuk bulan ini. Anda menggunakannya pada Tawaran Kedai.',
  ],
  'Earn them from verified green actions: recycling at a kiosk bin, and tracked walks and rides.': [
    'Earn them by doing green things that are checked: recycling at a kiosk bin, and walks and rides you track in the app.',
    'Dapatkannya dengan aktiviti hijau yang disemak: kitar semula di tong kiosk, dan berjalan serta berbasikal yang anda jejak dalam aplikasi.',
  ],

  // Akses+ place reports.
  'Thank you. It shows as pending until staff inspect it; a verified place earns Impact XP.': [
    'Thank you. Staff will check this place. Until then it shows as pending. Once they confirm it, you earn Impact XP.',
    'Terima kasih. Kakitangan akan memeriksa tempat ini. Sehingga itu ia ditunjukkan sebagai menunggu. Selepas mereka mengesahkannya, anda mendapat XP Impak.',
  ],
  'Thank you. Your answer helps verify the fix.': ['Thank you. Your answer helps us check that it is really fixed.', 'Terima kasih. Jawapan anda membantu kami memastikan ia benar-benar dibaiki.'],
};

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Simple Mode's everyday version of `text`, or undefined when the sentence is already plain. Keeps outer spaces. */
export function plainWording(lang: Lang, text: string): string | undefined {
  const entry = Object.hasOwn(PLAIN, normalize(text)) ? PLAIN[normalize(text)] : undefined;
  if (!entry) return undefined;
  const lead = /^\s*/.exec(text)![0];
  const trail = /\s*$/.exec(text)![0];
  return `${lead}${entry[lang === 'ms' ? 1 : 0]}${trail}`;
}

/** Every plain sentence, for tests. */
export const PLAIN_ENTRIES = Object.entries(PLAIN);
