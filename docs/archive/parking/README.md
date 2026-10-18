# Guided parking (removed for now, 17 October 2026)

Guided parking was taken out of SimeTown for now. Everything needed to bring it
back is in this folder:

- `restore-parking.patch`: the exact code, pages, tests, demo data, Malay
  translations and docs as they were the day it was removed (refreshed the
  same day to apply on top of the courier platform).
- This file: what the feature did, so it can be rebuilt if the patch no longer
  applies cleanly.

The database tables were **not** dropped: migration `015_township_of_tomorrow.sql`
still creates `parking_areas`, `parking_bookings` and `parking_searches`. They
are simply unused while the feature is out.

## Bringing it back

From the project folder:

```
git apply --ignore-whitespace docs/archive/parking/restore-parking.patch
npm run docs:api
npm test
```

If `git apply` refuses because the code has changed since, give Claude this
file and the patch and ask for parking to be added back.

## What it did

Brief item: *prebooked parking* (PEOPLE). Drivers going somewhere busy in the
township (Elmina Central Park at weekends, the community hall on event days,
the surau on Friday) see which car park has room and are sent there, or book
one of a few free bays held back for booking. The brief's test is built in:
residents time how long finding a bay takes, with guidance and without, and
staff compare the two.

### Residents: `/app/parking` (home tile and side menu "Parking")

- Places grouped with their car parks. Each car park shows how full it looks
  now (OK / Nearly full / Full, a bar, "About N free of M"), with **Best now**
  on the one with most free bays. A banner says occupancy is **simulated**
  until bay sensors exist; bookings and timings are real.
- **Guide me there**: opens directions to the car park and starts a timed
  search. **Time my search without guidance** starts an unguided one. A panel
  then shows "Heading to …" with **I have parked** (stops the clock; "Parked in
  N min") and **Stop timing**. Only one search runs at a time, and the screen
  says never to tap while driving.
- **Book a bay** at car parks that hold some back: choose a day (today up to 7
  days ahead), a time (Morning before 12 pm, Afternoon 12 to 6 pm, Evening
  after 6 pm) and the vehicle number. It is free; the resident gets a booking
  code (`B` + 5 characters) to show the attendant or guard. **My bookings**
  lists upcoming bookings with **Cancel**.
- Bookings also appeared in **My requests** ("Parking at …", the car park, day
  and time, and the booking code) and in the Assistant's `get_my_requests`
  tool.

### Staff: `/console/parking` (console menu "Parking")

- **Time to find a bay**: per place, the average minutes guided and unguided
  over 90 days (searches over 60 minutes left out as abandoned), with the
  number of searches and the minutes saved.
- **Car parks**: each with total bays, bookable bays and bookings this week.
- **Add a car park**: place, car park name, total bays, bookable bays (no more
  than the total), optional latitude and longitude. A place and name pair is
  unique per township; adding one is recorded in the audit log.

### Rules (was BR35)

- Occupancy is simulated and always labelled. It is deterministic per car park
  and 15-minute slot: an hourly curve (busiest in the evening), plus weekends,
  plus Friday 12 to 2 pm, plus a fixed per-car-park bias and jitter, kept
  between 3% and 98%. Free bays are worked out from the open (not bookable)
  bays only.
- Bookable bays are held back from the open ones and capped per car park, day
  and time. One booking per person per place and time. Days from today up to 7
  ahead only.
- Verified residents only; staff for the console.

### API (all under `/api/v1`)

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/parking` | resident | Places, car parks, simulated occupancy, best car park now |
| GET | `/parking/bookings` | resident | My upcoming bookings |
| POST | `/parking/bookings` | resident | Book a bay `{ areaId, day, slot, vehicleNo }` (20 an hour) |
| POST | `/parking/bookings/:id/cancel` | resident | Cancel a booking |
| POST | `/parking/searches` | resident | Start timing `{ place, areaId?, guided }` (30 an hour) |
| POST | `/parking/searches/:id/parked` | resident | Stop the clock; returns minutes |
| GET | `/admin/parking` | staff | Guided vs unguided minutes, car parks, bookings this week |
| POST | `/admin/parking/areas` | staff | Add a car park |

Errors: `NOT_BOOKABLE`, `PARKING_DAY`, `ALREADY_BOOKED`, `PARKING_FULL`,
`TOO_MANY_BOOKABLE`, `AREA_EXISTS`.

### Database (still in migration 015)

- `parking_areas`: township, place, name, total_bays, bookable_bays (≤ total),
  lat, lng, active; unique (township, place, name).
- `parking_bookings`: area, user, day, slot (MORNING / AFTERNOON / EVENING),
  vehicle_no, code, status (BOOKED / CANCELLED), created_at.
- `parking_searches`: township, user, place, area (null when unguided),
  guided, started_at, parked_at.

### Code that was removed

- `src/server/modules/parking/service.ts` and `routes.ts`, registered in
  `src/server/http/api.ts`.
- `src/app/app/parking/page.tsx`, `src/app/console/parking/page.tsx`.
- Links in `src/components/shell/nav.ts` and the home tiles in
  `src/app/app/page.tsx` (icon `SquareParking`).
- The `PARKING` kind in `src/server/modules/requests/service.ts`,
  `src/app/app/requests/page.tsx` and `src/server/modules/assistant/tools.ts`.
- Demo data in `scripts/seed-tomorrow.ts`: four car parks (Elmina Central Park
  North and Lakeside, Community hall, Surau Elmina Gardens), eight timed
  searches (guided about 2.5 to 5 min, unguided 8.5 to 13 min), Aisyah's
  evening booking at the hall, and Daniel's morning booking at North car park.
  The seed's "already seeded" check now looks at recycling collectors instead
  of car parks.
- The "Guided parking" test and the parking part of the My requests test in
  `tests/tomorrow.test.ts`.
- 65 Malay entries in `src/lib/i18n-extra.ts` and `src/lib/i18n-templates.ts`.
- README demo step 18 ("Guided parking") and the feature table row, and rule
  BR35 in `docs/BUSINESS_RULES.md` (now marked retired).

Not part of this feature, and kept: **OKU parking** places in Akses+, and the
`.occupancy-bar` style, which the smart lockers' overflow storage also uses.
