# SimeTown Township Super-App

One web app for township life: residents recycle, move, report, share and shop locally; shops give
and accept points; sponsors fund challenges; Sime Darby Property (SDP) sees what the township
achieves. Built from the proposal **"SimeTown Township Super-App"** for the Sime Darby Property
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
| Resident (main demo) | `aisyah@demo.kita.test` | Today card, Points & XP (cash- and offer-backed), Kitar with the smart machine, Gerak map tracking, Tamu, Lapor, Jiran, Kongsi, Jimat bill reading, Banjir, Taman, Akses+, Assistant, SimeTown Home (book a plumber, see who is coming, review) |
| Resident in Simple Mode | `zainab@demo.kita.test` | Simple Mode's four big buttons; on the flood priority help list; Mei Ling is her carer |
| Resident with a visitor waiting | `daniel@demo.kita.test` | A walk-in at the main gate waiting for his answer in Tamu |
| Shop | `kafe@demo.kita.test`, `kedai@demo.kita.test` | Counter with Shop Offers, offers page, sales, weekly statements |
| Home service company | `plumber@demo.kita.test`, `aircon@demo.kita.test` | Booking inbox, accept with a visit time, assign a registered worker, services and workers |
| Shop and home services | `kemas@demo.kita.test` | Both menus on one business account: the counter and offers, and bookings |
| Guard | `guard@demo.kita.test` | The main gate: scan passes, walk-ins, SOS calls, patrol round, flood tasks; parcel shelf and the locker parcel counter |
| Courier | `courier@demo.kita.test` | Faizal, J&T Express (simulated): managed by J&T, delivers to the smart lockers. Also `hairul@` (J&T) and `nurul@` (Ninja Van) |
| Courier (suspended) | `courier2@demo.kita.test` | Ahmad Zaki: suspended by Ninja Van, so he cannot deliver |
| Courier company manager | `jnt-manager@demo.kita.test` | Kavitha, J&T Express: adds, suspends and reconfirms J&T's couriers (`ninjavan-manager@` for Ninja Van) |
| Courier (company sign-in) | staff number `SPX-3001` | Lim Wei Jie, Shopee Express: *Sign in with your courier company* on the sign-in page (simulated); `SPX-3002` is suspended by Shopee |
| Shop, not yet approved | `bengkel@demo.kita.test` | The "waiting for approval" state |
| Sponsor | `sponsor@demo.kita.test` | Its Green Champion tier, own campaigns and grouped results |
| Township staff | `staff@demo.kita.test` | Insights, report queue, home service reports, the flood agent, kiosks, smart machines, gardens and patrol points, nature and access |
| Township staff (second) | `staff2@demo.kita.test` | Mei Chen: a second person in the township office, so a case can be moved from Ravi to her |
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
2. **Gerak.** Scan both checkpoints of *Elmina Central Park Walk* on the same day to complete it.
3. **SimeTown Merchant.** As the café, enter Aisyah's member code (her wallet → *Show my code*) and a
   RM20 bill: she earns 20 points. As the grocer, enter RM20 and switch on *Customer wants to use
   points* → 300. Aisyah's phone asks her to confirm; the grocer's screen updates by itself and its
   statement shows RM3 due this week.
4. **Lapor.** Report a broken street light with a photo. It is sorted as "Lighting, medium urgency";
   staff see it in their queue and can correct the suggestion (the correction is logged).
5. **Jiran and Kongsi.** Join the gotong-royong; give away an item and confirm the handover.
6. **Jimat.** Enter this month's electricity and water readings and see the change from last month.
7. **Banjir.** As staff, open *Flood sensors* and drag Elmina Valley 1 & 2 past 90%. Within 15 seconds
   a danger warning takes over Aisyah's screen with the safe route.
8. **SimeTown Insights.** The SDP dashboard has changed all day, with the float matched to the sen.

### The third edition's features

9. **Smart recycling machine.** As staff, open *Kiosks, machines & trails* → *Smart machines* →
   *Open the machine screen* (a tablet in a real demo). Scan its QR code with Aisyah's phone, or
   type her member code under "Camera: read a SimeTown QR". Drop items with the sensor buttons, try
   "Camera sees a different material", then *Finish*. Aisyah's Kitar screen follows item by item;
   the session earns XP and offer-backed points. *Recycle as guest* gives a claim code instead.
10. **Shop Offers.** As the grocer, the counter now has *Customer wants to use your Shop Offer*
    (RM2 off, all day). Aisyah confirms on her phone, pays RM18 of a RM20 bill, and the shop's
    statement shows the 10% success fee. *Shop Offers* in the shop's menu sets terms and budgets.
11. **Gerak map tracking.** In *Gerak*, switch on *Test mode: play back a route instead of GPS* and tap *Start*: the
    trip follows the Elmina Central Park Walk on the map, checkpoints tick themselves, then *Finish*. On a phone
    outdoors, leave the demo switch off and real GPS is used.
12. **Jimat bill reading.** In *Jimat* → *Read a bill*, download *Sample bill*, then upload it:
    every step of the file-safety gate is shown, the numbers are read from the PDF, you confirm,
    and the file is never stored.
13. **Tamu.** As Aisyah, create a pass and share it (WhatsApp, SMS or link). Open the link in a
    private window: that is the visitor's view. As the guard, type or scan the code: Aisyah is told
    her visitor arrived. As Daniel, answer the walk-in waiting at the gate.
14. **Banjir agent.** As staff, open *Flood agent*. Move a zone's sensor past 75%: only one signal,
    so a draft waits for the officer. Click a CCTV test picture near the warning line: two signals
    agree and the warning goes out. Push the sensor past 90%: a danger draft starts a 3-minute
    countdown. Residents check in "I'm safe"; the priority help list appears for duty staff.
    The public page is at `/status`.
15. **Akses+, Taman, Assistant, SimeTown Home, Bahasa Malaysia.** Sign in as Zainab for Simple Mode.
    Taman puts residents on a garden's waiting list (staff run the ballot under *Kiosks, machines & trails*) and
    logs wildlife (staff confirm under *Nature & access*). Ask the Assistant “What homes is Sime Darby
    selling in Elmina?” or “Make a visitor pass for Ali tomorrow”, then answer the question it hands over
    under *Assistant questions* as staff. The *EN/BM* switch in the top bar changes the language.
16. **SimeTown Home: book a home service.** As Aisyah, open *SimeTown Home*, choose *Plumbing*, compare
    the companies (ratings and call-out fees are shown first) and book Elmina Plumbing Co. with a photo.
    As `plumber@`, open *Bookings*: the resident's address appears only after you accept. Accept with a
    time and assign Ahmad. As Aisyah, see Ahmad named before the visit and send him a Tamu gate pass
    (the company sees the code). As the plumber, mark the worker arrived and the work done; as Aisyah,
    confirm and review, or report a problem privately. As staff, open *Home service reports*: the report
    names the worker assigned at the time, with the booking's full history. The company never sees it.
    Aisyah's *Home logbook* shows her air-conditioner service as due soon: *Book again* rebooks the same company.

### The hackathon brief's PEOPLE and PLANET problems

16. **One reporting channel.** As Aisyah, open *My requests*: every report, parcel and collection
    in one list, with where it stands. In *Lapor*, start a report about a blocked drain
    behind Jalan Metafasa: the open report appears under *Already reported?*; tap *Me too* instead of
    filing a second one. As staff, *Reports* shows the duplicates avoided, reports past their target
    date and the median time to fix; set who is fixing a report and by when, and add a photo of the fix.
17. **Secure parcel collection.** As the guard, open *Parcels*, log a parcel for No. 1 Jalan Metafasa
    U16/171 with a shelf and a photo. Aisyah's *Parcels* screen shows the one-time code (and its QR).
    Scan or type it at the guard's screen, check the photo, hand it over: the code stops working.
    *Not me?* queries a handover; staff see the time to collect and the queried handovers.
18. **Recycling guide and collections.** In *Kitar*, type “minyak” or “pizza box” under *Can I recycle
    this?*, then *Book a collection* with a partner collector. Staff confirm it under *Recycling
    collections* (the collector's gate pass is made automatically) and record the weight.
19. **Solar sites, greener materials, the edging trial.** As staff, *Solar sites* ranks rooftops and car
    parks and flags missing checks; *Greener materials* compares materials for one use (sample library),
    asks the agent to explain, saves a timed shortlist, and follows the recycled-plastic edging trial.

### Smart parcel lockers

20. **Deliver.** As the courier, open *Deliver*, choose *Elmina Valley Locker A*, type a tracking
    number, pick a size and give Aisyah's delivery code (her wallet → *Show my code*). The smallest
    free door opens; tap *Shut the door with the parcel inside* (a simulated station). Aisyah is told.
21. **Collect.** As Aisyah, *Parcels* shows the QR code, the PIN and the time left. Type the PIN on
    the station's keypad in the console's simulator, or enter the station code in the app and tap
    *Open my door*, then *Take it and shut the door*.
22. **Overdue and relocation.** As staff, *Smart lockers → Relocations* has Priya's overdue parcel.
    Start it (choose the township office counter), scan its tracking number, shut the empty door and
    complete it: her code changes and she is told where to go. Hand it over under *Counter* after
    checking the code and ID. *Parcels* shows every state change and the custody chain.
23. **Full station and hardware faults.** In the simulator, jam a door or take the station offline,
    then try a delivery: nothing is confirmed and the courier is told what to do. The *Overview*,
    *Forecast* and *Policy* tabs show capacity, tomorrow's demand and the deadlines.

### The courier platform (simulated courier companies)

J&T Express, Ninja Van and Shopee Express here are **simulated**: SimeTown is not connected to any
courier company, and every tracking number (`JTSIM…`, `NVSIM…`, `SPXSIM…`) is fictional. Open
`/demo/labels` on a computer to see the labels (scannable with a phone's camera, or type the number).

24. **Barcode first.** As Faizal (`courier@`), *Deliver* → *Elmina Valley Locker A*, scan or type
    `JTSIM10000001`. J&T (simulated) confirms the shipment and that Faizal carries it (high
    assurance); SimeTown matches Aisyah by phone, name and address and shows her details masked. No
    delivery code is needed and no township admin approved Faizal: J&T's manager added him. *Open a
    locker*, shut the door with the parcel inside; Aisyah is told and collects with her PIN as in step 21.
25. **Replays and copied labels.** Scan `JTSIM10000001` again: *Already delivered*, no door opens,
    the attempt is logged and staff see an incident. `JTSIM10000009` is already in a locker (same
    result). `JTSIM10000008` is carried by another courier: refused, a high-severity incident.
    `JTSIM99999999` is unknown to J&T, `JTSIM10000004` is being delivered by Hairul,
    `JTSIM10000005` names someone who does not live at the address, `JTSIM10000006` goes to an
    unregistered home, and `JTSIM10000007` needs a signature: each is refused for its own reason.
26. **Medium assurance, outage and fallback.** As Nurul (`nurul@`), `NVSIM20000001` is verified for
    Daniel by address and name; Ninja Van cannot say who carries it (medium assurance). As admin,
    *Couriers & companies* → Ninja Van → *Simulate an outage*; Nurul scans `NVSIM20000003`, and may
    use Mei Ling's delivery code instead (recorded as low assurance).
27. **The company manages its couriers.** As Kavitha (`jnt-manager@`), *Team*: add a courier with a
    staff number (they get a set-password link), suspend Hairul (his session ends at once), reconfirm
    Faizal. As Ahmad (`courier2@`), *Deliver* says Ninja Van has suspended him.
28. **Signing in through the company.** Signed out, choose *Shopee Express (simulated sign-in)* on
    the sign-in page, pick Lim Wei Jie (`SPX-3001`) and the demo password: SimeTown checks the
    company's signed token and creates his courier account on first sign-in. `SPX-3002` is refused
    by the company itself. `SPXSIM30000001` is matched by the delivery code Zainab gave the shop.
29. **Staff.** As admin: *Couriers & companies* (approve, suspend, stations, agreement, assurance,
    representatives, access history), *Shipment checks* (every scan and its outcome, repeated scans,
    each company's system health, and the simulated companies' shipments and staff to change), and
    *Cases* (how many locker and courier cases are open, with a link to them in *Incidents & reports*;
    reporting a locker problem; opening an occupied door, asked under *Parcels* and approved by a
    second admin, `admin2@`). In the simulator, *Replay a used command* is refused.


### Incidents and reports

Every parcel, the gate page and the courier station have a *Report* button. SimeTown decides who
should handle the problem: the courier company, or the township office. Township cases go to
*Incidents & reports* (`/console/incidents`), the one place they are worked: each has one person
handling it and a deadline, and the system escalates what nobody takes or what runs late. The
*Smart lockers* and *Parcels* pages only show how many are open, with a link that opens the board
already filtered. Residents follow their
reports under *Parcels → My reports*. The courier companies' support channels are simulated.

30. **A. A late parcel belongs to the courier.** As Aisyah, *Parcels* → *A parcel hasn't arrived?*,
    choose *My parcel is late* and enter `JTSIM10000002`. J&T (simulated) confirms it is hers and on
    its way, so SimeTown shows J&T's support channel and the tracking number to copy. No township
    case is opened and no staff member is told. (*Send it to J&T for me* files a simulated ticket.)
31. **B. A locker door will not open.** As Aisyah, on a parcel waiting in a locker, *Report a
    problem* → *The door will not open*. It becomes a township case at once, with the locker's
    door history attached. Staff work it under *Incidents & reports*; *Smart lockers → Today* lists
    it as urgent and *Smart lockers → Cases* counts it, both linking there.
32. **C. A critical case escalates.** As admin (Nurul Huda, `admin@`), *Incidents & reports*: the
    door forced open at Locker A 25 minutes ago is critical, nobody has taken it, and the admins have
    already been told. Running the checks again (*Deadlines* → *Run the deadline checks now*) does
    not tell them twice.
33. **D. "I didn't collect this."** As Aisyah, on a collected locker parcel, *Report* → *I didn’t
    collect this*. SimeTown first shows what its records say (how the door was opened); *Please
    investigate* opens a case. An earlier dispute of hers is already resolved under *My reports*,
    with the outcome and *Not fixed? Reopen it*.
34. **E. Moving a case.** Daniel's locker door would not open; Ravi (`staff@`) took it and is
    investigating. As admin, open it and *Reassign* → Mei Chen, with a reason. The history keeps
    both, and Mei Chen is told. A new case shows *I’ll handle this*; if two staff press it at once,
    only one gets the case.

---

## 3. What is in the box

| Layer | Feature | Working here |
| --- | --- | --- |
| Core | SimeTown ID | Register against a unit, staff or owner confirms the home, seven roles (with Guard), invitations, guest pages (`/guest`, `/status`, `/partners`), English and Bahasa Malaysia (partial) |
| Core | Points & XP | One balance with two kinds of backing (cash in the float; shops' monthly pledges), "You saved", every amount in ringgit, history, levels, badges, street league, confirm-on-phone |
| Core | Today card | Changes through the day: flood level, a visitor at the gate or expected, a shop offer nearby, collection day |
| Core | SimeTown Assistant | An AI agent (OpenAI or Anthropic) that answers from the resident's own data and checked facts about City of Elmina, with sources; makes a visitor pass or hands a question to the township office only after the resident confirms; never decides an alert. Without an AI key, fixed rules answer from the same tools |
| People | Tamu | Visitor passes by link (no app for the visitor), guard screen with camera scan, walk-ins with Expected / Not expected / Call me, SOS, patrol rounds, flood task list, 90-day deletion |
| People | Akses+ | Private access needs with consent, Simple Mode, read-aloud, flashing alerts, carer links, step-free places, priority help list for floods |
| People | Jiran | Events with places, help board, XP when the organiser or asker confirms |
| People | Lapor | Report with photo, suggested type and urgency, staff queue, access-barrier type; live progress (checked, assigned with a target date, fixed with a photo), late flags, “Me too” instead of duplicate reports, time-to-fix figures |
| People | My requests | One list of everything a household is waiting on: reports, parcels and collections, each with its next step; the Assistant can read it |
| People | Parcels | Guard logs parcels with shelf and photo; the household gets a one-time code (and QR) the guard never sees; handover only against the code; “Not me?” queries; reminders after three days; 90-day deletion |
| People | Courier platform | Courier companies approved once per township; their own managers or their own sign-in (OpenID Connect) add and suspend couriers; the label's barcode checked with the (simulated) company; households matched automatically and shown masked; a shipment deposited once, ever; signed, expiring, single-use unlocks; incidents, staff exceptions with a second approver, a risk register |
| People | Smart lockers | Multi-courier delivery with approval per station, recipient verification without revealing residents, smallest-fitting door allocated atomically, one-time pickup PIN or QR (never stored), reminders outside quiet hours, staffed relocation with a custody chain, overflow counters, live capacity, a plain forecast, an interactive simulator and a signed hardware gateway contract |
| People | Gerak | Live map tracking with checkpoints that tick themselves, speed bands, near-home trimming, 30-day route deletion; QR checkpoints as the backup; demo playback |
| Planet | Kitar | Smart machine: rotating screen code, SimeTown QR or guest, camera + barcode + weight agreement, signed records, guest claim codes; kiosk drop-off with a photo check as the backup; “Can I recycle this?” guide in English and Malay; collections booked with partner collectors, with the gate pass made on confirmation; material accepted by month and why machines turned items away |
| Planet | Kongsi | Give away and lend, XP on confirmed handover |
| Planet | Jimat | Bill reading behind a file-safety gate (PDF text, or the AI service for photos), confirm with unsure fields marked, same bill only once, file never stored; typed readings, tips, leak alert, solar request |
| Planet | Banjir | The agent: sensor, CCTV test pictures, rain gauge and resident reports; two signals must agree; one-signal drafts with 3- and 5-minute windows; 15-minute updates; four-line messages; check-ins; public status page |
| Planet | Taman | Garden plots by ballot from a waiting list (one per home), watering roster with the garden code (Impact XP only), wildlife log confirmed by staff, share the harvest in Kongsi |
| Planet | Solar sites | Rooftops and car parks ranked by estimated output, demand nearby from Jimat bills (per area only) and readiness; missing checks flagged; agreement with an expert's ranking |
| Planet | Greener materials | Materials for one use checked against its requirements, missing environmental evidence flagged, an agent that explains only from the table, timed shortlists; the recycled-plastic edging trial's test plan and results |
| Business | SimeTown Merchant | Shop Offers with the shop's own terms and monthly cap, 10% success fee, new and returning customers, Akses-friendly badge; give and accept points, refunds, weekly statement |
| Business | SimeTown Partner Hub | Four sponsor tiers with a public Partners page and one labelled banner; campaigns with a prefunded pool and grouped results |
| Business | SimeTown Insights | 30-day totals, the float against what it owes, machine uptime, offer pledges, visitors, flood alerts, barriers fixed on time, nature; printable monthly report |
| Business | SimeTown Home | Home services: residents compare approved township companies (ratings, pricing and call-out fees up front), book with a photo, see the assigned worker before arrival, send a Tamu contractor pass, confirm the job and review it, or report privately to staff. Companies are Merchant accounts with services switched on (shop, services, or both). Prices are agreed in person; SimeTown takes no payment. The home logbook records every confirmed job at the home and reminds when a service (air-conditioning, every 180 days) is due, with *Book again*. Warranty records and resale are still previews |

Also built because a real system needs them: moderation of flagged posts, the daily float check,
weekly settlement, points expiry and reminders, two-person approval for balance corrections, an
audit trail, adjustable programme rules, data download and account deletion.

**Shown as a preview, and labelled so:** SimeTown Home warranty and defect records, resale and rental, and new launches.

**Simulated, and labelled so in the app:** no real money moves (deposits and settlements are
ledger entries an admin records); the recycling machine is a tablet page whose buttons stand in for
its camera, barcode reader and scale (its signed records and their checks are real); flood sensors,
CCTV and the rain gauge are a simulator and a fixed test set of pictures; Gerak can play back a
route instead of GPS outside production; the sample bill is generated by the app; car park occupancy
is simulated until bay sensors exist; the materials library holds sample values to be replaced with
supplier datasheets; smart lockers run on the built-in simulator until real hardware is connected
through the gateway contract (no locker vendor's API is built in); WhatsApp and SMS
open the phone's own apps; there is no e-mail or one-time code. Bahasa Malaysia covers navigation,
the home screen, Simple Mode, Tamu and flood alerts.

**Adding the third edition to an existing demo database:** `npm run db:migrate` then
`npm run db:seed`. On a database that already holds the demo township, the seed only adds what the
new features need (the guard, offers, machines, gardens, map, tiers…) and changes nothing else.

---

## 4. Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | All 222 tests, on in-process PostgreSQL |
| `TEST_DATABASE_URL=postgres://… npm test` | The same tests on a real server (this **empties that database**) |
| `npm run lint` / `npm run typecheck` / `npm run check` | Code checks (`check` runs lint, types and tests) |
| `npm run db:migrate` | Apply new migrations |
| `npm run db:seed` | Load the demo township (refuses when `APP_ENV=production`) |
| `npm run bootstrap -- <file.json>` | Set up a real township: zones, homes and the first admin's invitation link (see `docs/bootstrap.example.json`) |
| `npm run job -- <name>` | Run `expire-points`, `float-check`, `settle`, `cleanup` or `flood-agent` once (`flood-agent` every minute or two in a pilot; `cleanup` also applies the 90-day and 30-day deletions) |
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

Third edition (October 2026):

- 123 automated tests pass on in-process PostgreSQL, including 34 new tests for Shop Offers, the
  recycling machine's signatures, Gerak tracking, the bill file gate, Tamu, the Banjir agent,
  Akses+, Taman and sponsor tiers.
- Migration `004_third_edition.sql` and the seed were rehearsed on a copy of the previous database
  and on an empty one (the seed was run twice to prove it changes nothing the second time), then
  applied to the shared Supabase database; the float check passed afterwards.
- A production build was run and every new endpoint and screen was exercised end to end against
  it, with screenshots of each screen taken in headless Chrome and no browser errors.
- Not checked for the third edition: the accessibility scan, real GPS outdoors, a real camera or
  barcode reader on the guard screen, and the AI bill reader for photos.

Not checked:

- The Docker image itself and `docker compose` were not built (no Docker daemon was available).
- Nothing was deployed. The Cloudflare set-up in the deployment guide is a design, not a tested one.
- The hosted AI call was not made (no key). Its request and fallback logic is written and the
  fallback paths are tested; the live call is not.
- No load test, no penetration test, no browsers other than Chromium, no real phones.
- The rates (1 point per RM1, 15% fee, limits) are the proposal's **assumptions**, not validated figures.
