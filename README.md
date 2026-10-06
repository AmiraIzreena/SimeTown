# KITA+ Township Super-App

One web app for township life: residents recycle, move, report, share and shop locally; shops give
and accept points; sponsors fund challenges; Sime Darby Property (SDP) sees what the township
achieves. Built from the proposal **"KITA+ Township Super-App"** for the Sime Darby Property
University Hackathon 2026 ("Township of Tomorrow", People & Planet).

> A student prototype. It is **not** an official Sime Darby Property product. All residents,
> shops, sponsors and figures in the demo data are invented, and **no real money moves**.

The heart of the system is one rule: **no pool, no points.** A point is given only after a shop, a
sponsor or SDP has paid for it, and the reward float is checked against the points residents hold,
to the sen. That rule is enforced in the database itself, not just in the screens.

---

## 1. Run it in five minutes

You need **Node.js 22 or newer**. Nothing else: by default the app uses an in-process PostgreSQL
(PGlite), so there is no database to install.

```bash
npm install
cp .env.example .env          # the defaults work as they are
npm run db:setup              # creates the tables and the demo township
npm run dev                   # open http://localhost:3000
```

`db:setup` prints the demo accounts and **the password it generated for them**. To choose the
password yourself, set `SEED_DEMO_PASSWORD` in `.env` (10+ characters) before running it.

| Sign in as | Email | What you see |
| --- | --- | --- |
| Resident (main demo) | `aisyah@demo.kita.test` | Points & XP, Kitar, Gerak, Lapor, Jiran, Kongsi, Jimat, Banjir |
| Shop | `kafe@demo.kita.test`, `kedai@demo.kita.test` | Counter, sales, weekly statements |
| Shop, not yet approved | `bengkel@demo.kita.test` | The "waiting for approval" state |
| Sponsor | `sponsor@demo.kita.test` | Own campaigns and grouped results |
| Township staff | `staff@demo.kita.test` | Insights, report queue, flood sensors, kiosks and trails |
| Township admin | `admin@demo.kita.test`, `admin2@demo.kita.test` | Everything staff see, plus shops, money and corrections |
| SDP HQ admin | `hq@demo.kita.test` | Everything, plus the programme rules |

Notes for local use:

- Open the app at exactly the address in `APP_URL` (`http://localhost:3000`, not `127.0.0.1`).
  Requests from any other origin are refused on purpose.
- With the default PGlite database, stop `npm run dev` before running `db:*` or `job` scripts:
  only one process can open it at a time. With a real PostgreSQL this limit does not apply.
- To start again from nothing, delete the `.data` folder and run `npm run db:setup`.
- Every account needs a name, email and phone number; residents also need an address, chosen from
  the township's property record, and shops a business address. Everyone accepts the
  [Terms of Use](src/app/terms/page.tsx) and [Privacy Notice](src/app/privacy/page.tsx). Anyone
  missing a detail is asked for it after signing in: sign in as `grace@demo.kita.test` to see it.
- The legal texts' version and contact address live in [src/shared/legal.ts](src/shared/legal.ts).
  Changing `version` asks everyone to accept the texts again.

### Using a real PostgreSQL (recommended for a shared demo)

Set `DATABASE_URL=postgres://user:password@host:5432/dbname` in `.env` (PostgreSQL 15+), then
`npm run db:setup`. Or use Docker: see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## 2. The demo: one day in the Township of Tomorrow

Open two browser windows (one normal, one private) so you can be the resident and the shop at once.

1. **Kitar.** As Aisyah, open *Kitar*, pick "Plastic, PET", enter a kiosk code and a weight.
   (Codes: sign in as staff → *Kiosks & trails* → *Poster*. Scanning the poster's QR code opens the
   page with the code filled in.) She earns Impact XP; during a funded challenge she also earns
   points, and the screen says which sponsor paid.
2. **Gerak.** Scan both checkpoints of *Lake Loop* on the same day to complete it.
3. **KITA Merchant.** As the café, enter Aisyah's member code (her wallet → *Show my code*) and a
   RM20 bill: she earns 20 points. As the grocer, enter RM20 and switch on *Customer wants to use
   points* → 300. Aisyah's phone asks her to confirm; the grocer's screen updates by itself and its
   statement shows RM3 due this week.
4. **Lapor.** Report a broken street light with a photo. It is sorted as "Lighting, medium urgency";
   staff see it in their queue and can correct the suggestion (the correction is logged).
5. **Jiran and Kongsi.** Join the gotong-royong; give away an item and confirm the handover.
6. **Jimat.** Enter this month's electricity and water readings and see the change from last month.
7. **Banjir.** As staff, open *Flood sensors* and drag Zone A · Lakeside past 90%. Within 15 seconds
   a danger warning takes over Aisyah's screen with the safe route.
8. **KITA Insights.** The SDP dashboard has changed all day, with the float matched to the sen.

---

## 3. What is in the box

| Layer | Feature | Working here |
| --- | --- | --- |
| Core | KITA ID | Register against a unit, staff or owner confirms the home, six roles, invitations |
| Core | Points & XP | Balance, history with the funder of every point, levels, badges, street league, confirm-on-phone |
| People | Jiran | Events with places, help board, XP when the organiser or asker confirms |
| People | Lapor | Report with photo, suggested type and urgency, staff queue, case tracking, access-barrier type |
| People | Gerak | Loops with QR checkpoints, loop completion, distance milestones, sponsored challenge |
| Planet | Kitar | Material check (photo if an AI key is set, otherwise pick from a list), kiosk code, weight, street totals |
| Planet | Kongsi | Give away and lend, XP on confirmed handover |
| Planet | Jimat | Monthly readings, change from last month, tips, leak alert, opt-in solar request |
| Planet | Banjir | Zone levels, warning and danger lines, danger takeover with safe route, sensor ingest endpoint |
| Business | KITA Merchant | Apply and approval, give points, accept points up to 30%, refunds, weekly statement |
| Business | KITA Partner Hub | Campaigns with a prefunded pool, per-person limit, refund of the unused pool, grouped results |
| Business | KITA Insights | 30-day township totals, float against what it owes, report clusters |

Also built because a real system needs them: moderation of flagged posts, the daily float check,
weekly settlement, points expiry and reminders, two-person approval for balance corrections, an
audit trail, adjustable programme rules, data download and account deletion.

**Not built, on purpose** (the proposal lists them as later modules, and half-built versions would
make the system less reliable): Akses, Taman, KITA Assistant, KITA Home. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#what-we-chose-not-to-build).

**Simulated, and labelled so in the app:** no real money moves (deposits and settlements are
ledger entries an admin records); the flood sensor is a slider; meter readings are typed; there is
no SMS, e-mail or one-time code.

---

## 4. Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | All 64 tests, on in-process PostgreSQL |
| `TEST_DATABASE_URL=postgres://… npm test` | The same tests on a real server (this **empties that database**) |
| `npm run lint` / `npm run typecheck` / `npm run check` | Code checks (`check` runs lint, types and tests) |
| `npm run db:migrate` | Apply new migrations |
| `npm run db:seed` | Load the demo township (refuses when `APP_ENV=production`) |
| `npm run bootstrap -- <file.json>` | Set up a real township: zones, homes and the first admin's invitation link (see `docs/bootstrap.example.json`) |
| `npm run job -- <name>` | Run `expire-points`, `float-check`, `settle` or `cleanup` once |
| `npm run docs:api` | Regenerate `docs/API.md` and `docs/openapi.json` from the route table |

---

## 5. Where things are

```
src/
  app/                    Screens and the one API entry point (Next.js App Router)
    api/v1/[...path]/     Hands every API request to the router in src/server
    app/ merchant/ sponsor/ console/      One folder per role's area
  components/
    ui/                   The design system: buttons, fields, dialogs, tables, charts, toasts
    shell/                Navigation frame, notifications, flood danger takeover
    features/             Pieces shared by several screens
  lib/                    Browser-side API client, hooks, formatting
  server/                 The backend. Nothing in here imports from app/ or components/
    http/                 Router (auth, roles, validation, rate limits, errors), OpenAPI
    auth/                 Passwords, sessions, role helpers
    db/                   Database client, migration runner, migrations/*.sql
    modules/<feature>/    routes.ts (who may call what) + service.ts (rules and SQL)
    modules/ledger/       The double-entry points ledger
  shared/domain.ts        Words both sides use: roles, activities, categories
scripts/                  migrate, seed, job, API docs
tests/                    One test per business rule, plus API and concurrency tests
docs/                     Architecture, business rules, security, deployment, API
```

To follow one feature end to end, open `src/server/modules/<feature>/routes.ts`, then its
`service.ts`, then the screen under `src/app`.

---

## 6. Read next

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the assessment, the design, the database, the design and motion systems.
- [docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md): BR1 to BR22, where each is enforced and which test proves it.
- [docs/SECURITY.md](docs/SECURITY.md): what is protected and how, and what is still open.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): environments, Docker, Cloudflare, scheduled jobs.
- [docs/API.md](docs/API.md): every endpoint (also served at `/api/v1/openapi.json`).

---

## 7. What was checked, and what was not

Checked while building (October 2026, Node 22, PostgreSQL 16):

- Lint, type-check and production build pass.
- 64 automated tests pass on in-process PostgreSQL **and** on a real PostgreSQL 16 server, including
  five tests that fire requests at the same time (double spending, overdrawing a pool).
- Every screen was opened in Chromium at phone and desktop sizes with no console or
  Content-Security-Policy errors, and the main journeys (earn, spend with confirmation, drop-off,
  report with photo, flood takeover) were run end to end in the browser.
- An automated accessibility scan (axe-core, WCAG 2.2 A and AA rules) reports no violations on the
  27 screens checked, each at phone and desktop size. Automated scans catch only part of accessibility; no screen-reader or
  real-user testing was done.
- The self-contained production server that the Docker image runs was started and exercised.
- The ZIP was unpacked into an empty folder and taken through section 1 exactly as written
  (`npm ci`, `.env.example`, `db:setup` on the zero-install database, checks, build, start), and
  the browser journeys were run again against that copy.

Not checked:

- The Docker image itself and `docker compose` were not built (no Docker daemon was available).
- Nothing was deployed. The Cloudflare set-up in the deployment guide is a design, not a tested one.
- The hosted AI call was not made (no key). Its request and fallback logic is written and the
  fallback paths are tested; the live call is not.
- No load test, no penetration test, no browsers other than Chromium, no real phones.
- The rates (1 point per RM1, 15% fee, limits) are the proposal's **assumptions**, not validated figures.
