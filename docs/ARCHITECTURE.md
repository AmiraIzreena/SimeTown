# Architecture

This document explains how KITA+ is built and why. It follows the order the work was done in:
assess, design, build, check.

## 1. Assessment: what we started from

There was no existing code. The input was the proposal (27 pages) and its 22 business rules. The
assessment below is therefore of the *specification*.

| Question | Finding |
| --- | --- |
| Existing architecture | None. The proposal describes two: a one-project prototype and a multi-service pilot. |
| Existing stack | Stated for the prototype: TypeScript, Next.js, Tailwind, PostgreSQL, a double-entry points ledger with a test per rule. We kept it, so the proposal and the code agree. |
| Existing features | 16 modules described; 12 promised as working in the prototype. |
| Missing requirements | The proposal does not say how a shop's money reaches the float, what happens to a refund when the points are already spent, how fractions of a sen are rounded, or who may undo a paused programme. Each is decided in code and listed in [BUSINESS_RULES.md](BUSINESS_RULES.md#decisions-the-proposal-left-open). |
| Security concerns | Points are money-like: double spending, overdrawing a pool, one shop reading another's sales, staff editing balances, cross-township access, fake "photos", password guessing. All are addressed in [SECURITY.md](SECURITY.md). |
| Performance concerns | Dashboards over growing tables, unbounded lists, heavy client bundles. Addressed with indexes, cursor pagination, no chart or date libraries, and lazy loading of the QR generator. |
| UI/UX risks | Three audiences with different devices: residents on phones, cashiers at a counter, staff at desks. One design system, three navigation patterns. |
| Duplication risks | Jiran events, the help board and Kongsi are the same flow (post → respond → confirm). Built once (`community`). Every feature rewards through one function (`recordAction`). |
| Deployment limits | A long-lived PostgreSQL connection pool and password hashing suit a Node server better than an edge runtime. See [DEPLOYMENT.md](DEPLOYMENT.md). |
| Keep / refactor | Nothing to keep or refactor. |
| <a id="what-we-chose-not-to-build"></a>**Should not be added** | See below. |

### What we chose not to build

| Left out | Why |
| --- | --- |
| A language model behind KITA Assistant; real bookings in KITA Home | The third edition adds Akses+ and Taman as working features. The Assistant and KITA Home need a tuned language model and real service providers, so they are shown as clearly labelled previews: the Assistant answers from fixed rules over the resident's own data, and KITA Home is a mock-up where nothing can be booked or sold. |
| Machine learning for the recycling machine, CCTV and bills | Planned after the hackathon selection. The machine is a tablet page whose buttons stand in for camera, barcode and scale (its signed records are real); CCTV is a fixed set of test pictures with known readings; bills are read from the PDF's own text, with the optional AI service for photos. |
| In-app payments, top-up, stored cash | Rule BR11 forbids them, and they would bring e-money regulation. Residents pay shops directly. |
| A separate API service, Redis, queues, WebSockets | The pilot design has them. At prototype scale they add operations work and no user benefit: polling every few seconds is enough for a counter confirmation and a flood alert. The backend is already isolated (`src/server`) so it can be lifted out later. |
| An ORM | The ledger is a handful of precise SQL statements. Plain parameterised SQL keeps them readable and reviewable, and removes a dependency. |
| A global state library, a component library, a chart library, a date library | SWR covers server data; the UI kit is about 900 lines; charts are plain CSS bars; dates use `Intl`. |
| Dark mode; a full Malay translation | Worth doing, and each doubles the testing surface. The third edition adds an EN/BM switch (`src/lib/i18n.ts`) covering navigation, the home screen, Simple Mode, Tamu and flood alerts; the rest stays in English. |
| Third-party map tiles | They would break the strict security policy and send residents' positions to another company. The township map is drawn in the page from the township's own data (`township-map.tsx`). |
| E-mail, SMS, push | Marked "simulated" in the proposal. Notifications are in-app; `notify()` is the single hook where delivery would be added. |

## 2. Target architecture

```
 Browser (phone or laptop)
   │  pages (HTML, CSS, JS)            │  JSON over /api/v1/*  (session cookie)
   ▼                                   ▼
 ┌───────────────────────────── one Next.js deployment ─────────────────────────────┐
 │  src/proxy.ts     CSP nonce per request, security headers, signed-out redirect   │
 │  src/app/**       screens (React)        src/app/api/v1/[...path]  one handover  │
 │                                                     │                            │
 │  src/server/http/router.ts   ◄──────────────────────┘                            │
 │     origin check → session → role → rate limit → validation → handler → errors   │
 │  src/server/modules/<feature>/routes.ts → service.ts                             │
 │     identity · wallet · merchant · offers · campaigns · community · reports ·    │
 │     gerak · kitar · jimat · banjir · tamu · akses · taman · insights · admin     │
 │  src/server/files/*                 upload gate and PDF reader (bills)           │
 │  src/server/modules/rewards.ts      XP, limits, campaign awards (one door)       │
 │  src/server/modules/ledger/*        double-entry ledger, float, settlement       │
 └───────────────────────────────────────────┬──────────────────────────────────────┘
                                             ▼
                          PostgreSQL 15+ (constraints and triggers
                          guard the ledger even against our own bugs)

 Scheduler ──bearer token──► POST /api/v1/internal/jobs/{expire-points|float-check|settle|cleanup|flood-agent}
 Sensor bridge ──bearer token──► POST /api/v1/ingest/flood
 Recycling machine ──HMAC-signed records──► POST /api/v1/ingest/kitar/{start|items|finish}
 Optional: hosted AI vision service ◄── one HTTPS call from src/server/ai/classifier.ts
```

**Frontend and backend are separated by a rule, not by a network hop.** Nothing under `src/server`
imports from `src/app` or `src/components`, and screens talk to the backend only through the HTTP
API (`src/lib/api.ts`). The only exception is `src/server/auth/guard.ts`, which area layouts call
to decide which screens to show. The router takes a standard `Request` and returns a `Response`,
so the whole backend can move behind NestJS or onto another host without touching the rules.

### One request, start to finish

`POST /api/v1/merchant/sales`:

1. `route.ts` hands the request to the router.
2. The router finds the route, checks that the `Origin` header is ours (CSRF), loads the session
   from the cookie, checks the role is `MERCHANT`, counts the request against the rate limit and
   validates the body with the route's Zod schema.
3. `merchant/service.ts → createSale` opens **one database transaction**: it finds the resident,
   checks the limits, moves the points and the fee in the ledger and stores the sale.
4. If anything fails, the transaction rolls back and the router turns the error into a safe JSON
   message. One structured log line is written with a request id.

Every endpoint is declared the same way, in one place per feature:

```ts
route({
  method: 'POST', path: '/merchant/sales', tag: 'KITA Merchant',
  summary: 'Record a sale: give points, and optionally ask to accept points',
  auth: 'session', roles: ['MERCHANT'],
  body: z.object({ memberCode: zMemberCode, billSen: zSen(10_000_000), … }),
  handler: (c) => merchant.createSale(c.db, c.actor, c.body, c.now),
})
```

Because who-may-call-what is data, it is easy to audit, and the same table generates
[API.md](API.md) and the OpenAPI document.

Routes use one of five auth modes: `public`, `session` (cookie, Origin check and role),
`cron` and `sensor` (bearer tokens), and `machine`. A `machine` route takes no cookie and no
Origin; the handler checks the record's HMAC-SHA256 signature with that machine's own key, its
age (5 minutes at most) and its sequence number before anything is stored
(`kitar/machine.ts → assertSigned`).

## 3. Technology choices

| Choice | Why |
| --- | --- |
| **TypeScript everywhere**, strict | One language for five students; types shared between screens and server. |
| **Next.js (App Router) + React** | The proposal's choice. One deployable project with pages and API. All pages render per request, which the nonce-based security policy needs. |
| **Tailwind CSS v4** | Design tokens live in one CSS file; no separate component library to learn. |
| **PostgreSQL** | Transactions, row locks, check constraints and triggers are exactly what a points ledger needs. |
| **`pg`**, plain SQL, numbered `.sql` migrations | Small, well understood, no ORM layer between us and the ledger. |
| **PGlite** (dev and tests only) | Real PostgreSQL compiled to WebAssembly, in-process. Tests run with no services, and a teammate can run the app with only Node installed. Refused outside development. |
| **Zod** | One schema validates the request and documents it. |
| **SWR** | Caching, de-duplication, refresh on focus and polling for the few live screens. |
| **Server-side sessions** in an HttpOnly cookie | Simple to revoke (delete the row), nothing sensitive in the browser, no token-refresh logic. |
| **scrypt** from Node's own crypto | A memory-hard password hash with no extra dependency. |
| **Vitest** | Fast, TypeScript-native. |

Runtime dependencies: `next`, `react`, `react-dom`, `pg`, `zod`, `swr`, `lucide-react` (icons),
`qrcode` (loaded only when a code is shown) and two self-hosted font packages. That is all.

## 4. Database design

One migration, `src/server/db/migrations/001_init.sql`, about 30 tables in these groups:

| Group | Tables |
| --- | --- |
| Places and organisations | `townships`, `flood_zones`, `homes`, `merchants`, `sponsors` |
| People and access | `users`, `sessions`, `user_invites`, `rate_limits`, `audit_log`, `notifications` |
| Programme set-up | `program_settings` (one row), `activity_rules` |
| Rewards | `xp_events`, `campaigns`, `campaign_awards` |
| **Ledger** | `ledger_accounts`, `ledger_txns`, `ledger_entries`, `point_lots` |
| Shops and money | `sales`, `settlements`, `deposits`, `float_checks`, `adjustments` |
| Features | `posts`, `post_responses`, `post_flags`, `uploads`, `reports`, `gerak_*`, `kitar_*`, `jimat_readings`, `solar_leads`, `flood_readings`, `flood_alerts` |
| Third edition (`004_third_edition.sql`) | Shop Offers: `shop_offers`, `offer_pledges`, `offer_months`, `offer_point_lots`, `offer_fees`, `sponsor_tier_payments`. Tamu: `visitor_passes`, `visitor_entries`, `guard_sos`, `patrol_points`, `patrol_scans`. Machines and tracking: `kitar_machines`, `kitar_sessions`, `kitar_items`, `gerak_activities`, `gerak_activity_hits`. Bills: `jimat_bills` (numbers only, never the file). Banjir agent: `flood_signals`, `flood_messages`, `flood_agent_log`, `flood_checkins`. Akses+: `access_profiles`, `carer_links`, `access_places`. Taman: `gardens`, `garden_plots`, `garden_roster`, `wildlife_sightings`. |

Decisions worth knowing:

- **Money is whole sen in integer columns.** 100 points = RM1, so one point is one sen and points
  and money share a unit. No floating point anywhere near a balance.
- **Status columns are `text` with `CHECK` constraints**, not enum types: a new status is a
  one-line migration.
- **Every foreign key is declared**, and the things that must be unique are unique in the database:
  one e-mail, one member code, one sale per idempotency key, one open flood alert per zone, one
  bank reference, one XP event per verified thing.
- **Indexes follow the queries**: each list is keyset-paginated on `(created_at, id)` or the serial
  id, and has the matching index.
- **Role rules are constraints too**: a resident must have a home and a member code; a shop
  account must have a shop; a balance correction cannot be decided by the person who asked for it.
- **Soft deletion is used in exactly one place**: a deleted user is anonymised but the row stays,
  because ledger history must remain complete. Everything personal is wiped
  (`identity/service.ts → deleteAccount`).
- **Rules that may change are data**: rates, limits, expiry periods and flood lines are in
  `program_settings`; XP per activity and its caps are in `activity_rules`.
- **Photos are stored in the database** (`uploads.bytes`), at most 1.5 MB each after the browser has
  shrunk them. This keeps the prototype to one piece of infrastructure. At pilot scale they belong
  in object storage (for example Cloudflare R2); only `reports/service.ts` would change.

## 5. The points ledger

### Accounts

| Account | Kind | Meaning |
| --- | --- | --- |
| `TRUST_BANK` | asset | The ring-fenced reward float |
| `OPERATING_BANK` | asset | KITA+'s own money |
| `FUNDER_POOL` (per shop, per campaign) | liability | Money paid in, not yet given as points |
| `WALLET` (per resident) | liability | Points a resident holds |
| `MERCHANT_PAYABLE` (per shop) | liability | Owed to a shop for points it accepted |
| `COMMUNITY_POOL` | liability | Value held for community rewards and corrections |
| `REVENUE_*` | income | Issuance fee, campaign fee, campaign running costs, Shop Offer success fee (`REVENUE_SUCCESS_FEE`), sponsor tier fees (`REVENUE_SPONSOR_TIER`) |

### What each event writes

Every event is one balanced transaction (debits = credits). Amounts for the proposal's examples:

| Event | Entries |
| --- | --- |
| Shop pays RM500 into its pool | Dr trust 50,000 · Cr shop pool 50,000 |
| RM20 sale earns 20 points (example 1) | Dr shop pool 23 · Cr wallet 20 · Cr issuance-fee revenue 3; and the fee's cash moves: Dr operating 3 · Cr trust 3 |
| Resident spends 300 points (example 2) | Dr wallet 300 · Cr shop payable 300 |
| Weekly settlement | Dr shop payable · Cr trust |
| Sponsor funds RM20,000 (example 3) | Dr trust 1,200,000 · Cr campaign pool 1,200,000; Dr operating 800,000 · Cr campaign-fee revenue 500,000 · Cr running-costs revenue 300,000 |
| Challenge reward of 300 points | Dr campaign pool 300 · Cr wallet 300 |
| Campaign closes with RM4,500 unused | Dr campaign pool 450,000 · Cr trust 450,000 |
| Points expire | Dr wallet · Cr the funder's pool (or the community pool if that campaign has closed) |
| Refund: earned points clawed back | Dr wallet · Cr shop pool |
| Refund: spent points returned | Dr shop payable (or its pool, if already paid out) · Cr wallet |
| Shop Offer used: 10% success fee on a RM3 discount | Dr shop pool (or what the float owes the shop) 30 · Cr success-fee revenue 30; Dr operating 30 · Cr trust 30 |
| Sponsor buys a tier | Dr operating · Cr sponsor-tier revenue (income, never in the float) |

### The invariant

After every one of those:

```
trust bank  =  wallets + shop payables + funder pools + community pool
```

and the sum of open point batches equals the sum of wallets. The proposal's sentence "the float
always equals the points residents hold" is the first term; the rest is money the float holds for
shops and funders. The daily float check verifies this, re-adds every entry to prove the stored
balances, optionally compares with the bank statement, and **pauses all point movements** if
anything is off.

### Why it cannot drift

Three guards sit in the database, below the application code:

1. A trigger keeps `ledger_accounts.balance` in step with the entries, and a `CHECK (balance >= 0)`
   makes overdrawing any account impossible. This is "no pool, no points" as a database fact.
2. A deferred constraint trigger rejects, at commit, any transaction whose entries do not sum to zero.
3. Triggers refuse `UPDATE` and `DELETE` on entries and transactions. Corrections are new entries.

Concurrency: every money operation locks the accounts it touches (`SELECT … FOR UPDATE`) inside
one transaction, and earning locks the home so household limits hold. Deadlocks and serialization
failures are retried. `tests/concurrency.test.ts` fires simultaneous requests at these paths.

### Batches of points

`point_lots` records each batch a resident receives: who funded it, when it was earned, when it
expires, how much is left and how much was spent at shops. Spending uses the batch that expires
soonest. This is what lets the wallet show the funder of every point (BR8), lets expired value go
back to the right funder (BR10) and lets a campaign report say how much was spent locally.

### Offer-backed points (third edition)

A Shop Offer is a discount a shop promises, not money it paid in, so the points it backs are kept
**outside** the ledger, in `offer_point_lots`. They never touch the trust bank, and the float
invariant above is unchanged. "No pledge, no points": each month the shops' live offers become
pledges (`offer_pledges`); `giveOfferPoints` locks the township's month row and never gives more
than was pledged, than the home's monthly limit (800) or than the action is worth. Spending locks
the shop's pledge row, a `CHECK (used_sen <= budget_sen)` stops it going over, and batches are
used soonest-expiring first. The only real money in an offer is the success fee, which goes
through the ledger like the issuance fee. The wallet shows one balance with both kinds of backing.

## 6. Rewards: one door

`modules/rewards.ts → recordAction()` is called by every People and Planet feature once its own
check has passed (kiosk code scanned, staff confirmed the report, neighbour confirmed the favour…).
It gives Impact XP, applies the daily and monthly caps, makes the action impossible to count
twice, and then awards points from any live, funded campaign that covers the action, up to the
per-person cap and only while the pool can pay. Features never touch the ledger themselves.
Actions proved by something stronger than the resident's word (a signed machine session, a
tracked trip, a bill-verified saving, a garden code) pass `offerEligible` and may also earn
offer-backed points; a guest machine session claimed later passes `xpOnly`.

## 7. Design system

Defined in `src/app/globals.css` (tokens) and `src/components/ui` (components).

- **Colour.** Our own palette, inspired by the deep teal and warm red of Sime Darby's corporate
  identity; no logo or official colour value is copied. Teal (`brand-50…950`) carries structure and
  primary actions. Red (`accent`) is reserved for emphasis, destructive actions and danger alerts.
  Gold marks points. Neutrals (`ink`) are slightly teal-tinted so greys sit well beside the brand.
  Status colours: success green, warning amber, danger red, each with a pale background tone.
- **Type.** Plus Jakarta Sans for headings and numbers, Inter for text, both self-hosted
  (no third-party font requests). Body 15–16 px; numbers use tabular figures.
- **Space and shape.** Tailwind's 4 px scale; radius 6 / 10 / 14 / 20 px; four soft shadows tinted
  with the brand colour.
- **Components.** `Button` (primary, secondary, ghost, danger, light; three sizes; pending state),
  `Input` / `Select` / `Textarea` (label, hint and error wired for screen readers), `Card`, `Stat`,
  `Badge`, `Progress`, `Tabs`, `DataTable`, `Modal`, `Drawer`, `ConfirmDialog`, toasts, `Skeleton`,
  `EmptyState`, `ErrorState`, `BarChart`, `RankBars`, `QrCode`, `Reveal`.
- **States.** `Async` renders skeleton → content or error-with-retry for every loaded block, so
  loading, empty, error, forbidden and offline look the same everywhere. Forms show field-level
  messages from the server. Destructive or money-moving actions ask first; harmless ones do not.
- **Responsive patterns** (not a shrunk desktop):

  | Element | Phone | Tablet | Desktop |
  | --- | --- | --- | --- |
  | Navigation | Bottom bar (4 items) + "More" drawer | Icon rail | Full sidebar |
  | Dialogs | Bottom sheet | Centred | Centred |
  | Tables | Stacked cards, each value labelled | Table | Table |
  | Touch targets | 44 px minimum | | |

## 8. Motion system

One easing curve and three speeds, defined once as tokens:

| Token | Value | Used for |
| --- | --- | --- |
| `--ease-soft` | `cubic-bezier(0.22, 1, 0.36, 1)` | Everything |
| fast | 180–200 ms | Hover, press (`scale(0.98)`), focus, toggles, tab colour |
| base | 300 ms | Dialogs (fade + `scale(0.97→1)`), drawers and sheets (slide), toasts, page change (fade + 8 px rise), tab indicator |
| slow | 500–520 ms | Landing-page scroll reveal (fade + 18 px rise, 70 ms stagger), progress bars, chart bars growing once |

Where motion is used, and where it is not:

- **Scroll reveal** only on the landing page, through one `Reveal` component and
  `IntersectionObserver`. Content is visible by default and hidden only if it starts below the
  fold, so it still shows without JavaScript and when printed.
- **Parallax** only on the landing hero's background drawing, 28 px, driven by the browser's own
  scroll timeline (no scroll listener). Never in the app.
- **Count-up** once, when a headline number first appears. Later updates change instantly.
- **Skeletons** while data loads; no artificial delays.
- **Clickable cards** lift 2 px with a slightly deeper shadow. Static cards do not move.
- Only `transform` and `opacity` are animated, apart from progress-bar widths.
- No bouncing, glowing, pulsing or looping decoration.
- `prefers-reduced-motion: reduce` turns all of it off.

## 9. Performance

- Lists are cursor-paginated and indexed; dashboards use a handful of aggregate queries.
- The browser gets no chart, date, state or component library. The QR generator loads on demand.
- Fonts are self-hosted variable files with `font-display: swap`.
- API responses are `no-store` (they are personal). Static assets are fingerprinted and safe to
  cache for a year at the CDN.
- Polling is limited to three places: a pending counter confirmation (2 s, stops when answered),
  the resident's wallet (5 s), and flood alerts (15 s).

## 10. Accessibility

Semantic landmarks and headings; a skip link; visible focus rings; all controls reachable by
keyboard (tabs use arrow keys, dialogs are native `<dialog>` elements that trap focus and close on
Escape); every input has a label, and errors are announced; charts and gauges carry text
alternatives; toasts use live regions; colour is never the only signal; text contrast meets WCAG
AA; motion respects the system setting. The flood takeover is an alert dialog that must be
acknowledged rather than dismissed by accident.

## 11. From this prototype to the pilot design

| Pilot piece | What changes here |
| --- | --- |
| Separate API (NestJS) | Mount `src/server` behind it; routes and services move unchanged. |
| React Native app | Uses the same `/api/v1`; session cookie becomes a bearer token in `auth/session.ts`. |
| Phone one-time codes | Replace `identity/service.ts → login`; sessions stay. |
| Redis + queue | Jobs in `admin/service.ts → runJob` become queue workers. |
| MQTT sensors | A bridge posts to `/ingest/flood` (already there). |
| Real recycling machines | Each device gets its key at set-up (held in a key store, not the database) and posts to `/ingest/kitar/*` (already there). |
| Vision models (machine, CCTV, bill photos) | Replace the simulator buttons and test pictures; the agreement rules and the 60% confidence floor stay. |
| Virus scanning | Replace the EICAR stand-in in `files/gate.ts` with a real scanner (for example ClamAV). |
| Bank transfers | `runSettlement` gains a payout step and a "paid" confirmation. |
| Object storage | `uploads` moves to R2/S3. |
