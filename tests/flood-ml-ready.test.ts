import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { one, type Db } from '@/server/db/client';
import { agentOverview, readCameraPhoto, simulateSignal } from '@/server/modules/banjir/agent';
import { photoReader, readTestPicture } from '@/server/modules/banjir/camera-reader';
import { fitLine, trendEstimate } from '@/server/modules/banjir/trend';
import { T0, freshDb, makeWorld, type World } from './helpers';

/**
 * The flood system's slots for real devices and models: the trend estimate (advisory, never an alert),
 * the camera reader (test set now; hosted AI or a trained CNN later) and the integration status the
 * console shows. The rules that decide alerts are tested in flood-sensors and third-edition.
 */

let db: Db;
let w: World;
let n = 0;
const min = (m: number) => new Date(T0.getTime() + m * 60_000);
const SETTINGS = { flood_warning_pct: 75, flood_danger_pct: 90 };

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
});
afterAll(() => db.close());

async function makeZone() {
  return (await one<{ id: string }>(db, `INSERT INTO flood_zones (township_id, name, safe_route, assembly_point) VALUES ($1, $2, 'Go uphill', 'School') RETURNING id`, [w.townshipId, `Trend Zone ${++n}`]))!.id;
}
async function reading(zoneId: string, pct: number, at: Date) {
  await db.query(`INSERT INTO flood_readings (zone_id, level_pct, source, created_at) VALUES ($1, $2, 'SENSOR', $3)`, [zoneId, pct, at]);
}

describe('Early-warning trend estimate', () => {
  it('fits a straight line through the readings', () => {
    const { slopePerMs, fittedNow } = fitLine([{ t: 0, pct: 10 }, { t: 60_000, pct: 12 }, { t: 120_000, pct: 14 }]);
    expect(slopePerMs * 60_000).toBeCloseTo(2);
    expect(fittedNow).toBeCloseTo(14);
  });

  it('says how long until the warning line while the water climbs', async () => {
    const zone = await makeZone();
    // 1 percentage point a minute, from 40% to 60% over 20 minutes: 15 more minutes to 75%.
    for (let i = 0; i <= 20; i += 4) await reading(zone, 40 + i, min(i));
    const trend = await trendEstimate(db, zone, min(20), SETTINGS);
    expect(trend).toMatchObject({ direction: 'RISING', nextLine: 'WARNING', method: 'LINEAR_TREND' });
    expect(trend!.ratePctPerHour).toBeCloseTo(60, 0);
    expect(trend!.minutes).toBe(15);
  });

  it('gives no time while the water is steady or falling, and nothing from too few readings', async () => {
    const steady = await makeZone();
    for (let i = 0; i <= 20; i += 5) await reading(steady, 30, min(i));
    expect(await trendEstimate(db, steady, min(20), SETTINGS)).toMatchObject({ direction: 'STEADY', minutes: null, nextLine: null });

    const falling = await makeZone();
    for (let i = 0; i <= 20; i += 5) await reading(falling, 70 - i, min(i));
    expect(await trendEstimate(db, falling, min(20), SETTINGS)).toMatchObject({ direction: 'FALLING', minutes: null });

    const sparse = await makeZone();
    await reading(sparse, 50, min(0));
    await reading(sparse, 60, min(10));
    expect(await trendEstimate(db, sparse, min(10), SETTINGS)).toBeNull();
  });
});

describe('Camera reader slot', () => {
  it('reads a labelled test picture with its recorded reading, and records it as the camera signal', async () => {
    expect(readTestPicture('day-78')).toMatchObject({ levelPct: 80, confidence: 0.88, reader: 'TEST_SET', truePct: 78 });
    const zone = await makeZone();
    await simulateSignal(db, w.staff, zone, { source: 'CAMERA', pictureId: 'day-78' }, T0);
    const signal = await one<{ level_pct: number; detail: { reader: string } }>(db, `SELECT level_pct, detail FROM flood_signals WHERE zone_id = $1 AND source = 'CAMERA'`, [zone]);
    expect(signal).toMatchObject({ level_pct: 80, detail: { reader: 'TEST_SET' } });
  });

  it('records nothing for an uploaded photo when no reader is set up, so it can neither raise nor clear an alert', async () => {
    expect(photoReader()).toBeNull(); // tests run with AI_PROVIDER=none and no FLOOD_MODEL_URL
    const zone = await makeZone();
    const photo = { mime: 'image/png' as const, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) };
    await expect(readCameraPhoto(db, w.staff, zone, photo, T0)).rejects.toMatchObject({ code: 'NO_CAMERA_READER' });
    expect(await one(db, `SELECT 1 FROM flood_signals WHERE zone_id = $1`, [zone])).toBeUndefined();
  });
});

describe('Integration status on the console', () => {
  it('reports what is simulated and what is ready to connect, from the real configuration', async () => {
    const overview = await agentOverview(db, w.staff, T0);
    expect(overview.integration).toMatchObject({
      camera: { photoReader: null, modelServer: false, hostedAi: false },
      forecast: { method: 'LINEAR_TREND' },
    });
    expect(overview.integration.sensors).toMatchObject({ simulated: 0, real: 0 });
    expect(['DEV_CLOCK', 'SCHEDULED_JOB']).toContain(overview.integration.scheduler);
  });
});
