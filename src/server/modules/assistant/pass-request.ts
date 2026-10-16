/**
 * Reads a visitor pass request written in English or Bahasa Malaysia, for the
 * Assistant's rules (the AI fills the same fields itself). Only what the
 * resident actually said is returned; anything missing is left for the
 * defaults, and the resident can change every detail on the card before Yes.
 *
 *   "Make a visitor pass for Ali tomorrow at 3pm for 4 hours"
 *   "Buat pas pelawat untuk Ali esok pukul 3 petang selama 2 jam"
 *   "Pass for Siti on Saturday 10am, car WXY 1234"
 */

export interface PassRequest {
  visitorName?: string;
  /** YYYY-MM-DD in the township's own time zone. */
  date?: string;
  /** HH:MM, 24-hour. */
  startTime?: string;
  hours?: number;
  type?: 'ONE_VISIT' | 'DELIVERY' | 'EVENT';
  vehicleNo?: string;
}

const WEEKDAYS: [RegExp, number][] = [
  [/\b(sunday|sun|ahad)\b/i, 0],
  [/\b(monday|mon|isnin)\b/i, 1],
  [/\b(tuesday|tues?|selasa)\b/i, 2],
  [/\b(wednesday|wed|rabu)\b/i, 3],
  [/\b(thursday|thurs?|khamis)\b/i, 4],
  [/\b(friday|fri|jumaat|jumat)\b/i, 5],
  [/\b(saturday|sat|sabtu)\b/i, 6],
];
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, januari: 1, feb: 2, february: 2, februari: 2, mar: 3, march: 3, mac: 3, apr: 4, april: 4,
  may: 5, mei: 5, jun: 6, june: 6, jul: 7, july: 7, julai: 7, aug: 8, august: 8, ogos: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, okt: 10, oktober: 10, nov: 11, november: 11, dec: 12, december: 12, dis: 12, disember: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const validDay = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? iso(date) : undefined;
};

/** The day the resident meant, given today's date in the township (YYYY-MM-DD). */
function readDate(text: string, today: string): string | undefined {
  const t = text.toLowerCase();
  const year = Number(today.slice(0, 4));
  const isoDate = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(t);
  if (isoDate) return validDay(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]));
  // "20 Oct", "20 October", "20 Okt" (this year, or next year if it has passed).
  const named = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\b/.exec(t);
  if (named && MONTHS[named[2]!]) {
    const day = validDay(year, MONTHS[named[2]!]!, Number(named[1]));
    return day && day < today ? validDay(year + 1, MONTHS[named[2]!]!, Number(named[1])) : day;
  }
  // "20/10" or "20/10/2026", day first as in Malaysia.
  const slashed = /\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/.exec(t);
  if (slashed) {
    const day = validDay(Number(slashed[3] ?? year), Number(slashed[2]), Number(slashed[1]));
    return day && !slashed[3] && day < today ? validDay(year + 1, Number(slashed[2]), Number(slashed[1])) : day;
  }
  if (/\b(day after tomorrow|lusa)\b/.test(t)) return addDays(today, 2);
  if (/\b(tomorrow|esok|besok)\b/.test(t)) return addDays(today, 1);
  if (/\b(today|tonight|hari ini|malam ini|petang ini|pagi ini)\b/.test(t)) return today;
  for (const [pattern, weekday] of WEEKDAYS) {
    if (pattern.test(t)) {
      const now = new Date(`${today}T00:00:00Z`).getUTCDay();
      // The coming one; "next Saturday" said on a Saturday means a week on.
      const ahead = (weekday - now + 7) % 7 || (/\bnext\b|\bdepan\b/.test(t) ? 7 : 0);
      return addDays(today, ahead);
    }
  }
  return undefined;
}

/** The start time, from "3pm", "3:30 pm", "15:00", "pukul 3 petang", "10 pagi" or "noon". */
function readTime(text: string): string | undefined {
  const t = text.toLowerCase();
  const clock = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/.exec(t);
  if (clock) {
    let h = Number(clock[1]);
    const m = Number(clock[2] ?? 0);
    if (h < 1 || h > 12 || m > 59) return undefined;
    const pm = clock[3]!.startsWith('p');
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
    return `${pad(h)}:${pad(m)}`;
  }
  const malay = /\b(?:pukul|jam)?\s*(\d{1,2})(?:[:.](\d{2}))?\s*(pagi|tengah hari|petang|malam)\b/.exec(t);
  if (malay) {
    let h = Number(malay[1]);
    const m = Number(malay[2] ?? 0);
    if (h < 1 || h > 12 || m > 59) return undefined;
    if (malay[3] === 'pagi' && h === 12) h = 0;
    if ((malay[3] === 'petang' || malay[3] === 'malam' || malay[3] === 'tengah hari') && h < 12) h = malay[3] === 'tengah hari' && h >= 11 ? h : h + 12;
    return `${pad(h)}:${pad(m)}`;
  }
  const twentyFour = /\b(?:at|pukul|jam)?\s*([01]?\d|2[0-3])[:.]([0-5]\d)\b/.exec(t);
  if (twentyFour) return `${pad(Number(twentyFour[1]))}:${twentyFour[2]}`;
  const plain = /\b(?:at|pukul|jam)\s+(\d{1,2})\b(?!\s*(?:hours?|hrs?|jam))/.exec(t);
  if (plain && Number(plain[1]) <= 23) return `${pad(Number(plain[1]))}:00`;
  // Plain "noon" last, so "1 tengah hari" (1pm) is read as a time above first.
  if (/\b(noon|midday|tengah hari)\b/.test(t)) return '12:00';
  return undefined;
}

export function parsePassRequest(text: string, today: string): PassRequest {
  const request: PassRequest = {};
  // The first "for …" / "untuk …" that is a name: "for tomorrow" and "for the party" are not.
  const names = text.matchAll(/(?:\bfor|\buntuk)\s+([\p{L}][\p{L}'-]*(?:\s+(?!(?:tomorrow|today|tonight|esok|besok|lusa|hari|at|on|pada|pukul|jam|from|dari|next|this|for|selama|to|until|hingga|sampai|with|dengan|car|kereta|plate|plat|and|dan|ini|day|minggu)\b)[\p{L}][\p{L}'-]*){0,3})/giu);
  for (const match of names) {
    const candidate = match[1]!.trim();
    if (/^(hours?|hrs?|jam|tomorrow|today|tonight|esok|besok|lusa|delivery|penghantaran|event|majlis|the|a|an|my|saya|me|us|kami)\b/i.test(candidate)) continue;
    request.visitorName = candidate.slice(0, 80);
    break;
  }
  const date = readDate(text, today);
  if (date) request.date = date;
  const time = readTime(text);
  if (time) request.startTime = time;
  const hours = /\b(?:for|selama)?\s*(\d{1,2})\s*(?:hours?|hrs?|jam)\b/i.exec(text);
  if (hours && !/\bpukul\s+\d{1,2}\s*jam\b/i.test(text) && Number(hours[1]) >= 1 && Number(hours[1]) <= 48) request.hours = Number(hours[1]);
  if (/\b(delivery|deliveries|parcel|courier|penghantaran|kurier|bungkusan)\b/i.test(text)) request.type = 'DELIVERY';
  else if (/\b(event|party|majlis|kenduri|open house|rumah terbuka)\b/i.test(text)) request.type = 'EVENT';
  const plate = /\b(?:car|kereta|plate|plat|no\.? plat|vehicle)\s+([a-z]{1,3}\s?\d{1,4}\s?[a-z]?)\b/i.exec(text);
  if (plate) request.vehicleNo = plate[1]!.toUpperCase().replace(/\s+/g, ' ').trim();
  return request;
}
