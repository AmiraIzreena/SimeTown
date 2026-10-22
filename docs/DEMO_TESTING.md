# Testing SimeTown with demo data

Every page has sample data, for every kind of account. This guide lists the accounts and what to try with each.

## Set up

```powershell
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

- `db:seed` only **adds** what is missing, so it is safe to run again. It refuses to run when `APP_ENV=production`.
- All demo accounts use one password: the `SEED_DEMO_PASSWORD` value in your `.env`.
- Sign in at <http://localhost:3000/login>. Each email ends in `@demo.kita.test`.
- Switch language with **EN / BM** in the top bar. Every screen should read fully in Malay.

## Accounts

| Role | Sign in as | Who it is |
|---|---|---|
| Resident (main) | `aisyah` | No. 1, Jalan Metafasa, Elmina Valley 1 |
| Resident | `daniel` | A neighbour |
| Resident (not yet confirmed) | `grace` | Waiting for the township office to confirm her home |
| Shop | `kafe`, `kedai` | Kafe Seri Pagi, Kedai Runcit Mesra |
| Shop (not yet approved) | `bengkel` | Bengkel Basikal Roda |
| Home services | `plumber`, `aircon` | Elmina Plumbing Co., Sejuk Aircon Services |
| Shop and home services | `kemas` | Kemas Home Care |
| Guard | `guard` | The main gate |
| Courier | `courier`, `hairul`, `nurul` | J&T Express and Ninja Van (simulated) |
| Courier (suspended) | `courier2` | Cannot deliver |
| Courier company manager | `jnt-manager`, `ninjavan-manager` | Manage their own couriers |
| Sponsor | `sponsor` | Solar Cerah |
| Township staff | `staff`, `staff2` | Take and investigate cases |
| Township admin | `admin`, `admin2` | Approve, settle, configure |
| SDP HQ admin | `hq` | All townships |

## Resident (`aisyah`, then `daniel`)

| Page | What to try |
|---|---|
| **Home** | Points card, tiles and shortcuts. |
| **Points & XP** | Balance, history, level. |
| **Kitar** | Your recycled weight and material ring, the map, the guide. **Report a problem**: choose a reason, add a note and a screenshot, send, then **Follow it in Lapor**. |
| **Gerak** | Your loops, distance and the map. **Report a problem** works the same way. |
| **Lapor → Community reports** | Only your own reports: Ongoing / Finished, type chips, search. Each shows *“2 of 5 residents”* or *“Neighbours can see this”*; open one for the explanation. **New report** files one with a photo. Try junk (“asdfgh”) or a rude word: it is refused with a polite message. Write about a problem already reported (for example *“Street lights out on Jalan Frekuensi U16/115”*): after **Send report** you are asked **Yes, add my report** or **No, it is different**. |
| **Lapor → Reports around the township** | The card at the top of Community reports. Only problems **5 or more residents** reported or said Me too to, with written English/Malay titles (no names, words or photos). The figures count up in the hero; problems are grouped by type, with **See all** where a type has more than three. Filter by status, type and *All reports / Following*; tap **Me too**, then **Following** to undo. |
| **Lapor → Parcel reports** | A guardhouse handover report (new) and a finished locker report. Filter by type. |
| **Lapor → Gate reports** | A visitor-refused report (new). Daniel has a finished one with an outcome. |
| **Lapor → Kitar reports** | **"Needs your answer"**: the township office asked a question. Open it, see your screenshot, reply. A finished one shows the outcome. |
| **Lapor → Gerak reports** | One being investigated, and one finished that you can **reopen** ("Not fixed? Reopen it"). |
| **Notifications** | A chip for every category: Parcels, Home services, Community, Points & XP, Reports & requests, **Kitar**, **Gerak**, Township alerts, Account. Search, All / Unread, Mark all as read, Previous / Next. |
| **Parcels** | Parcel lockers (your own door, *Guardhouse open / closed* with its hours, PIN, QR, days waiting, *Open my door* with a station code, *My late collections*), Guardhouse (collection code, *Share the code*) and **About** (doors, the counter, reminders, late collections). The **How to collect** guide. *My reports* opens the matching Lapor tab. |
| **Tamu** | Visitor passes; create, renew and cancel one. The SOS button alerts the guard (try it with `guard` signed in elsewhere). |
| **Komuniti** | Posts, offers to help, sharing. |
| **Banjir** | The live flood warning, zones, *See safe route*, check-in. |
| **Akses+**, **Assistant**, **SimeTown Home**, **Account** | Accessible view, questions, home-service categories and bookings, profile and language. |

**Grace** shows what an unconfirmed resident sees, and is useful for the staff verification queue.

## Shops (`kafe`, `kedai`, `bengkel`) and home services (`plumber`, `aircon`, `kemas`)

| Page | What to try |
|---|---|
| **Counter** | Enter Aisyah's member code (shown on her Points & XP page) and a bill. Try *use points* (she confirms on her phone) and the Shop Offer. |
| **Shop Offers** | The live offer and its budget, pause / resume, the Akses-friendly badge. |
| **Sales**, **Statements** | History, refund a sale, weekly statements. |
| **Bengkel** | The *waiting for approval* notice; sales are blocked until approved. |
| **Bookings**, **Services & workers** (`plumber`) | Accept a request with a visit time, assign a worker, mark it done. Add a service or worker. |

## Guard (`guard`)

Gate (scan a visitor pass, log a walk-in and exit), Parcels (hand over with a code), patrol rounds (three scans already recorded). An SOS raised from a resident's Tamu page appears here to answer and close.

## Couriers (`courier`, `jnt-manager`)

Deliver to a locker, history, team. `courier2` shows the suspended state. Managers add and suspend their own couriers.

## Sponsor (`sponsor`)

Campaigns, grouped results, tier and account.

## Township office (`staff`, `admin`, `hq`)

| Page | What to try |
|---|---|
| **Insights** | Hero figures, tiles that open their pages, the monthly impact report. |
| **Lapor** | **Needs attention** (first tab, with a count): problems that reached 5 residents, and anything urgent, urgent first. Open one to see every resident's report and photo, correct the public title, and set the status, team, date and note **for every report at once**. *Community reports*: status pills, update and assign; a *Shared problem* badge marks reports grouped with others. HQ can change the 5 in **Settings → Safety and privacy**. *Gate & community cases*: **Kitar and Gerak reports** (filter by area), with the **resident's screenshot** in the case. Take a case, ask the resident, resolve it. |
| **Parcels** | *Today* (what needs action now), *Guardhouse* (figures, courier drop-offs, one handover for any code, and the **register**: search, filters, each parcel's history, notes, send back on request), *Smart lockers* (parcels, door access), *Performance* (all three locker banks and the guardhouse). *Manage*: doors per home, guardhouses and their hours, reminder timings. Parcel cases: *Lapor → Parcel & locker cases*. |
| **Flood dashboard** | Zones, live map, events, **sensors** (nine simulated). |
| **Campaigns & sponsors** | Needs action / Running / Closed, Sponsors & tiers. |
| **People** | Resident verification (Grace is waiting), staff and partner access. |
| **Shops** (admin), **Float & payments**, **Kiosks, trails & patrol points**, **Recycling**, **Access places**, **Komuniti**, **Home service reports**, **Audit trail** (admin), **Rules** | Each has data to browse and filter. |

`hq` sees the same as an admin, across townships.

## Flows that cross accounts

1. **Kitar report:** `aisyah` reports from Kitar with a screenshot → `staff` sees it in console Lapor, asks a question → `aisyah` replies under *Kitar reports* → `staff` resolves → `aisyah` sees the outcome and can reopen.
2. **Shop sale with points:** `kafe` enters a sale using points → `aisyah` confirms in her wallet → both see it in their history.
3. **Home-service booking:** `aisyah` books from *SimeTown Home* → `plumber` accepts and assigns a worker → `aisyah` confirms the job and reviews it.
4. **Visitor:** `aisyah` creates a Tamu pass → `guard` scans it at the gate.
5. **Resident verification:** `staff` confirms or rejects Grace in *People*.

## If something looks empty

- Run `npm run db:migrate` and then `npm run db:seed` again; both only add what is missing.
- Most demo items are dated around when you seeded. Time-based lists (today, this week) fill up again after a fresh seed.
