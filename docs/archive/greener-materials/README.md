# Greener materials and the edging trial (removed for now, 19 October 2026)

The staff console's *Greener materials* page was taken out of SimeTown for now.
It answered the hackathon brief's "compare greener building materials" and
"prove waste-derived materials work", but material selection and material
trials belong to a developer's design, procurement and QA/QC process (and its
own tools, such as LCA software and supplier EPDs), not to a township
operations app. Everything needed to bring it back is in this folder:

- `restore-greener-materials.patch`: the exact code, console page, nav entry,
  tests, demo data, Malay translations and docs as they were the day it was
  removed.
- This file: what the feature did, so it can be rebuilt if the patch no longer
  applies cleanly.

The database tables were **not** dropped: migration `015_township_of_tomorrow.sql`
still creates `material_shortlists` and `edging_trial_tests`. They are simply
unused while the feature is out, and any saved shortlists or trial results come
back with the feature.

Kitar is not affected. The edging trial only *read* Kitar's recycling totals;
nothing in Kitar used the trial.

## Bringing it back

From the project folder:

```
git apply --ignore-whitespace docs/archive/greener-materials/restore-greener-materials.patch
npm run docs:api
npm test
```

`docs/API.md` and `docs/openapi.json` are not in the patch: `npm run docs:api`
rebuilds them from the routes.

**Order:** Solar sites (in `docs/archive/jimat-and-solar/`) was archived after
this, and it shared `planet/routes.ts`. Apply
`docs/archive/jimat-and-solar/restore-jimat-and-solar.patch` first, then this
patch. To bring back greener materials without Jimat and Solar sites, ask
Claude to rebuild it from this file instead.

If `git apply` refuses because the code has changed since, give Claude this
file and the patch and ask for greener materials to be added back.

## What it did

A staff-only console page (`/console/materials`, nav label "Greener materials",
roles TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN) with two tabs.

### Compare materials

- Staff pick one **use**, *Walkway paving* or *Landscape edging*, and set its
  requirements (an empty box is ignored):
  - Walkway paving: installed cost at most (RM per m²), service life at least
    (years), compressive strength at least (MPa), must let rain soak through.
  - Landscape edging: installed cost at most (RM per metre), service life at
    least (years), must be stable in sun and heat.
- Every material for that use is checked against each requirement: **meets**,
  **fails** or **no data**. A missing figure is never guessed.
- Missing evidence is flagged: no Environmental Product Declaration, no
  independent test report, recycled content claimed without a certificate, no
  embodied carbon figure.
- Ranking: fewest failed requirements, then fewest gaps in the data, then lowest
  embodied carbon, then lowest cost. Each row shows its carbon against the
  conventional choice (as a percentage).
- **Ask the agent**: the AI explains the comparison using only the table; with
  no AI provider, a rule-based summary is written instead.
- **Save shortlist**: the ticked materials are saved with the requirements and
  the seconds it took, and the page shows the median time to shortlist (the
  brief's "time to shortlist").
- The library (`MATERIAL_LIBRARY`) held **sample values** written into the code
  (five pavers, five edgings), labelled as samples on the page. They would
  need replacing with suppliers' datasheets before any real decision.

### Edging trial

A recycling partner turns plastic that residents recycled into landscape
edging. A trial strip is laid beside conventional concrete edging and both go
through the same 11 tests, set up automatically per township the first time the
tab is opened:

- **Safety:** sharp edges and splinters; trip height; behaviour near heat.
- **Performance:** dimensions as delivered; impact from a mower or trolley; sun
  and heat over three months; staying in line after heavy rain; cost per metre
  installed.
- **Environment:** recycled content (batch record); embodied carbon against
  concrete; shedding of plastic fragments.

Each test has a method and a pass rule. Staff record a status (PLANNED,
RUNNING, PASSED, FAILED) and a result for each strip; every change is written
to the audit trail (`TRIAL_TEST_UPDATED`). The tab also showed the township's
recycled plastic and, given the partner's kilograms of plastic per metre,
roughly how many metres of edging it would make.

### Rule

BR37 in `docs/BUSINESS_RULES.md` covered it: material figures are samples,
labelled as such, and the materials agent may use only the comparison table.
The solar half of BR37 is still active.

### API (all staff-only)

| Method | Path | What it did |
|---|---|---|
| GET | `/admin/materials` | The uses that can be compared and their requirements |
| POST | `/admin/materials/compare` | Check every material for one use against the requirements |
| POST | `/admin/materials/explain` | The agent explains the comparison, from the table only (30 an hour per user) |
| GET | `/admin/materials/shortlists` | Saved shortlists and the median time to make one |
| POST | `/admin/materials/shortlists` | Save a shortlist with the time it took |
| GET | `/admin/edging-trial` | The trial's tests and results, and the plastic collected |
| PATCH | `/admin/edging-trial/tests/:testId` | Record a result for the recycled and the concrete edging |

### Demo data

`scripts/seed-tomorrow.ts` saved one landscape-edging shortlist (steel and
recycled-plastic edging) and recorded three trial results.

## Reusable piece: plastic recycled in a township

The one part worth keeping for residents is the total plastic a township has
recycled, for example a "Where your plastic went" card on the Kitar page. This
is the query the trial used (`$1` is the township id). It counts kiosk
drop-offs and items the smart machines accepted:

```sql
SELECT (SELECT coalesce(sum(d.weight_g), 0)::int
          FROM kitar_dropoffs d JOIN kitar_kiosks k ON k.id = d.kiosk_id
         WHERE k.township_id = $1 AND d.material IN ('PLASTIC_PET', 'PLASTIC_OTHER')) AS kiosk_g,
       (SELECT coalesce(sum(i.weight_g), 0)::int
          FROM kitar_items i
          JOIN kitar_sessions s ON s.id = i.session_id
          JOIN kitar_machines m ON m.id = s.machine_id
         WHERE m.township_id = $1 AND i.accepted AND i.material IN ('PLASTIC_PET', 'PLASTIC_OTHER')) AS machine_g
```

The total in grams is `kiosk_g + machine_g`. It is a township total only; it
never shows who recycled what.
