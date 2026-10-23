import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Photo } from '../src/server/ai/classifier';
import type { Db } from '../src/server/db/client';
import { storeUpload } from '../src/server/http/uploads';

/**
 * Photos for the demo's Lapor reports. Every new report needs a photo, so each demo problem has one, kept in
 * scripts/demo-photos/lapor/ (resized, with their hidden data removed; README.md there lists each one and its source).
 * They are stored in the database like a resident's upload. Residents who reported the same problem in their own
 * words share the first report's photo.
 */

// Seeding runs from the project folder (npm run db:seed).
const DIR = path.resolve(process.cwd(), 'scripts', 'demo-photos', 'lapor');

/** Each demo problem's place (its first report's location), and the photo that shows it. */
export const PLACE_PHOTOS: Record<string, string> = {
  // seed-around.ts
  'Persiaran Elektron, outside Elmina Central Park car park': 'pothole-deep',
  'Jalan Metafasa U16/156 junction': 'road-breaking-up',
  'Pavement along Persiaran Atmosfera, near the bus stop': 'cracked-pavement',
  'Jalan Frekuensi U16/110, before the playground': 'broken-speed-bump',
  'Jalan Metafasa U16/1N, opposite No. 22': 'sunken-manhole',
  'Service road behind Elmina Lakeside shops': 'service-road-potholes',
  'Jalan Frekuensi U16/115, Nos. 30 to 44': 'street-lights-out',
  'Elmina Central Park, main entrance': 'park-lamp-flicker',
  'Underpass to Persiaran Casuarina': 'dark-underpass',
  'Jalan Metafasa U16/171, near the surau': 'street-light-daytime',
  'Elmina Lakeside jogging track, north side': 'jogging-track-lights',
  'Jalan Metafasa U16/161, corner house': 'drain-full-leaves',
  'Monsoon drain behind Jalan Frekuensi U16/112': 'stagnant-monsoon-drain',
  'Walkway to SJK (T) Ladang Rasak': 'missing-drain-cover',
  'Elmina Gardens clubhouse': 'overflowing-drain',
  'Persiaran Metafasa culvert near Sungai Subang': 'blocked-culvert',
  'Back lane behind Persiaran Casuarina terraces': 'smelly-back-lane-drain',
  'Empty lot beside Persiaran Elektron': 'dumped-mattress-sofa',
  'Jalan Metafasa U16/171, bin centre': 'overflowing-bins',
  'Jalan Frekuensi U16/110 corner': 'garden-waste-pile',
  'Grass verge along Persiaran Casuarina': 'construction-debris',
  'Ramp at Elmina Gardens clubhouse': 'car-on-ramp',
  'Elmina Valley community hall': 'lift-out-of-order',
  'Path into Elmina Central Park from Persiaran Elektron': 'narrow-bollards',
  'Crossing at Persiaran Casuarina and Persiaran Elmina': 'broken-kerb-ramp',
  'Jalan Frekuensi U16/115, outside No. 8': 'branch-over-road',
  'Lamp post beside Elmina Central Park playground': 'exposed-wires-lamp-post',
  'Elmina Lakeside, lake path railing': 'loose-railing',
  'Elmina Valley futsal court': 'broken-glass-court',
  'SJK (T) Ladang Rasak, front gate': 'stray-dogs',
  'Elmina Valley 1 guardhouse': 'graffiti-wall',
  'Elmina Lakeside, bench near the pier': 'broken-bench',
  'Walkway along Persiaran Atmosfera': 'missing-tactile-paving',
  'Side gate to Elmina Central Park from Jalan Metafasa U16/1N': 'narrow-park-gate',
  'Jalan Metafasa U16/161, outside No. 3': 'open-trench',
  'Bus stop on Persiaran Casuarina': 'wasp-nest',
  'Recycling corner at Elmina Valley community hall': 'recycling-bins-full',
  'Construction site next to Persiaran Casuarina': 'generator-construction',
  'Jalan Frekuensi U16/112, clubhouse signboard': 'fallen-signboard',
  // seed.ts
  'Jalan Metafasa U16/171, near No. 4': 'street-light-not-on',
  'Back lane behind Jalan Metafasa U16/1N': 'blocked-drain-stagnant',
  'Surau Elmina Gardens entrance': 'motorcycles-on-ramp',
  'Persiaran Metafasa, before SJK (T) Ladang Rasak': 'pothole-on-bend',
  'Kiosk Elmina Valley, Elmina Valley Central Park': 'rubbish-by-kiosk',
  // seed-tomorrow.ts
  'Playground, Jalan Metafasa U16/171': 'broken-swing',
  'Corner of Jalan Metafasa U16/171': 'overgrown-grass-kerb',
  'Junction of Persiaran Metafasa and Jalan Metafasa U16/171': 'street-sign-knocked-over',
  'Outside No. 5, Jalan Metafasa U16/171': 'loose-drain-cover',
  'Outside No. 2, Jalan Metafasa U16/171': 'cars-parked-road',
};

/** The place's photo file, if it is there yet. */
function demoFile(place: string): Photo | null {
  const key = PLACE_PHOTOS[place];
  const file = key ? path.join(DIR, `${key}.jpg`) : null;
  if (!file || !fs.existsSync(file)) return null;
  return { mime: 'image/jpeg', bytes: new Uint8Array(fs.readFileSync(file)) };
}

/** A plain grey picture, for a demo report whose photo file is not there yet; seedReportPhotos swaps it later. */
async function placeholder(): Promise<Photo> {
  const { default: sharp } = await import('sharp');
  const bytes = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 196, g: 190, b: 182 } } }).jpeg({ quality: 70 }).toBuffer();
  return { mime: 'image/jpeg', bytes: new Uint8Array(bytes) };
}

/** The demo photo for a new report at this place (a placeholder until its file is added). */
export async function demoReportPhoto(place: string): Promise<Photo> {
  return demoFile(place) ?? placeholder();
}

/**
 * Gives the demo's reports their photos. The first report of each demo problem gets the place's photo, and the
 * reports grouped with it share that one. A report whose stored photo differs from the file (a placeholder, or an
 * older picture) has it replaced in place. Only reports made by the demo accounts are touched, and a place whose
 * file is not there yet is left as it is. Safe to run again, on a new or an existing database.
 */
export async function seedReportPhotos(db: Db, input: { log: (line: string) => void }) {
  let added = 0;
  let replaced = 0;
  for (const place of Object.keys(PLACE_PHOTOS)) {
    const photo = demoFile(place);
    if (!photo) continue;
    const fingerprint = createHash('md5').update(photo.bytes).digest('hex');
    const reports = await db.query<{ id: string; reporter_id: string; photo_id: string | null; fingerprint: string | null }>(
      `SELECT r.id, r.reporter_id, r.photo_id, md5(u.bytes) AS fingerprint
         FROM reports r JOIN users who ON who.id = r.reporter_id LEFT JOIN uploads u ON u.id = r.photo_id
        WHERE r.location_text = $1 AND who.email LIKE '%@demo.kita.test'`,
      [place],
    );
    for (const report of reports) {
      if (!report.photo_id) {
        const photoId = await storeUpload(db, report.reporter_id, photo);
        await db.query('UPDATE reports SET photo_id = $2 WHERE id = $1', [report.id, photoId]);
        added += 1;
      } else if (report.fingerprint !== fingerprint) {
        await db.query('UPDATE uploads SET mime = $2, size_bytes = $3, bytes = $4 WHERE id = $1', [report.photo_id, photo.mime, photo.bytes.length, Buffer.from(photo.bytes)]);
        replaced += 1;
      }
    }
  }
  const shared = await db.query(
    `UPDATE reports r SET photo_id = first.photo_id
       FROM report_issue_facts f JOIN reports first ON first.id = f.first_report_id, users who
      WHERE r.issue_id = f.id AND r.photo_id IS NULL AND first.photo_id IS NOT NULL AND first.location_text = ANY($1::text[])
        AND who.id = r.reporter_id AND who.email LIKE '%@demo.kita.test'
      RETURNING r.id`,
    [Object.keys(PLACE_PHOTOS)],
  );
  const missing = Object.keys(PLACE_PHOTOS).filter((place) => !demoFile(place)).length;
  input.log(added || replaced || shared.length
    ? `Lapor photos: ${added} added, ${replaced} replaced, ${shared.length} grouped reports now share one.${missing ? ` ${missing} places have no photo file yet.` : ''}`
    : `Lapor photos: already there.${missing ? ` ${missing} places have no photo file yet.` : ''}`);
}
