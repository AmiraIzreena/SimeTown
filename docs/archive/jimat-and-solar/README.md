# Jimat and Solar sites (removed for now, 19 October 2026)

Two linked features were taken out of SimeTown for now:

- **Jimat** (residents): energy and water bill reading, monthly readings, tips,
  a leak alert, and the "Ask about solar" request.
- **Solar sites** (staff console): rooftops and car parks ranked for solar
  feasibility studies, using Jimat's demand data and solar requests.

They are archived together because Solar sites was built on Jimat's data and
the "Ask about solar" button lived in Jimat. Everything needed to bring them
back is in this folder:

- `restore-jimat-and-solar.patch`: the exact code, pages, tests, demo data,
  Malay translations and docs as they were the day they were removed.
- This file: what the features did, so they can be rebuilt if the patch no
  longer applies cleanly.

## What was kept on purpose

- **Database tables** are not dropped: `jimat_readings` and `solar_leads`
  (migration `001_init.sql`), `jimat_bills` (`004_third_edition.sql`) and
  `solar_sites` (`015_township_of_tomorrow.sql`). They are unused while the
  features are out, and existing rows come back with the features.
- **Personal data rights still cover the old data.** Download-my-data still
  exports a resident's Jimat readings, bills and solar request, and
  delete-my-account still deletes them (`identity/service.ts`). The daily
  cleanup still deletes unconfirmed bills after one day (`retention.ts`).
- **The XP activity types** `JIMAT_READING` and `JIMAT_SAVER` stay in
  `shared/domain.ts`, because past XP entries and campaigns in the database use
  them. Nothing can earn them any more.
- **The AI provider's PDF support** in `ai/classifier.ts` stays (it is generic);
  only the bill-reading prompt (`readBillWithModel`) was removed.
- **"Solar Cerah"** is a demo sponsor's name, not part of these features.

## Bringing them back

From the project folder:

```
git apply --ignore-whitespace docs/archive/jimat-and-solar/restore-jimat-and-solar.patch
npm run docs:api
npm test
```

`docs/API.md` and `docs/openapi.json` are not in the patch: `npm run docs:api`
rebuilds them from the routes.

If greener materials (`docs/archive/greener-materials/`) is also wanted back,
apply this patch first and that one second: both touch `planet/routes.ts`.

If `git apply` refuses because the code has changed since, give Claude this
file and the patch and ask for Jimat and Solar sites to be added back. To bring
back only Jimat, restore the patch and then remove Solar sites again
(`src/server/modules/planet/`, `src/app/console/solar/`, its nav entry and
tests).

## What Jimat did (resident page `/app/jimat`)

### Monthly readings

- A resident typed electricity (kWh) and water (litres) readings, one entry per
  home per month, for this month or last month only.
- The page showed the change from last month, a month-by-month chart and tips
  (air-conditioning at 24–25°C, standby power, dripping taps, full loads).
- **Leak alert:** water use well above the home's recent average showed a
  "Possible leak" warning with what to check.
- **Saver month:** neither electricity nor water went up, and at least one fell
  by 5% or more. It earned the `JIMAT_SAVER` XP action and the "Saver" badge.
  Typed readings earned XP only (`JIMAT_READING`), never offer-backed points.

### Bill reading (BR25)

1. **File-safety gate** (`files/gate.ts`): the file's real signature (JPG, PNG,
   WebP or PDF only), at most 4 MB, a page limit, the EICAR test signature,
   active PDF content including `#`-escaped names; then a clean copy.
2. **Reading:** a PDF's own text was read (`files/pdf.ts`); a photo went to the
   AI service only when one was configured. Fields that could not be read
   confidently were marked "Please check".
3. **Confirm:** the resident confirmed or corrected usage, amount and month.
   Only bills from the last three months were accepted, and the same bill
   (account and month) could be used once only.
- The file was **never stored**: only its SHA-256 fingerprint and the
  confirmed numbers. The account number was kept only as a fingerprint
  (prefixed with the township) plus its last four digits.
- A bill-verified saving could earn offer-backed points.
- *Sample bill* produced a demo PDF to the resident's address, marked SAMPLE.

### Ask about solar (BR16)

- A resident could ask to be contacted about solar, or withdraw the request.
- Only then were their name, unit and contact details shown to staff, in
  **Console › People › Solar requests**.

### Elsewhere in the app

- Home screen tile, Simple Mode tile and the resident nav entry.
- "You saved": a **Lower bills** amount (the fall in read bills) on the home
  screen and in Points & XP.
- The Assistant's `get_my_bill_readings` tool and its "bills" rule.
- Console campaigns could reward "Jimat: months using less".
- SDP Insights showed "Homes that used less", meter readings and bills read.
- The public sponsorship page had a "Solar homes, one roof at a time"
  partnership spotlight that relied on Jimat readings and solar requests.

### API

| Method | Path | Who |
|---|---|---|
| GET | `/jimat` | Resident: readings, change from last month and tips |
| POST | `/jimat/readings` | Resident: enter monthly readings |
| POST | `/jimat/solar-interest` | Resident: ask about solar, or withdraw |
| GET | `/admin/solar-leads` | Staff: residents who asked about solar |
| GET | `/jimat/bills` | Resident: bills read and confirmed for the home |
| POST | `/jimat/bills` | Resident: upload a bill (multipart: file, kind) |
| POST | `/jimat/bills/:billId/confirm` | Resident: confirm or correct the numbers |
| POST | `/jimat/bills/:billId/discard` | Resident: throw away an unconfirmed bill |
| GET | `/jimat/sample-bill` | Resident: demo PDF bill, marked SAMPLE |

## What Solar sites did (console page `/console/solar`)

Staff added candidate rooftops and car parks (usable area, orientation,
shading, roof age, structural check, an optional expert rank). Each site got:

- **Estimated size:** usable m² × 0.15 kWp.
- **Estimated output:** kWp × 1,200 kWh a year, adjusted for orientation (flat
  1.0 down to east/west 0.92) and shading (low 1.0, medium 0.85, high 0.6;
  unsurveyed counts as 0.85).
- **Area demand:** the latest Jimat electricity readings of homes in the same
  area (flood zones were used as areas), added up per area, never per home.
- **Residents interested:** solar requests from homes in that area.
- **Score out of 100:** output 45 + demand 20 + interest 10 + readiness 25.
  Missing checks (shading survey, structural check, roof age) were flagged and
  lowered the score, so a site was never ranked high on unchecked data.
- **Against an expert's ranking:** how many of the app's top 3 were also in an
  engineer's top 3.

All figures were labelled as planning estimates (BR37). Routes, all staff-only:
`GET /admin/solar/sites`, `POST /admin/solar/sites`,
`PATCH /admin/solar/sites/:siteId`, `DELETE /admin/solar/sites/:siteId`.

### Demo data

`scripts/seed.ts` typed two months of readings for four residents;
`scripts/seed-tomorrow.ts` added five solar sites with an engineer's demo
ranking.
