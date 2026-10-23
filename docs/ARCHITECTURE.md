# Architecture

This document explains how SimeTown is built and why. It follows the order the work was done in:
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
| Payments and quotations in SimeTown Home | Home service bookings are real (see *SimeTown Home Services* below), but the price is agreed in person after inspection and paid to the company directly, so SimeTown holds no money and no quote is binding in the app. Warranty records and resale remain labelled previews. SimeTown Assistant is now an AI agent; see *SimeTown Assistant* below. |
| Machine learning for the recycling machine, CCTV and bills | Planned after the hackathon selection. The machine is a tablet page whose buttons stand in for camera, barcode and scale (its signed records are real); CCTV is a fixed set of test pictures with known readings; bills are read from the PDF's own text, with the optional AI service for photos. |
| In-app payments, top-up, stored cash | Rule BR11 forbids them, and they would bring e-money regulation. Residents pay shops directly. |
| A separate API service, queues, WebSockets | The pilot design has them. At prototype scale they add operations work and no user benefit: polling every few seconds is enough for a counter confirmation and a flood alert. The backend is already isolated (`src/server`) so it can be lifted out later. Redis is optional and limited to rate limits and a sign-in cache (see *Optional Redis* in section 3); money, the ledger, Insights and jobs stay in PostgreSQL. |
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
 │     gerak · kitar · banjir · tamu · akses · home-services ·                      │
 │     insights · admin                                                             │
 │  src/server/modules/rewards.ts      XP, limits, campaign awards (one door)       │
 │  src/server/modules/ledger/*        double-entry ledger, float, settlement       │
 └───────────────────────────────────────────┬──────────────────────────────────────┘
                                             ▼
                          PostgreSQL 15+ (constraints and triggers
                          guard the ledger even against our own bugs)

 Scheduler ──bearer token──► POST /api/v1/internal/jobs/{expire-points|float-check|settle|cleanup|flood-agent|parcel-reminders|lockers|couriers}
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
  method: 'POST', path: '/merchant/sales', tag: 'SimeTown Merchant',
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
| **Optional Upstash Redis** (REST, plain `fetch`) | Takes rate-limit counting and repeat sign-in lookups off the database when configured. No driver and no open connections; see below. |
| **scrypt** from Node's own crypto | A memory-hard password hash with no extra dependency. |
| **Vitest** | Fast, TypeScript-native. |

Runtime dependencies: `next`, `react`, `react-dom`, `pg`, `zod`, `swr`, `lucide-react` (icons),
`qrcode` (loaded only when a code is shown) and two self-hosted font packages. That is all.

### Optional Redis

The app runs fully without Redis. When `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
are set, two things use it, and nothing else does:

- **Rate limits** (`src/server/http/rate-limit.ts`). The same fixed windows as the `rate_limits`
  table, so the limits and the `Retry-After` header do not change. Redis sees only a SHA-256 hash
  of each key, never an email or IP address. If Redis fails or takes longer than one second, that
  request is counted in PostgreSQL instead, and Redis is left alone for 30 seconds. Never "allow
  everything" and never "block everything".
- **Session cache** (`src/server/auth/session-cache.ts`). `actorFromToken` keeps "this token
  hash belongs to this person" for up to `SESSION_CACHE_SECONDS` (60 by default), and never
  longer than the session has left. Keys are token hashes, never tokens. Every entry is tagged
  with a generation value and is only used while that value is current. `sessionsChanged(q)`
  replaces the generation after the change commits (`afterCommit` in `db/client.ts`). It is
  called wherever sessions end or a field `actorFromToken` returns changes: sign-out, password
  change, account deletion, invitation accepted, residency decision, home or name change, and
  every courier suspension or removal. A lookup stores what it read only under the generation it
  saw before querying, so a request racing with a change cannot store the old answer as current.
  `tests/redis.test.ts` fails if a new `DELETE FROM sessions` or a change to those user columns
  is added without the call. The `last_seen_at` update still happens every five minutes, because
  older entries are not used. If clearing the cache fails, that instance stops reading the cache
  until every entry has expired.

Money, the ledger, Insights and scheduled jobs never touch Redis.

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
| Features | `posts`, `post_responses`, `post_flags`, `komuniti_suspensions`, `uploads`, `reports`, `gerak_*`, `kitar_*`, `jimat_readings`, `solar_leads`, `flood_readings`, `flood_alerts` |
| Third edition (`004_third_edition.sql`) | Shop Offers: `shop_offers`, `offer_pledges`, `offer_months`, `offer_point_lots`, `offer_fees`, `sponsor_tier_payments`. Tamu: `visitor_passes`, `visitor_entries`, `guard_sos`, `patrol_points`, `patrol_scans`. Machines and tracking: `kitar_machines`, `kitar_sessions`, `kitar_items`, `gerak_activities`, `gerak_activity_hits`. Bills: `jimat_bills` (numbers only, never the file). Banjir agent: `flood_signals`, `flood_messages`, `flood_agent_log`, `flood_checkins`. Akses+: `access_profiles`, `carer_links`, `access_places`. Retired Taman tables (`gardens`, `garden_plots`, `garden_roster`, `wildlife_sightings`, `garden_applications`) remain only to preserve historical records. The Assistant's saved chats use `assistant_conversations` and `assistant_messages`. |

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
- **Photos are stored in the database** (`uploads.bytes`): JPEG or PNG, at most 10 MB as chosen, and
  usually far smaller because the browser shrinks them to 1280 px and the server rebuilds them. This keeps
  the prototype to one piece of infrastructure. At pilot scale they belong in object storage (for example
  Cloudflare R2); `http/uploads.ts` (`storeUpload`) and the modules that still insert into `uploads`
  directly would change.

## 5. The points ledger

### Accounts

| Account | Kind | Meaning |
| --- | --- | --- |
| `TRUST_BANK` | asset | The ring-fenced reward float |
| `OPERATING_BANK` | asset | SimeTown's own money |
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
tracked trip, a bill-verified saving) pass `offerEligible` and may also earn
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

**Accessible view and Simple Mode** (residents only) are two independent modes, worked out once by
`AksesModesProvider` in the Shell (`src/components/features/akses-mode.tsx`) and read anywhere with
`useAksesMode()`:

| Mode | Turned on by | What it changes |
|---|---|---|
| Accessible view | The top-bar switch, remembered per account in this browser. Before it is used, any saved access need turns it on. | Presentation only: larger text, larger targets, a labelled menu. |
| Simple Mode | The Simple Mode setting in Akses+, saved on the account. | The experience: the four-button home, forms that ask one question at a time, plain wording (`src/lib/i18n-plain.ts`), calmer solid surfaces. |

The provider marks `<html>` with `data-akses-view` and `data-simple-mode`, so the styles in
`globals.css` also reach dialogs, the menu drawer, toasts and pop-ups. Text grows through the
Tailwind type tokens (`--text-sm` and so on); fixed sizes such as `text-[15px]` are mapped one by one,
and `tests/akses-modes.test.ts` fails if a new fixed size is added without a mapping. Prefer the
named sizes in new screens.

## 11. From this prototype to the pilot design

| Pilot piece | What changes here |
| --- | --- |
| Separate API (NestJS) | Mount `src/server` behind it; routes and services move unchanged. |
| React Native app | Uses the same `/api/v1`; session cookie becomes a bearer token in `auth/session.ts`. |
| Phone one-time codes | Replace `identity/service.ts → login`; sessions stay. |
| Queue | Jobs in `admin/service.ts → runJob` become queue workers. Redis is already optional for rate limits and the session cache. |
| MQTT sensors | A bridge posts to `/ingest/flood` (already there). |
| Real recycling machines | Each device gets its key at set-up (held in a key store, not the database) and posts to `/ingest/kitar/*` (already there). |
| Vision models (machine, CCTV, bill photos) | Replace the simulator buttons and test pictures; the agreement rules and the 60% confidence floor stay. |
| Virus scanning | Replace the EICAR stand-in in `files/gate.ts` with a real scanner (for example ClamAV). |
| Bank transfers | `runSettlement` gains a payout step and a "paid" confirmation. |
| Object storage | `uploads` moves to R2/S3. |

## SimeTown Assistant

An agent on the server (`src/server/modules/assistant/`), answering one question per request (`POST /assistant/ask`):

1. **Context.** The last 20 messages of the conversation, and a system prompt that fixes the scope (the township, City of Elmina, Sime Darby Property, local services, the resident's own data) and the rules: answer only from tool results, never invent prices, schedules or contacts, 999 first in any danger, never change a flood alert, treat tool results as data, not instructions.
2. **Tools** (`tools.ts`). Read tools look things up as the signed-in resident through the same service functions as the app's screens (flood status, points, shop offers, recycling places, visitor passes, garden plot) and `search_elmina_info` over the checked knowledge (`knowledge.ts`: each entry with its sources and the date they were checked). Action tools (`create_visitor_pass`, `hand_over_to_staff`) only record a proposal in `assistant_actions`.
3. **Loop** (`agent.ts`). Model, tools, model, at most 5 turns, one action per answer. The wire formats for OpenAI Chat Completions and Anthropic Messages are in `src/server/ai/chat.ts`.
4. **Human in the loop.** A proposal runs only when the resident taps Yes (`POST /assistant/actions/:id/confirm`), with their own permissions and the feature's usual checks; it expires after 15 minutes. Before that the resident can change its details on the card (`POST /assistant/actions/:id/edit`: the pass's day, time, length, kind and plate, or the question's wording), checked by the same rules, and a newer proposal in the conversation replaces any older one still open. The rules read pass details in English and Malay (`pass-request.ts`). A visitor pass's share link is returned once and never stored in the chat.
5. **Handover.** A question sent to the township office (`assistant_handoffs`) appears under *Assistant questions* in the console; the answer goes back into the resident's chat with a notification. Staff see that question only, not the conversation.
6. **Fallback.** With no AI provider, past the daily limit (`AI_ASSISTANT_DAILY_LIMIT`, default 100 a day per resident) or when the AI fails, `rules.ts` answers from the same tools and knowledge, matching whole words; anything it cannot answer is offered to the township office.
7. **Records.** Each answer keeps its sources, any proposal, and how it was made (`meta`: AI or rules, tools used, tokens, time), which is logged but never shown to the resident.

## SimeTown Home Services

Residents book a township service company; the company assigns one of its registered workers; the
resident confirms the job and can review it or report a problem privately. Migration
`014_home_services.sql`, module `src/server/modules/home-services`.

- **No new role.** A company is a `MERCHANT` account. `merchants.offers_retail` and
  `merchants.offers_services` say whether it runs a shop, home services, or both (township admins set
  this under *Shops*; a business chooses when it applies). Menus follow the flags, and every service
  route checks `offers_services` on the server; shop sales and offers check `offers_retail`.
- **Workers do not sign in.** `service_workers` holds a name and an optional phone, never an IC.
- **Status model.** `REQUESTED → ACCEPTED (visit time) → SCHEDULED (worker) → IN_PROGRESS → WORK_DONE →
  COMPLETED`, or `DECLINED` / `CANCELLED`. Only the resident can complete a booking, from
  `IN_PROGRESS` or `WORK_DONE`. Every change of status, worker or gate pass is a row in
  `service_booking_events` with who made it and when, and the worker's name as it was.
- **Privacy.** The company sees a short name and the problem until it accepts; the address and phone
  only while a visit is arranged. Reviews need a completed booking (one each). `service_reports` are
  visible to the resident and township staff only, and keep the worker assigned at the time.
- **Tamu.** The resident can send the assigned worker a `CONTRACTOR` pass for the visit window; the
  company sees the code. Changing the worker or cancelling the booking cancels the pass.
- **Home logbook.** Read from completed bookings for the home (no table of its own), so it belongs to
  the home and is shared by everyone registered there; only the booker sees their own problem text and
  rating. `SERVICE_REMINDER_DAYS` sets services that come round again (air-conditioning, 180 days).
- **No ledger, no points.** Nothing here moves money or awards points or XP.

## Smart lockers and the courier platform

Two modules, one database, no extra services:

```
 Courier app ──scan──► carriers/verification ──► carriers/providers ──► courier company system
      │                     │   (barcode.ts, matching.ts)       │      (SIMULATED table, or the
      │                     ▼                                   │       signed GATEWAY contract)
      │            courier_shipments (one row per shipment, for ever) + courier_scans (every scan)
      ▼
 lockers/delivery ──► lockers/hardware ──► station adapter ──► controller (simulated, or a gateway)
      │                    signed, expiring, single-use unlock authorisation
      ▼
 lockers/collection ── PIN / QR for the household ── lockers/overflow ── the guardhouse (with parcels/service: parcels left with the guard)
```

- **One private door per home** (`lockers/delivery.ts → homeDoor`, migration 034): every home has
  its own door, size M or larger, in the locker bank whose `locker_stations.precincts` include the
  home's precinct (a bank with no precincts serves every home). A home claims the smallest free door
  that fits with its first parcel (`locker_compartments.home_id`, unique; the row is locked with
  `SKIP LOCKED`), keeps it while it lives there, and an admin frees it when it moves out
  (`admin.ts → releaseDoor`). A door holds one parcel at a time, so every deposit and collection is
  still proved by the door and presence sensors. When the door cannot take a parcel (too big,
  already holding one, out of use, at another bank, no free door), `reserveAndOpen` returns
  `NO_DOOR` with the reason and the guardhouse; the courier can also report a reason
  themselves (`reportDeliveryProblem`). There is no shared or spare storage.
- **The guardhouse** (`overflow_locations`, one per guardhouse; the demo has *Main guardhouse*)
  keeps opening hours (`open_from_hour`, `open_to_hour`, township time) and room for at least 100
  parcels. Couriers bring parcels only while it is open; the guard receives them
  (`receiveAtCounter`) and the household is told why. Nothing is ever moved out of a door, so the
  old "move to storage" workflow is gone: migration 034 cancelled its open tasks and put any parcel
  still in a door back to *Ready to collect*.
- **Waiting** (`overflow.ts → runExpiry`, the `lockers` job every few minutes): a door parcel gets a
  gentle reminder after `door_reminder_hours` (48), then weekly (`last_reminder_at`). A counter
  parcel becomes overdue at `overflow_collect_days` (7, `overdue_at`), is reminded weekly, and at
  `counter_call_after_days` (14, `call_requested_at`) guards and staff are asked to call; a note
  (`locker_parcel_notes`) closes the call. Guardhouse parcels are never returned automatically, and no
  fees are charged (`saveTownshipPolicy` keeps fees and extensions off).
- **One guardhouse, one set of rules** (migration 036): parcels a courier leaves with the guard
  (`parcels`) follow the same timings (`parcels/service.ts → runShelfRules`, run by the
  `parcel-reminders` and `lockers` jobs) and keep their history in `guard_parcel_events`. The
  **guardhouse register** (`parcels/guardhouse.ts`) is one query over both sources (a `UNION ALL`
  with the last action of each), filtered, sorted and paged in the database, with an overview and each
  parcel's history; `checkGuardhouseCode` takes either kind of code. Sending back always needs a reason.
- **Email** (`src/server/modules/email/`, migration 035): the four parcel emails are queued with
  their notifications in `email_outbox` and sent by the `lockers` job through nodemailer, only when
  `SMTP_*` is set; see [EMAIL_DESIGN.md](EMAIL_DESIGN.md).
- **Planned, not built**: door alerts that open the door's record; a one-tap "Called: no answer"
  for guards; a monthly late-collection report for HQ; a late-collection storage charge. Admins see
  them as *Planned · not active* under *Manage → Locker policy*.
- **Who sees it**: residents on *Parcels* (*Parcel lockers*: their own door; *Guardhouse*: whether
  it is open now, everything waiting there with days uncollected, *My late collections*; *About*);
  guards on *Parcels* and staff and admins on *Parcels → Guardhouse*, through the same components
  (`components/features/guardhouse-register.tsx`); *Today* lists what needs action; *Performance*
  covers every bank and the guardhouse; admins set doors, guardhouses and reminder timings under
  *Manage*. Parcel, locker and courier cases are worked in *Lapor → Parcel & locker cases*.

- **Who may deliver** (`lockers/couriers.ts → requireCourierAt`): an active courier of a company
  approved in the station's township (`courier_company_townships`), within its agreement, at a
  station granted to the company (`courier_company_stations`), or, for couriers approved one by
  one, to them (`courier_station_access`). Company managers (`carriers/team.ts`) and the company's
  own sign-in (`carriers/federation.ts`, OpenID Connect with PKCE) create and suspend couriers; the
  township approves companies (`carriers/companies.ts`).
- **What a scan is worth** (`carriers/verification.ts`): the tracking number only. The provider
  adapter (`carriers/providers.ts`) is the only place that knows a company; everything else uses the
  normalised `ProviderShipment`. Outcomes: `VERIFIED`, `NOT_FOUND`, `UNVERIFIED`,
  `PROVIDER_UNAVAILABLE`, `RECIPIENT_MISMATCH`, `NOT_ELIGIBLE`, `ALREADY_DEPOSITED`, each with a
  reason, and an assurance level (`HIGH` when the company confirms the courier, `MEDIUM` when it
  confirms the shipment only, `LOW` for the delivery-code fallback).
- **One delivery per shipment**, enforced three times: the shipment row is locked while a parcel is
  created; `deposited_at` is set once on deposit and never cleared; and a unique index allows one
  parcel per shipment that is not a failed delivery.
- **The delivery stages** a courier company would recognise map onto the parcel's own states
  (`src/shared/lockers.ts`, which the server enforces):

  | Stage | Parcel states |
  | --- | --- |
  | EXPECTED | `REGISTERED`, `VERIFIED` |
  | RESERVED | `LOCKER_RESERVED` |
  | DEPOSITING | `DEPOSIT_IN_PROGRESS` |
  | DEPOSITED | `DEPOSITED`, `READY_FOR_COLLECTION`, `RELOCATED_TO_STORAGE` (at the guardhouse), `COLLECTION_IN_PROGRESS`, `RETURN_PENDING` (`OVERDUE` and `RELOCATION_*` appear only on records from before private doors) |
  | COLLECTED | `COLLECTED` |
  | CANCELLED | `DELIVERY_FAILED`, `RETURNED` |
  | EXCEPTION | `EXCEPTION` |

  A finished parcel never goes back to an earlier state; a correction is a staff exception
  (`lockers/exceptions.ts`), approved by a second admin, with the parcel held by staff.
- **Incidents** are raised where the system notices something (replayed labels, a second courier,
  suspended couriers, forced or open doors, refused commands, keypad lockouts, many sign-in places,
  provider outages) and by staff and households. `lockers/incidents.ts` now hands them to the
  township's central incident system (below). They inform people; they never change a parcel. The
  risks they watch are in [RISK_REGISTER.md](RISK_REGISTER.md).
- **Simulated parts** (`carriers/simulated.ts`, `carriers/sim-idp.ts`, the locker simulator) use the
  same interfaces as real ones, are labelled wherever they appear, and refuse to run in production.

## Incidents and reports

One engine (`src/server/modules/incidents`) for every township case: lockers, guardhouse parcels,
the gate and the courier platform. Lapor's community reports keep their own queue and are listed,
read-only, on the same dashboard.

Cases are worked in one place, `/console/incidents`. The *Smart lockers* and *Parcels* pages show a
`CaseSummary` (open, overdue, critical, untaken) whose link opens the board already filtered
(`?area=PARCELS`, `?area=LOCKERS,COURIERS`, `?disputed=1`); *Smart lockers → Today* lists the urgent
ones and opens each by reference (`?ref=INC-000123`), as notifications do.

```
 report button ──► incidents/triage ──┬─ courier problem ──► courier_referrals + the company's verified
 (parcel, gate,     (reason → who is  │                      support channel (no case, no staff alert)
  courier station)   responsible)     ├─ not sure which courier ──► the resident chooses; never guessed
                                      ├─ collection dispute ──► the records first (who opened the door)
                                      └─ township or mixed ──► incidents/engine.createIncident
 system signals ──► raiseSystemIncident ──────────────────────────────────┘
                                                   │
 incidents ── incident_events (append-only, hash-chained) ── incident_escalations (once per key)
     ▲                                             │
 incidents/checks (the `incidents` job, every 5 min): unassigned / overdue → escalate; resolved → close
```

- **Statuses** (`src/shared/incidents.ts`, enforced by the engine): `OPEN → ASSIGNED →
  INVESTIGATING ⇄ AWAITING_EXTERNAL_PARTY → RESOLVED → CLOSED`, with `RESOLVED → REOPENED` while
  the resident may still dispute the outcome. Any other move is refused.
- **One owner**: taking a case is one conditional `UPDATE … WHERE owner_id IS NULL`, so of two staff
  only one succeeds. Moving a case someone already holds is for admins and needs a reason.
- **Deadlines** come from `incident_policies` (per township, per priority, optionally in working
  time with working days and holidays in the township's time zone) and are fixed when the case is
  opened or reopened. Escalation is keyed (`UNASSIGNED`, `OVERDUE`, `CRITICAL`, `DISPUTED`,
  `REQUESTED`, per reopening round), so running the job twice changes nothing.
- **Two kinds of note**: internal notes for staff, and updates the resident sees. The resident's
  pages read only events marked visible.
- **Resolving records an outcome**; it never opens a door, issues a code or changes a parcel.
- **Courier support** is shown only when an admin has recorded and checked it
  (`courier_companies.support_verified_at`). Filing a ticket for the resident uses an adapter
  (`incidents/courier-support.ts`); only the simulated one exists, for simulated companies.
