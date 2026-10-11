import { createHash, randomInt } from 'node:crypto';
import { formatAddress, type BillKind, type HomeAddress } from '@/shared/domain';
import { readBillWithModel, type BillReading } from '../../ai/classifier';
import { one, type Db, type Queryable } from '../../db/client';
import { requireVerifiedResident, type Actor } from '../../auth/actor';
import { getConfig } from '../../config';
import { conflict, notFound, ruleViolation } from '../../errors';
import { checkBillFile, type GateStep } from '../../files/gate';
import { pdfText, simplePdf } from '../../files/pdf';
import { recordAction, sumRewards, type ActionReward } from '../rewards';
import { getSettings } from '../settings';
import { HOME_ADDRESS_COLUMNS } from '../townships';

/**
 * Jimat bill reading (proposal 6.3, BR25): upload a photo or PDF of an
 * electricity or water bill, and confirm what was read.
 *
 * 1. The file passes the safety gate (files/gate.ts).
 * 2. Is it a utility bill at all? Anything else stops here and is not kept.
 * 3. The fields are read: a PDF's own text first; a picture, or a PDF whose
 *    text cannot be read, only by the AI service when one is configured.
 * 4. Sense checks: the amount and the usage must agree, the month must be
 *    recent, and the address on the bill should be the resident's home.
 * 5. The resident confirms or corrects every number; unsure ones are marked.
 * 6. Only the numbers are kept. The file never is: it is checked and read in
 *    memory, and only its fingerprint is stored so it cannot be used twice.
 */

export interface BillField<T> {
  value: T | null;
  unsure: boolean;
}

export interface BillFields {
  kind: BillField<BillKind>;
  /** kWh for electricity; litres for water (read in cubic metres). */
  usage: BillField<number>;
  amountSen: BillField<number>;
  /** 'YYYY-MM': the month the usage is for. */
  month: BillField<string>;
  accountLast4: BillField<string>;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mac: 3, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, ogo: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dis: 12, dec: 12,
};
const num = (text: string) => Number(text.replace(/,/g, ''));
const field = <T>(value: T | null, unsure = value === null): BillField<T> => ({ value, unsure });

/** Reads the fields out of a bill's text. Each one is "unsure" unless found next to its label. */
export function parseBillText(text: string, hint: BillKind | null): BillFields & { accountNo: string | null; isBill: boolean } {
  const t = text.replace(/\s+/g, ' ');
  const isBill = /(kwh|m3|m³|meter padu|bil|bill|akaun|account)/i.test(t) && /RM\s?\d/i.test(t);
  const looksElectric = /kwh/i.test(t);
  const looksWater = /(m3|m³|meter padu)/i.test(t);
  const kind: BillKind | null = looksElectric && !looksWater ? 'ELECTRICITY' : looksWater && !looksElectric ? 'WATER' : hint;

  let usage: BillField<number> = field<number>(null);
  if (kind === 'ELECTRICITY') {
    const labelled = /(?:jumlah penggunaan|total usage|penggunaan|usage|consumption)[^\d]{0,40}([\d,]+(?:\.\d+)?)\s*kwh/i.exec(t);
    const any = [...t.matchAll(/([\d,]+(?:\.\d+)?)\s*kwh/gi)].map((m) => num(m[1]!));
    usage = labelled ? field(Math.round(num(labelled[1]!)), false) : any.length ? field(Math.round(Math.max(...any)), true) : usage;
  } else if (kind === 'WATER') {
    const labelled = /(?:jumlah penggunaan|total usage|penggunaan|usage|consumption)[^\d]{0,40}([\d,]+(?:\.\d+)?)\s*(?:m3|m³|meter padu)/i.exec(t);
    const any = [...t.matchAll(/([\d,]+(?:\.\d+)?)\s*(?:m3|m³|meter padu)/gi)].map((m) => num(m[1]!));
    usage = labelled ? field(Math.round(num(labelled[1]!) * 1000), false) : any.length ? field(Math.round(Math.max(...any) * 1000), true) : usage;
  }

  const due = /(?:jumlah perlu dibayar|amount due|jumlah bil|total amount|jumlah caj semasa|current charges)[^\d]{0,40}RM\s?([\d,]+\.\d{2})/i.exec(t);
  const anyRm = [...t.matchAll(/RM\s?([\d,]+\.\d{2})/gi)].map((m) => Math.round(num(m[1]!) * 100));
  const amountSen = due ? field(Math.round(num(due[1]!) * 100), false) : anyRm.length ? field(Math.max(...anyRm), true) : field<number>(null);

  let month = field<string>(null);
  const period = /(?:tempoh bil|billing period|bill period|tempoh)[^\d]{0,20}\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\s*(?:-|to|hingga|–)\s*\d{1,2}[./-](\d{1,2})[./-](\d{2,4})/i.exec(t);
  const named = /\b(jan|feb|mac|mar|apr|mei|may|jun|jul|ogo|aug|sep|okt|oct|nov|dis|dec)[a-z]*\.?\s+(20\d{2})\b/i.exec(t);
  if (period) {
    const year = period[2]!.length === 2 ? 2000 + Number(period[2]) : Number(period[2]);
    const m = Number(period[1]);
    if (m >= 1 && m <= 12) month = field(`${year}-${String(m).padStart(2, '0')}`, false);
  } else if (named) {
    month = field(`${named[2]}-${String(MONTHS[named[1]!.toLowerCase().slice(0, 3)]).padStart(2, '0')}`, true);
  }

  const account = /(?:no\.?\s*akaun|account\s*no\.?|nombor akaun|account number)[:\s]*([0-9][0-9 -]{5,22}[0-9])/i.exec(t);
  const accountNo = account ? account[1]!.replace(/[^0-9]/g, '') : null;
  return { isBill, kind: field(kind, kind === null || kind !== hint), usage, amountSen, month, accountLast4: field(accountNo ? accountNo.slice(-4) : null), accountNo };
}

/** The fixed rules after reading (proposal 6.3 step 5). The AI never makes these calls. */
export function senseChecks(f: BillFields, homeMatch: boolean | null, now: Date): GateStep[] {
  const checks: GateStep[] = [];
  const usage = f.usage.value;
  const amount = f.amountSen.value;
  if (usage !== null && amount !== null && usage > 0) {
    const perUnit = f.kind.value === 'WATER' ? amount / (usage / 1000) : amount / usage;
    const [low, high] = f.kind.value === 'WATER' ? [20, 1_000] : [10, 150]; // sen per m³, sen per kWh
    const ok = perUnit >= low && perUnit <= high;
    checks.push({ step: 'Amount and usage agree', ok, detail: ok ? 'The amount fits the usage at normal tariffs.' : 'The amount does not fit the usage. Please check both numbers.' });
  }
  if (f.month.value) {
    const [y, m] = f.month.value.split('-').map(Number) as [number, number];
    const monthsAgo = (now.getUTCFullYear() - y) * 12 + (now.getUTCMonth() + 1 - m);
    const ok = monthsAgo >= 0 && monthsAgo <= 3;
    checks.push({ step: 'Recent bill', ok, detail: ok ? 'The bill is from the last three months.' : 'Only bills from the last three months can be used.' });
  }
  if (homeMatch !== null) {
    checks.push({ step: 'Your address', ok: homeMatch, detail: homeMatch ? 'The bill’s address matches your registered home.' : 'We could not find your registered address on the bill.' });
  }
  return checks;
}

const accountHash = (townshipId: string, accountNo: string) => createHash('sha256').update(`jimat-account:${townshipId}:${accountNo}`).digest('hex');

async function homeOf(q: Queryable, homeId: string) {
  return (await one<HomeAddress>(q, `SELECT ${HOME_ADDRESS_COLUMNS} FROM homes h WHERE h.id = $1`, [homeId]))!;
}

/** Upload and read one bill. Returns what was read, the gate's steps and the sense checks; nothing is final yet. */
export async function readBill(db: Db, actor: Actor, input: { bytes: Uint8Array; kind: BillKind | null }, now: Date) {
  const resident = requireVerifiedResident(actor);
  const file = checkBillFile(input.bytes);
  const home = await homeOf(db, resident.homeId);

  let source: 'TEXT' | 'MODEL' | 'NONE' = 'NONE';
  let parsed: ReturnType<typeof parseBillText> | null = null;
  let text = '';
  if (file.mime === 'application/pdf') {
    text = pdfText(file.bytes);
    if (text.length > 20) {
      parsed = parseBillText(text, input.kind);
      source = 'TEXT';
    }
  }
  if (!parsed || (parsed.usage.value === null && parsed.amountSen.value === null)) {
    const reading: BillReading | null = getConfig().AI_PROVIDER === 'none' ? null : await readBillWithModel({ mime: file.mime, bytes: file.bytes } as Parameters<typeof readBillWithModel>[0]);
    if (reading) {
      source = 'MODEL';
      const usage = reading.usage === null ? null : reading.kind === 'WATER' ? Math.round(reading.usage * 1000) : Math.round(reading.usage);
      parsed = {
        isBill: reading.isBill,
        kind: field(reading.kind ?? input.kind, reading.kind === null),
        usage: field(usage),
        amountSen: field(reading.amountSen),
        month: field(reading.period),
        accountLast4: field(reading.accountNo ? reading.accountNo.replace(/\D/g, '').slice(-4) : null),
        accountNo: reading.accountNo ? reading.accountNo.replace(/\D/g, '') : null,
      };
    }
  }
  if (parsed && !parsed.isBill) throw ruleViolation('NOT_A_BILL', 'This does not look like an electricity or water bill, so it was not kept.', { steps: file.steps });

  // Without readable text or the AI service, every field is typed in by the resident. Only these five
  // fields are kept or sent back: never the full account number, which is stored as a one-way hash only.
  const fields: BillFields = parsed
    ? { kind: parsed.kind, usage: parsed.usage, amountSen: parsed.amountSen, month: parsed.month, accountLast4: parsed.accountLast4 }
    : {
        kind: field(input.kind, input.kind === null),
        usage: field<number>(null),
        amountSen: field<number>(null),
        month: field<string>(null),
        accountLast4: field<string>(null),
      };
  const homeMatch = text ? text.toLowerCase().includes(home.street.toLowerCase()) || Boolean(home.postcode && text.includes(home.postcode)) : null;
  const checks = senseChecks(fields, homeMatch, now);

  const row = await one<{ id: string }>(
    db,
    `INSERT INTO jimat_bills (home_id, user_id, kind, file_mime, file_sha256, file_size, pages, read_source, fields, checks, account_hash, address_match, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13) RETURNING id`,
    [
      resident.homeId, resident.id, fields.kind.value ?? input.kind ?? 'ELECTRICITY', file.mime, file.sha256, file.bytes.length, file.pages, source,
      JSON.stringify(fields), JSON.stringify(checks), parsed?.accountNo ? accountHash(resident.townshipId, parsed.accountNo) : null, homeMatch, now,
    ],
  );
  return { billId: row!.id, source, fields, gate: file.steps, checks, aiAvailable: getConfig().AI_PROVIDER !== 'none' };
}

/**
 * The resident confirms the numbers. The reading is saved for the month, Impact
 * XP is given, and a saving against the month before is recognised. Offer-backed
 * points need both months read from bills, not typed.
 */
export async function confirmBill(db: Db, actor: Actor, billId: string, input: { kind: BillKind; usage: number; amountSen: number; month: string }, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const bill = await one<{ status: string; file_sha256: string; account_hash: string | null; address_match: boolean | null }>(
      tx,
      `SELECT status, file_sha256, account_hash, address_match FROM jimat_bills WHERE id = $1 AND home_id = $2 FOR UPDATE`,
      [billId, resident.homeId],
    );
    if (!bill) throw notFound('Bill');
    if (bill.status !== 'READ') throw conflict('BILL_DONE', 'This bill has already been confirmed or discarded.');
    const tz = (await getSettings(tx)).timezone;
    const window = await one<{ ok: boolean }>(
      tx,
      `SELECT $1::date BETWEEN (date_trunc('month', $2::timestamptz AT TIME ZONE $3) - interval '3 months')::date
                           AND date_trunc('month', $2::timestamptz AT TIME ZONE $3)::date AS ok`,
      [`${input.month}-01`, now, tz],
    );
    if (!window!.ok) throw ruleViolation('MONTH_NOT_OPEN', 'Only bills from the last three months can be used.');
    if (await one(tx, `SELECT 1 FROM jimat_bills WHERE file_sha256 = $1 AND status = 'CONFIRMED'`, [bill.file_sha256])) {
      throw conflict('BILL_USED', 'This bill has already been used.');
    }
    if (bill.account_hash && (await one(tx, `SELECT 1 FROM jimat_bills WHERE kind = $1 AND account_hash = $2 AND period_month = $3::date AND status = 'CONFIRMED'`, [input.kind, bill.account_hash, `${input.month}-01`]))) {
      throw conflict('BILL_USED', 'A bill for this account and month has already been used.');
    }
    await tx.query(
      `UPDATE jimat_bills SET status = 'CONFIRMED', kind = $2, usage = $3, amount_sen = $4, period_month = $5::date, confirmed_at = $6 WHERE id = $1`,
      [billId, input.kind, input.usage, input.amountSen, `${input.month}-01`, now],
    );
    const [usageCol, senCol, sourceCol] = input.kind === 'ELECTRICITY' ? ['electricity_kwh', 'electricity_sen', 'electricity_source'] : ['water_litres', 'water_sen', 'water_source'];
    await tx.query(
      `INSERT INTO jimat_readings (home_id, month, ${usageCol}, ${senCol}, ${sourceCol}, entered_by, created_at)
       VALUES ($1, $2::date, $3, $4, 'BILL', $5, $6)
       ON CONFLICT (home_id, month) DO UPDATE SET ${usageCol} = EXCLUDED.${usageCol}, ${senCol} = EXCLUDED.${senCol}, ${sourceCol} = 'BILL'`,
      [resident.homeId, `${input.month}-01`, input.usage, input.amountSen, resident.id, now],
    );

    const rewards: ActionReward[] = [await recordAction(tx, { user: resident, activity: 'JIMAT_READING', ref: input.month, now })];
    const previous = await one<{ usage: number | null; source: string | null; amount: number | null }>(
      tx,
      `SELECT ${usageCol} AS usage, ${sourceCol} AS source, ${senCol} AS amount FROM jimat_readings WHERE home_id = $1 AND month = ($2::date - interval '1 month')::date`,
      [resident.homeId, `${input.month}-01`],
    );
    const saved = previous?.usage != null && previous.usage > 0 && input.usage <= previous.usage * 0.95;
    if (saved) {
      // Both months read from a bill, at the resident's own address: strong enough for offer-backed points.
      const verified = previous.source === 'BILL' && bill.address_match !== false;
      rewards.push(await recordAction(tx, { user: resident, activity: 'JIMAT_SAVER', ref: input.month, now, offerEligible: verified }));
    }
    return {
      saved,
      savedSen: saved && previous?.amount != null ? Math.max(0, previous.amount - input.amountSen) : 0,
      reward: sumRewards(rewards),
      fileKept: false,
    };
  });
}

export async function discardBill(db: Db, actor: Actor, billId: string) {
  const resident = requireVerifiedResident(actor);
  const rows = await db.query(`DELETE FROM jimat_bills WHERE id = $1 AND home_id = $2 AND status = 'READ' RETURNING id`, [billId, resident.homeId]);
  if (rows.length === 0) throw notFound('Bill');
  return { ok: true };
}

export async function myBills(db: Db, actor: Actor) {
  const resident = requireVerifiedResident(actor);
  return db.query(
    `SELECT id, kind, status, read_source, usage, amount_sen, period_month::text AS period_month, address_match, created_at, confirmed_at
       FROM jimat_bills WHERE home_id = $1 AND status = 'CONFIRMED' ORDER BY period_month DESC, kind LIMIT 24`,
    [resident.homeId],
  );
}

/**
 * A sample bill for the demo, made out to the resident's own address, so bill
 * reading can be tried end to end. It is marked SAMPLE on its face and comes
 * from no real utility. Each download has a new account number.
 */
export async function sampleBill(db: Db, actor: Actor, kind: BillKind, now: Date): Promise<Response> {
  const resident = requireVerifiedResident(actor);
  const home = await homeOf(db, resident.homeId);
  const tz = (await getSettings(db)).timezone;
  const last = await one<{ month: string; kwh: number | null; litres: number | null }>(
    db,
    `SELECT to_char((date_trunc('month', $1::timestamptz AT TIME ZONE $2) - interval '1 month'), 'YYYY-MM') AS month,
            (SELECT electricity_kwh FROM jimat_readings WHERE home_id = $3 AND electricity_kwh IS NOT NULL ORDER BY month DESC LIMIT 1) AS kwh,
            (SELECT water_litres FROM jimat_readings WHERE home_id = $3 AND water_litres IS NOT NULL ORDER BY month DESC LIMIT 1) AS litres`,
    [now, tz, resident.homeId],
  );
  const [year, month] = last!.month.split('-').map(Number) as [number, number];
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  const periodText = `01/${pad(month)}/${year} - ${days}/${pad(month)}/${year}`;
  const account = `${randomInt(10, 99)}${randomInt(1_000_000, 9_999_999)}${randomInt(100, 999)}`;
  // A little below last month, so the demo can show a saving.
  const usage = kind === 'ELECTRICITY' ? Math.max(120, Math.round((last!.kwh ?? 380) * 0.9)) : Math.max(8, Math.round(((last!.litres ?? 20_000) / 1000) * 0.9 * 10) / 10);
  const amountSen = kind === 'ELECTRICITY' ? Math.round(usage * 43.6) : Math.round(usage * 120) + 600;
  const unit = kind === 'ELECTRICITY' ? 'kWh' : 'm3';
  const rm = (sen: number) => `RM ${(sen / 100).toFixed(2)}`;
  const lines = [
    { text: 'SAMPLE BILL - NOT A REAL BILL', x: 50, y: 800, size: 9, bold: true },
    { text: kind === 'ELECTRICITY' ? 'KITA Demo Electricity' : 'KITA Demo Water', x: 50, y: 770, size: 20, bold: true },
    { text: `Bil ${kind === 'ELECTRICITY' ? 'Elektrik' : 'Air'} / ${kind === 'ELECTRICITY' ? 'Electricity' : 'Water'} Bill`, x: 50, y: 748, size: 12 },
    { text: 'Made by KITA+ for the hackathon demo. No real utility issued it.', x: 50, y: 732, size: 9 },
    { text: 'Nama / Name: Resident of the home below', x: 50, y: 690 },
    { text: `Alamat / Address: ${formatAddress(home)}`, x: 50, y: 674 },
    { text: `No. Akaun / Account No: ${account}`, x: 50, y: 650, bold: true },
    { text: `Tempoh Bil / Billing Period: ${periodText}`, x: 50, y: 634 },
    { text: `Jumlah Penggunaan / Total Usage: ${usage} ${unit}`, x: 50, y: 600, size: 13, bold: true },
    { text: `Caj Semasa / Current Charges: ${rm(amountSen)}`, x: 50, y: 580 },
    { text: `Jumlah Perlu Dibayar / Amount Due: ${rm(amountSen)}`, x: 50, y: 556, size: 14, bold: true },
    { text: 'Thank you for saving energy and water with Jimat.', x: 50, y: 500, size: 10 },
  ];
  return new Response(new Uint8Array(simplePdf(lines)), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="kita-sample-${kind.toLowerCase()}-bill-${last!.month}.pdf"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
