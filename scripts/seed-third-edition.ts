import type { Material } from "../src/shared/domain";
import { KNOWLEDGE } from "../src/server/modules/assistant/knowledge";
import { saveMessages } from "../src/server/modules/assistant/service";
import { LEGAL } from "../src/shared/legal";
import type { Actor } from "../src/server/auth/actor";
import { ACTOR_COLUMNS, toActor } from "../src/server/auth/session";
import { one, type Db } from "../src/server/db/client";
import {
  createPlace,
  inviteCarer,
  reportPlaceBlocked,
  respondToCarerInvite,
  saveAccessProfile,
  suggestPlace,
} from "../src/server/modules/akses/service";
import { simulateSignal } from "../src/server/modules/banjir/agent";
import { setSponsorTier } from "../src/server/modules/campaigns/tiers";
import {
  addPoints,
  finishActivity,
  startActivity,
} from "../src/server/modules/gerak/tracking";
import { randomCode } from "../src/server/modules/identity/service";
import {
  createMachine,
  simulateFinish,
  simulateItem,
  simulateStart,
} from "../src/server/modules/kitar/machine";
import { createOffer } from "../src/server/modules/offers/service";
import {
  addSighting,
  applyForPlot,
  createGarden,
  decideSighting,
  markWatered,
  runBallot,
  takeRosterDay,
} from "../src/server/modules/taman/service";
import {
  createPass,
  logWalkIn,
  scanPass,
} from "../src/server/modules/tamu/service";
import { ELMINA_LOOPS } from "./elmina-loops";

/**
 * Demo data for the third edition's features. Safe to run on a database that
 * already holds the demo township: each part is added only if it is missing,
 * and nothing already there is changed. People and businesses remain invented;
 * the Gerak paths follow public paths mapped at the real City of Elmina.
 */

const DOMAIN = "demo.kita.test";
const DAY = 86_400_000;

// Public walking geometry at City of Elmina, simplified from OpenStreetMap way
// 909856763 on 14 October 2026. It is tagged as a concrete sidewalk with motor
// vehicles prohibited. Demo people and homes are not real resident records.
const GATE = {
  name: "Elmina Central Park entrance",
  lat: 3.175561,
  lng: 101.50999,
};
const CENTRAL_PARK_WALK: [number, number][] = [
  [3.175561, 101.50999],
  [3.175366, 101.509835],
  [3.175165, 101.509519],
  [3.175021, 101.509355],
  [3.175033, 101.508722],
  [3.175304, 101.508301],
  [3.173212, 101.507805],
  [3.171921, 101.507526],
  [3.17111, 101.507122],
  [3.169887, 101.507283],
  [3.169409, 101.506995],
  [3.16969, 101.505543],
  [3.171723, 101.506009],
  [3.173472, 101.506388],
  [3.174056, 101.50621],
  [3.174587, 101.506111],
  [3.175044, 101.506414],
  [3.175383, 101.506809],
  [3.1762, 101.507788],
  [3.176725, 101.508839],
  [3.176876, 101.50914],
  [3.176925, 101.509489],
  [3.176636, 101.509763],
  [3.176291, 101.509918],
  [3.175938, 101.510051],
  [3.174793, 101.510063],
];

async function actorByEmail(db: Db, login: string): Promise<Actor | undefined> {
  const row = await one<Parameters<typeof toActor>[0]>(
    db,
    `SELECT ${ACTOR_COLUMNS} FROM users u WHERE lower(u.email) = lower($1)`,
    [`${login}@${DOMAIN}`],
  );
  return row ? toActor(row) : undefined;
}

/** Positions along a path at a steady speed, one every `stepM` metres. */
function walkAlong(
  path: [number, number][],
  startMs: number,
  speedMs: number,
  stepM = 15,
) {
  const points: { lat: number; lng: number; acc: number; t: number }[] = [];
  let t = startMs;
  for (let i = 1; i < path.length; i++) {
    const [aLat, aLng] = path[i - 1]!;
    const [bLat, bLng] = path[i]!;
    const metres = Math.hypot(
      (bLat - aLat) * 111_320,
      (bLng - aLng) * 111_320 * Math.cos((aLat * Math.PI) / 180),
    );
    const steps = Math.max(1, Math.round(metres / stepM));
    for (let s = 1; s <= steps; s++) {
      t += (metres / steps / speedMs) * 1000;
      points.push({
        lat: aLat + ((bLat - aLat) * s) / steps,
        lng: aLng + ((bLng - aLng) * s) / steps,
        acc: 6,
        t: Math.round(t),
      });
    }
  }
  return points;
}

export async function seedThirdEdition(
  db: Db,
  input: { passwordHash: string; now: Date; log: (line: string) => void },
) {
  const { now, log } = input;
  const daysAgo = (days: number, hour = 4) =>
    new Date(
      Math.floor(now.getTime() / DAY) * DAY - days * DAY + hour * 3_600_000,
    );
  const township = await one<{ id: string }>(
    db,
    `SELECT id FROM townships WHERE name IN ('City of Elmina (demo data)', 'Taman KITA (demo township)', 'Taman SimeTown (demo township)') LIMIT 1`,
  );
  if (!township) {
    log(
      "No demo township found; the third-edition demo data needs the main seed first.",
    );
    return;
  }
  const [
    aisyah,
    daniel,
    priya,
    hafiz,
    meiling,
    zainab,
    staff,
    admin,
    hq,
    kafe,
    kedai,
  ] = await Promise.all(
    [
      "aisyah",
      "daniel",
      "priya",
      "hafiz",
      "meiling",
      "zainab",
      "staff",
      "admin",
      "hq",
      "kafe",
      "kedai",
    ].map((login) => actorByEmail(db, login)),
  );
  if (
    !aisyah ||
    !daniel ||
    !priya ||
    !hafiz ||
    !meiling ||
    !zainab ||
    !staff ||
    !admin ||
    !hq ||
    !kafe ||
    !kedai
  ) {
    log(
      "Some demo accounts are missing; the third-edition demo data was not added.",
    );
    return;
  }

  // --- The map: gate, loop paths and checkpoint positions ---------------------------------
  await db.query(
    "UPDATE townships SET gate_name = $2, gate_lat = $3, gate_lng = $4 WHERE id = $1 AND gate_lat IS NULL",
    [township.id, GATE.name, GATE.lat, GATE.lng],
  );
  const walk = await one<{ id: string; path: unknown[] }>(
    db,
    `SELECT id, path FROM gerak_loops WHERE township_id = $1 AND name = 'Elmina Central Park Walk'`,
    [township.id],
  );
  if (walk && walk.path.length === 0) {
    await db.query("UPDATE gerak_loops SET path = $2::jsonb WHERE id = $1", [
      walk.id,
      JSON.stringify(CENTRAL_PARK_WALK),
    ]);
    await db.query(
      `UPDATE gerak_checkpoints SET lat = $2, lng = $3 WHERE loop_id = $1 AND seq = 1`,
      [walk.id, CENTRAL_PARK_WALK[0]![0], CENTRAL_PARK_WALK[0]![1]],
    );
    await db.query(
      `UPDATE gerak_checkpoints SET lat = $2, lng = $3 WHERE loop_id = $1 AND seq = 2`,
      [walk.id, CENTRAL_PARK_WALK[12]![0], CENTRAL_PARK_WALK[12]![1]],
    );
    log("Map: Elmina Central Park walk drawn, checkpoints placed.");
  }
  for (const loop of ELMINA_LOOPS) {
    if (
      await one(
        db,
        "SELECT 1 FROM gerak_loops WHERE township_id = $1 AND lower(name) = lower($2)",
        [township.id, loop.name],
      )
    )
      continue;
    const added = await one<{ id: string }>(
      db,
      "INSERT INTO gerak_loops (township_id, name, description, mode, distance_m, path) VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id",
      [
        township.id,
        loop.name,
        loop.description,
        loop.mode,
        loop.distanceM,
        JSON.stringify(loop.path),
      ],
    );
    for (const [i, cp] of loop.checkpoints.entries()) {
      await db.query(
        "INSERT INTO gerak_checkpoints (loop_id, seq, name, code, lat, lng) VALUES ($1, $2, $3, $4, $5, $6)",
        [added!.id, i + 1, cp.name, `G${randomCode(9)}`, cp.lat, cp.lng],
      );
    }
    log(`Map: ${loop.name} drawn, checkpoints placed.`);
  }

  // --- A guard, and the patrol round ------------------------------------------------------
  if (!(await actorByEmail(db, "guard"))) {
    await db.query(
      `INSERT INTO users (email, password_hash, full_name, role, township_id, phone, terms_version, terms_accepted_at)
       VALUES ($1, $2, 'Azman Shah (Guard)', 'GUARD', $3, '+60123009001', $4, $5)`,
      [`guard@${DOMAIN}`, input.passwordHash, township.id, LEGAL.version, now],
    );
    log(`Account: guard@${DOMAIN} (main gate guard).`);
  }
  if (
    !(await one(db, "SELECT 1 FROM patrol_points WHERE township_id = $1", [
      township.id,
    ]))
  ) {
    for (const [i, name] of [
      "Main gate",
      "Elmina Valley Central Park",
      "Community hall",
      "Elmina Gardens back lane",
    ].entries()) {
      await db.query(
        "INSERT INTO patrol_points (township_id, seq, name, code) VALUES ($1, $2, $3, $4)",
        [township.id, i + 1, name, `R${randomCode(9)}`],
      );
    }
  }

  // --- Sponsor tiers -------------------------------------------------------------------------
  const solar = await one<{ id: string; tier: string }>(
    db,
    `SELECT id, tier FROM sponsors WHERE name = 'Solar Cerah (demo sponsor)'`,
  );
  if (solar && solar.tier === "NONE") {
    await db.query(
      `UPDATE sponsors SET tagline = 'Cleaner power for every City of Elmina roof' WHERE id = $1`,
      [solar.id],
    );
    await setSponsorTier(
      db,
      hq,
      solar.id,
      {
        tier: "GREEN_CHAMPION",
        bankRef: "DEMO-TIER-SOLAR",
        category: "Solar energy",
      },
      daysAgo(14),
    );
    for (const [name, tier, category, tagline] of [
      [
        "Basikal Bersama (demo sponsor)",
        "TOWNSHIP_PARTNER",
        "Mobility",
        "Bike repairs and rentals for every street",
      ],
      [
        "Kopi Hijau (demo sponsor)",
        "COMMUNITY_FRIEND",
        "Food and drink",
        "Coffee in your own cup, always 50 sen off",
      ],
    ] as const) {
      const sponsor = await one<{ id: string }>(
        db,
        `INSERT INTO sponsors (name, tagline) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET tagline = EXCLUDED.tagline RETURNING id`,
        [name, tagline],
      );
      await setSponsorTier(
        db,
        hq,
        sponsor!.id,
        { tier, bankRef: `DEMO-TIER-${randomCode(6)}`, category },
        daysAgo(10),
      );
    }
    log(
      "Sponsors: Green Champion, Township Partner and Community Friend tiers.",
    );
  }

  // --- Shop Offers: what the shops promise this month -----------------------------------
  if (
    !(await one(
      db,
      `SELECT 1 FROM shop_offers o JOIN merchants m ON m.id = o.merchant_id WHERE m.township_id = $1`,
      [township.id],
    ))
  ) {
    await db.query("UPDATE merchants SET akses_friendly = true WHERE id = $1", [
      kedai.merchantId,
    ]);
    // The proposal's example 4: 300 points for RM3 off, minimum RM20, on weekday afternoons.
    await createOffer(
      db,
      kafe,
      {
        title: "RM3 off afternoon tea",
        discountSen: 300,
        minSpendSen: 2_000,
        daysMask: 0b0011111,
        startMinute: 14 * 60,
        endMinute: 18 * 60,
        monthlyBudgetSen: 40_000,
      },
      daysAgo(10),
    );
    await createOffer(
      db,
      kedai,
      {
        title: "RM2 off your groceries",
        discountSen: 200,
        minSpendSen: 1_500,
        daysMask: 127,
        startMinute: 0,
        endMinute: 1440,
        monthlyBudgetSen: 30_000,
      },
      daysAgo(10),
    );
    log(
      "Shop Offers: Kafe Seri Pagi (weekday afternoons) and Kedai Runcit Mesra (all day).",
    );
  }

  // --- The smart recycling machine, and a few signed sessions --------------------------
  let machine = await one<{ id: string }>(
    db,
    "SELECT id FROM kitar_machines WHERE township_id = $1 ORDER BY name LIMIT 1",
    [township.id],
  );
  if (!machine) {
    const valleyKiosk = await one<{ id: string }>(
      db,
      `SELECT id FROM kitar_kiosks WHERE township_id = $1 AND name = 'Kiosk Elmina Valley'`,
      [township.id],
    );
    const gardensKiosk = await one<{ id: string }>(
      db,
      `SELECT id FROM kitar_kiosks WHERE township_id = $1 AND name = 'Kiosk Elmina Gardens'`,
      [township.id],
    );
    machine = await createMachine(db, admin, {
      name: "Smart machine · Elmina Valley",
      kioskId: valleyKiosk!.id,
    });
    if (gardensKiosk)
      await createMachine(db, admin, {
        name: "Smart machine · Elmina Gardens",
        kioskId: gardensKiosk.id,
      });
    const session = async (who: Actor | null, at: Date, items: Material[]) => {
      await simulateStart(
        db,
        staff,
        machine!.id,
        who
          ? { mode: "MEMBER_QR", memberCode: who.memberCode! }
          : { mode: "GUEST" },
        at,
      );
      for (const [i, material] of items.entries())
        await simulateItem(
          db,
          staff,
          machine!.id,
          { material, outcome: i === 2 ? "WRONG_MATERIAL" : "ACCEPT" },
          at,
        );
      return simulateFinish(db, staff, machine!.id, at);
    };
    const glass: Material[] = Array.from({ length: 16 }, () => "GLASS");
    await session(aisyah, daysAgo(1, 2), [
      ...glass,
      "ALUMINIUM",
      "ALUMINIUM",
      "PLASTIC_PET",
    ]);
    await session(priya, daysAgo(3, 3), [
      "PLASTIC_PET",
      "PLASTIC_PET",
      "GLASS",
      "GLASS",
      "GLASS",
      "PAPER",
    ]);
    await session(hafiz, daysAgo(2, 9), [
      "ALUMINIUM",
      "ALUMINIUM",
      "ALUMINIUM",
      "GLASS",
      "GLASS",
      "E_WASTE",
    ]);
    const guest = await session(null, daysAgo(1, 8), [
      "GLASS",
      "GLASS",
      "PLASTIC_PET",
    ]);
    log(
      `Kitar: smart machines and signed sessions (a guest claim code for the demo: ${guest.claimCode}).`,
    );
  }

  // --- Gerak: Aisyah's tracked Elmina Central Park walk, played back --------------------
  if (
    walk &&
    !(await one(db, `SELECT 1 FROM gerak_activities WHERE user_id = $1`, [
      aisyah.id,
    ]))
  ) {
    const startedAt = daysAgo(1, 0);
    const activity = await startActivity(
      db,
      aisyah,
      { mode: "WALK", simulated: true },
      startedAt,
    );
    const points = walkAlong(CENTRAL_PARK_WALK, startedAt.getTime(), 1.4);
    for (let i = 0; i < points.length; i += 200)
      await addPoints(
        db,
        aisyah,
        activity.id,
        points.slice(i, i + 200),
        startedAt,
      );
    await finishActivity(
      db,
      aisyah,
      activity.id,
      new Date(points[points.length - 1]!.t + 30_000),
    );
    log("Gerak: a tracked walk at Elmina Central Park for Aisyah.");
  }

  // --- Tamu: passes, a visit, and a walk-in waiting for an answer -----------------------
  const guard = await actorByEmail(db, "guard");
  if (
    guard &&
    !(await one(db, "SELECT 1 FROM visitor_passes WHERE township_id = $1", [
      township.id,
    ]))
  ) {
    await createPass(
      db,
      aisyah,
      {
        type: "ONE_VISIT",
        visitorName: "Puan Rahmah (Mak)",
        vehicleNo: "BKL 2408",
        validFrom: now,
        validUntil: new Date(now.getTime() + 20 * 3_600_000),
      },
      now,
    );
    const helper = await createPass(
      db,
      aisyah,
      {
        type: "REGULAR_HELPER",
        visitorName: "Kak Siti (cleaner)",
        validFrom: now,
        validUntil: new Date(now.getTime() + 60 * DAY),
      },
      now,
    );
    await scanPass(db, guard, helper.code, new Date(now.getTime() + 60_000));
    await createPass(
      db,
      priya,
      {
        type: "CONTRACTOR",
        visitorName: "Aircon service (Sejuk Bina)",
        vehicleNo: "WA 5521 K",
        validFrom: now,
        validUntil: new Date(now.getTime() + 3 * DAY),
      },
      now,
    );
    await logWalkIn(
      db,
      guard,
      {
        visitorName: "Food delivery rider",
        vehicleNo: "VBN 772",
        homeId: daniel.homeId!,
      },
      new Date(now.getTime() + 120_000),
    );
    log(
      "Tamu: visitor passes, a scanned helper and a walk-in for Daniel to answer.",
    );
  }

  // --- Banjir: the agent's signals for a calm day -------------------------------------
  const zoneA = await one<{ id: string }>(
    db,
    `SELECT id FROM flood_zones WHERE township_id = $1 AND name = 'Elmina Valley 1 & 2'`,
    [township.id],
  );
  if (
    zoneA &&
    !(await one(db, "SELECT 1 FROM flood_signals WHERE zone_id = $1", [
      zoneA.id,
    ]))
  ) {
    await simulateSignal(
      db,
      staff,
      zoneA.id,
      { source: "SENSOR", levelPct: 42 },
      now,
    );
    await simulateSignal(
      db,
      staff,
      zoneA.id,
      { source: "CAMERA", pictureId: "day-45" },
      now,
    );
    await simulateSignal(
      db,
      staff,
      zoneA.id,
      { source: "RAIN", rainMmHr: 6 },
      now,
    );
    log("Banjir: sensor, camera and rain-gauge signals for Elmina Valley 1 & 2.");
  }

  // --- Akses+: places, a carer and the priority help list --------------------------------
  if (
    !(await one(db, "SELECT 1 FROM access_places WHERE township_id = $1", [
      township.id,
    ]))
  ) {
    for (const place of [
      {
        name: "Valley Central Park lake path",
        kind: "STEP_FREE_ROUTE" as const,
        location: "Around the lake, Elmina Valley Central Park",
        note: "Smooth and level; benches every 200 m.",
      },
      {
        name: "Community hall main entrance",
        kind: "RAMP" as const,
        location: "Community hall, front entrance",
      },
      {
        name: "Pangsapuri Harmoni Elmina Block A lift",
        kind: "LIFT" as const,
        location: "Block A lobby",
      },
      {
        name: "Jalan Eserina AB shop row OKU bays",
        kind: "OKU_PARKING" as const,
        location: "Jalan Eserina AB U16/AB car park, row A (2 bays)",
      },
      {
        name: "Community hall accessible toilet",
        kind: "ACCESSIBLE_TOILET" as const,
        location: "Community hall, ground floor",
      },
    ]) {
      await createPlace(db, staff, place, daysAgo(7));
    }
    const ramp = await suggestPlace(
      db,
      zainab,
      {
        name: "Surau Elmina Gardens ramp",
        kind: "RAMP",
        location: "Surau Elmina Gardens entrance",
      },
      daysAgo(3),
    );
    await db.query(
      `UPDATE access_places SET status = 'VERIFIED', verified_by = $2, verified_at = $3 WHERE id = $1`,
      [ramp.id, staff.id, daysAgo(2)],
    );
    await reportPlaceBlocked(
      db,
      zainab,
      ramp.id,
      "Motorcycles parked across the ramp after prayers.",
      daysAgo(1),
    );
    await saveAccessProfile(
      db,
      zainab,
      {
        needs: ["ELDERLY", "MOBILITY"],
        simpleMode: true,
        readAloud: true,
        flashAlerts: false,
        priorityHelp: true,
        priorityNote: "Lives alone; uses a walking frame.",
        consent: true,
      },
      daysAgo(5),
    );
    const link = await inviteCarer(db, zainab, meiling.memberCode!, daysAgo(5));
    await respondToCarerInvite(db, meiling, link.id, true, daysAgo(5));
    log(
      "Akses+: accessible places, a blocked ramp, a carer link and one home on the priority help list.",
    );
  }

  // --- Taman: gardens, plots, the roster and the wildlife log ---------------------------
  if (
    !(await one(db, "SELECT 1 FROM gardens WHERE township_id = $1", [
      township.id,
    ]))
  ) {
    // Named after the real Elmina Community Edible Gardens (Sime Darby Property with MBSA,
    // opened January 2019: over 100 plots of 2 m x 1 m to 6.5 m x 1 m, given out by ballot).
    // The 24 plots, their holders and the waiting list here are demo data.
    const valley = await createGarden(db, staff, {
      name: "Elmina Community Edible Gardens",
      location: "Elmina Central Park, Elmina West",
      plots: 24,
      plotSizeM2: 2,
    });
    await db.query(
      `UPDATE garden_plots SET size_m2 = CASE WHEN plot_no <= '08' THEN 2 WHEN plot_no <= '16' THEN 4 ELSE 6 END WHERE garden_id = $1`,
      [valley.id],
    );
    // Three neighbours won plots in the last ballot; Zainab is waiting for the next one.
    for (const person of [priya, hafiz, meiling])
      await applyForPlot(db, person, valley.id, daysAgo(30));
    await runBallot(db, staff, valley.id, daysAgo(20));
    await applyForPlot(db, zainab, valley.id, daysAgo(5));
    const today = new Date(now.getTime());
    const isoDay = (d: Date) => d.toISOString().slice(0, 10);
    const code = (await one<{ code: string }>(
      db,
      "SELECT code FROM gardens WHERE id = $1",
      [valley.id],
    ))!.code;
    await markWatered(db, priya, code, daysAgo(1, 1));
    await takeRosterDay(
      db,
      hafiz,
      valley.id,
      isoDay(new Date(today.getTime() + DAY)),
      now,
    );
    await takeRosterDay(
      db,
      meiling,
      valley.id,
      isoDay(new Date(today.getTime() + 3 * DAY)),
      now,
    );
    for (const [person, kind, species, location, confirm] of [
      [priya, "BIRD", "Oriental magpie-robin", "Edible garden fence, Elmina Central Park", true],
      [
        hafiz,
        "INSECT",
        "Common birdwing butterfly",
        "Elmina Community Edible Gardens",
        true,
      ],
      [
        meiling,
        "REPTILE",
        "Asian water monitor",
        "Lake, Elmina Valley Central Park",
        true,
      ],
      [
        daniel,
        "BIRD",
        "Collared kingfisher",
        "Elmina Central Park entrance",
        true,
      ],
      [
        aisyah,
        "AMPHIBIAN",
        "Common toad",
        "Jalan Metafasa U16/171 drain, after rain",
        false,
      ],
    ] as const) {
      const s = await addSighting(
        db,
        person,
        { kind, species, location },
        daysAgo(4),
      );
      if (confirm) await decideSighting(db, staff, s.id, true, daysAgo(3));
    }
    log(
      "Taman: the edible gardens, a ballot and its waiting list, a watering roster and the wildlife log.",
    );
  }

  // --- Assistant: one saved chat, so the history list has something in it -------------
  if (
    !(await one(db, "SELECT 1 FROM assistant_conversations WHERE user_id = $1", [
      aisyah.id,
    ]))
  ) {
    // Answers from the checked knowledge, as the rules give them, with their sources.
    const entry = (id: string) => KNOWLEDGE.find((e) => e.id === id)!;
    const answerFrom = (id: string) => ({
      role: "ASSISTANT" as const,
      text: entry(id).short,
      link: entry(id).appLink,
      sources: entry(id).sources.map((s) => ({ ...s, checked: entry(id).checked })),
      meta: { mode: "RULES", rule: "knowledge" },
    });
    const chat = await saveMessages(
      db,
      aisyah,
      { messages: [{ role: "USER", text: "When is rubbish collected?" }, answerFrom("waste-collection")] },
      daysAgo(2, 2),
    );
    await saveMessages(
      db,
      aisyah,
      {
        conversationId: chat.conversationId,
        messages: [{ role: "USER", text: "What homes is Sime Darby selling in Elmina?" }, answerFrom("homes-for-sale")],
      },
      daysAgo(2, 2),
    );
    log("Assistant: a saved chat for Aisyah.");
  }
}
