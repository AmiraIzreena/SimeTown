# KITA+ API reference

Generated from the route table by `npm run docs:api`. Do not edit by hand.
The machine-readable version is [openapi.json](openapi.json), also served at `/api/v1/openapi.json`.

- Base path: `/api/v1`
- Success: `{ "data": … }`. Failure: `{ "error": { "code", "message", "details?", "requestId" } }`.
- Money is in whole sen. 1 KITA Point = 1 sen.
- Sign-in sets an HttpOnly session cookie. Every POST, PATCH and DELETE must send an `Origin` header equal to the app origin.
- Lists that can grow take `?cursor=&limit=` and return `{ items, nextCursor }`.

## KITA ID

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/townships` | Public | Townships that use KITA+ |
| GET | `/townships/:townshipId/addresses` | Public | The township's precincts and streets, for the address picker |
| GET | `/townships/:townshipId/homes` | Public | Houses and units on one street, for the address picker (addresses only) |
| POST | `/auth/register` | Public | Register as a resident (starts unverified) |
| POST | `/auth/login` | Public | Sign in |
| POST | `/auth/accept-invite` | Public | Set a password from an invitation link |
| POST | `/auth/logout` | Any signed-in user | Sign out |
| GET | `/me` | Any signed-in user | The signed-in account, with any required details still missing |
| PATCH | `/me` | Any signed-in user | Update name and phone (both required) |
| POST | `/me/language` | Any signed-in user | Choose English or Bahasa Malaysia |
| POST | `/me/terms` | Any signed-in user | Accept the Terms of Use and Privacy Notice now in force |
| POST | `/me/home` | RESIDENT | Set or change my address (a new home is confirmed again) |
| POST | `/me/password` | Any signed-in user | Change password (signs out other devices) |
| GET | `/me/export` | Any signed-in user | Download everything held about me (PDPA) |
| POST | `/me/delete` | Any signed-in user | Delete my account (PDPA) |
| GET | `/household/requests` | RESIDENT | Tenants waiting for this owner to confirm them |
| POST | `/household/requests/:userId` | RESIDENT | Owner confirms or declines a tenant |
| GET | `/admin/residents` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Residents by verification status |
| POST | `/admin/residents/:userId/verify` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Confirm or reject a resident against the property record |
| GET | `/admin/accounts` | TOWNSHIP_ADMIN, HQ_ADMIN | Shop, sponsor and staff accounts |
| POST | `/admin/accounts` | TOWNSHIP_ADMIN, HQ_ADMIN | Create a shop, sponsor or staff account and get its invitation link |
| POST | `/admin/accounts/:userId/invite` | TOWNSHIP_ADMIN, HQ_ADMIN | Issue a set-password link (a second admin approves it if the account is in use) |
| GET | `/admin/account-requests` | TOWNSHIP_ADMIN, HQ_ADMIN | New admin accounts and password links waiting for a second admin |
| POST | `/admin/account-requests/:requestId/decision` | TOWNSHIP_ADMIN, HQ_ADMIN | Approve or reject an account request (not your own) |

## Points & XP

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/wallet` | RESIDENT | Points, XP, level, badges, limits and requests waiting for confirmation |
| GET | `/wallet/history` | RESIDENT | Every points movement, with who funded it |
| POST | `/wallet/sales/:saleId/decision` | RESIDENT | Confirm or decline using points on a bill |
| GET | `/leagues/streets` | RESIDENT | This month's Impact XP by street |
| GET | `/notifications` | Any signed-in user | My notifications |
| POST | `/notifications/read` | Any signed-in user | Mark all notifications as read |

## KITA Merchant

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| POST | `/merchants/apply` | Public | Apply to join as a shop (needs admin approval) |
| PATCH | `/merchant/profile` | MERCHANT | Update the shop's business address |
| GET | `/merchants` | RESIDENT | Shops residents can visit |
| GET | `/merchant/summary` | MERCHANT | Reward pool, amount owed, last 7 days and the rules |
| POST | `/merchant/sales` | MERCHANT | Record a sale: give points, and optionally ask to accept points |
| GET | `/merchant/sales` | MERCHANT | This shop's sales |
| GET | `/merchant/sales/:saleId` | MERCHANT | One sale (used to wait for the resident to confirm) |
| POST | `/merchant/sales/:saleId/refund` | MERCHANT | Refund a sale: claw back earned points, return spent points |
| GET | `/merchant/statements` | MERCHANT | Weekly statements and the amount due this week |
| GET | `/admin/merchants` | TOWNSHIP_ADMIN, HQ_ADMIN | All shops with pool and amounts owed |
| POST | `/admin/merchants/:merchantId/status` | TOWNSHIP_ADMIN, HQ_ADMIN | Approve, suspend or restore a shop |
| POST | `/admin/merchants/:merchantId/deposits` | TOWNSHIP_ADMIN, HQ_ADMIN | Record money a shop paid into its reward pool |

## Shop Offers

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/merchant/offers` | MERCHANT | This shop's offers, this month's budget used and success fees |
| POST | `/merchant/offers` | MERCHANT | Create a Shop Offer with its terms and monthly budget (BR30) |
| POST | `/merchant/offers/:offerId/status` | MERCHANT | Pause, resume or end an offer |
| POST | `/merchant/akses-friendly` | MERCHANT | Show or hide the Akses-friendly badge for this shop |
| GET | `/offers` | RESIDENT | Live Shop Offers in my township, my offer-backed points and the pledges behind them |
| GET | `/admin/offers` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | The township's pledges and offer-backed points this month |

## KITA Partner Hub

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/campaigns` | RESIDENT, SPONSOR, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Campaigns visible to this role (residents also get their progress) |
| POST | `/campaigns` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Set up a challenge (draft until funded) |
| POST | `/campaigns/:campaignId/fund` | TOWNSHIP_ADMIN, HQ_ADMIN | Record the funder's payment and open the reward pool |
| POST | `/campaigns/:campaignId/close` | TOWNSHIP_ADMIN, HQ_ADMIN | End a campaign and refund the unused pool |
| GET | `/campaigns/:campaignId/report` | SPONSOR, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Grouped results for a campaign |
| GET | `/sponsors` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Sponsor organisations |
| POST | `/sponsors` | TOWNSHIP_ADMIN, HQ_ADMIN | Add a sponsor organisation |
| POST | `/admin/sponsors/:sponsorId/tier` | HQ_ADMIN | Record a yearly tier payment and give the sponsor that tier (SDP HQ) |
| GET | `/sponsor/tier` | SPONSOR | My tier, its benefits and challenges used this year |
| GET | `/public/partners` | Public | The Partners page: sponsors with a current tier (names only) |
| GET | `/sponsored` | RESIDENT | One labelled sponsored banner for the home screen (never on safety screens) |

## Jiran & Kongsi

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/posts` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Events, help requests and items to give or lend |
| POST | `/posts` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Create an event, a help request or a sharing offer |
| POST | `/posts/:postId/respond` | RESIDENT | Join, offer help or ask for an item |
| POST | `/posts/:postId/responses/:userId/confirm` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Confirm it happened (gives Impact XP) |
| POST | `/posts/:postId/close` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Close a post |
| POST | `/posts/:postId/flag` | RESIDENT | Flag a post for moderators |
| GET | `/moderation/posts` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Posts hidden by flags, waiting for review |
| POST | `/moderation/posts/:postId` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Restore or remove a hidden post |

## Lapor

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| POST | `/reports` | RESIDENT | Report a hazard or access barrier (multipart form; optional photo) |
| GET | `/reports` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | My reports (resident) or the township queue (staff) |
| GET | `/reports/:reportId` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | One report |
| GET | `/reports/:reportId/photo` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | The report's photo (reporter and township staff only) |
| PATCH | `/reports/:reportId` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Staff update status, type, urgency or note (corrections to the AI are logged) |

## Tamu

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/tamu` | RESIDENT | My home's visitor passes, visits and walk-ins waiting for an answer |
| POST | `/tamu/passes` | RESIDENT | Create a visitor pass; the link is returned once |
| POST | `/tamu/passes/:passId/link` | RESIDENT | A fresh link for a pass (the old link stops working) |
| POST | `/tamu/passes/:passId/cancel` | RESIDENT | Cancel a pass |
| POST | `/tamu/entries/:entryId/reply` | RESIDENT | Answer the guard about a walk-in visitor |
| POST | `/tamu/sos` | RESIDENT | SOS to the guardhouse |
| GET | `/passes/:token` | Public | A visitor's pass from their link (no sign-in; street only, never the house) |
| GET | `/guard` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN | The guard's screen: today's gate log, SOS calls, patrol and flood tasks |
| POST | `/guard/scan` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN | Scan a visitor's pass; the host is told at once |
| POST | `/guard/walk-ins` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN | Log a visitor without a pass (name, vehicle, house; never an IC) |
| POST | `/guard/entries/:entryId/exit` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN | Log that a visitor has left |
| POST | `/guard/sos/:sosId` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN | Acknowledge or close an SOS call |
| POST | `/guard/patrol` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN | Scan a patrol point on a round |
| GET | `/admin/patrol-points` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Patrol points with their printable codes |

## Gerak

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/gerak` | RESIDENT | Township loops, today's checkpoints and this month's distance |
| POST | `/gerak/checkins` | RESIDENT | Scan a checkpoint code |
| GET | `/admin/gerak/loops` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Loops with their printable checkpoint codes |
| POST | `/admin/gerak/loops` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Create a loop and its checkpoints |
| POST | `/admin/gerak/loops/:loopId/map` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Draw a loop on the map: its path and where each checkpoint is |
| GET | `/gerak/map` | RESIDENT | Checkpoints with their positions, the activity in progress and recent trips |
| POST | `/gerak/activities` | RESIDENT | Tap Start: begin a tracked walk, run, ride or wheelchair trip |
| POST | `/gerak/activities/:activityId/points` | RESIDENT | A batch of positions, sent only between Start and Finish |
| POST | `/gerak/activities/:activityId/finish` | RESIDENT | Tap Finish: fair-play checks, then verified distance and loops are credited |

## Kitar

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/kitar` | RESIDENT | My recycling totals, my street's total and the kiosks |
| POST | `/kitar/identify` | RESIDENT | Photo check: what material is this? (multipart form; the photo is not stored) |
| POST | `/kitar/dropoffs` | RESIDENT | Record a drop-off at a kiosk |
| GET | `/admin/kitar/kiosks` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Kiosks with their printable codes |
| POST | `/admin/kitar/kiosks` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Add a kiosk |
| POST | `/kitar/machine/join` | RESIDENT | Start recycling at a machine by scanning the code on its screen |
| GET | `/kitar/machine/session` | RESIDENT | My recycling session at a machine, live, and its result |
| POST | `/kitar/claim` | RESIDENT | Claim guest recycling within 14 days (Impact XP only) |
| GET | `/admin/kitar/machines` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Recycling machines, their state and today’s use |
| POST | `/admin/kitar/machines` | TOWNSHIP_ADMIN, HQ_ADMIN | Put a recycling machine at a kiosk |
| POST | `/admin/kitar/machines/:machineId/status` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Mark a machine online, full or offline |
| GET | `/admin/kitar/machines/:machineId/screen` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Prototype: the machine's screen (rotating code and the session in progress) |
| POST | `/admin/kitar/machines/:machineId/start` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Prototype: the machine reads a KITA QR, or a guest taps "Recycle as guest" |
| POST | `/admin/kitar/machines/:machineId/items` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Prototype: the machine's camera, barcode reader and scale report one item |
| POST | `/admin/kitar/machines/:machineId/finish` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Prototype: the machine signs its summary and closes the session |
| POST | `/ingest/kitar/start` | Bearer token (machine) | Device: start a session (KITA QR read, or guest); signed by the machine |
| POST | `/ingest/kitar/items` | Bearer token (machine) | Device: one item recognised, counted and weighed; signed by the machine |
| POST | `/ingest/kitar/finish` | Bearer token (machine) | Device: the session's summary, which must match the items; signed by the machine |

## Jimat

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/jimat` | RESIDENT | My home's readings, the change from last month and tips |
| POST | `/jimat/readings` | RESIDENT | Enter monthly electricity and water readings |
| POST | `/jimat/solar-interest` | RESIDENT | Ask to be contacted about solar, or withdraw that request |
| GET | `/admin/solar-leads` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Residents who asked to be contacted about solar |
| GET | `/jimat/bills` | RESIDENT | Bills read and confirmed for my home (numbers only; no file is kept) |
| POST | `/jimat/bills` | RESIDENT | Upload a bill (multipart: file, kind). Checked, read in memory, never stored |
| POST | `/jimat/bills/:billId/confirm` | RESIDENT | Confirm or correct the numbers read from a bill |
| POST | `/jimat/bills/:billId/discard` | RESIDENT | Throw away a bill that was read but not confirmed |
| GET | `/jimat/sample-bill` | RESIDENT | Prototype: a sample bill (PDF) to my address, marked SAMPLE, for trying bill reading |

## Banjir

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/banjir` | RESIDENT, GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Water level, risk and the latest official message for each zone |
| GET | `/alerts/active` | RESIDENT, GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Open flood alerts that concern me (drives the danger takeover) |
| POST | `/banjir/checkin` | RESIDENT | "I'm safe" or "I need help" during an alert in my zone |
| GET | `/public/flood-status` | Public | The one official flood status page (no sign-in, nothing about any person) |
| POST | `/admin/banjir/zones/:zoneId/level` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | The duty officer sets a zone water level by hand (sent at once) |
| GET | `/admin/banjir/agent` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | The Banjir agent: each zone's signals, drafts waiting for the officer and the decision timeline |
| POST | `/admin/banjir/zones/:zoneId/signals` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Prototype: a signal from the sensor simulator, a camera test picture or the rain gauge |
| POST | `/admin/banjir/drafts/:messageId` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | One tap: send (optionally edited) or cancel a one-signal draft |
| POST | `/ingest/flood` | Bearer token (sensor) | Sensor bridge posts a reading (bearer token); the agent judges it with the other signals |

## Akses+

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/me/access` | Any signed-in user | My access needs and display choices (private) |
| POST | `/me/access` | Any signed-in user | Save my access needs and choices (needs and the priority list need consent) |
| POST | `/me/access/delete` | Any signed-in user | Delete my access needs now (BR32) |
| GET | `/carers` | RESIDENT | My carers, and the people I care for |
| POST | `/carers` | RESIDENT | Ask another resident (by member code) to be my carer |
| POST | `/carers/:linkId/respond` | RESIDENT | Accept or decline being someone’s carer |
| POST | `/carers/:linkId/end` | RESIDENT | End a carer link (either side) |
| GET | `/access-places` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Step-free routes, ramps, lifts, accessible toilets and OKU parking |
| POST | `/access-places` | RESIDENT | Suggest an accessible place (staff check it) |
| POST | `/access-places/:placeId/blocked` | RESIDENT | Say an accessible place is blocked |
| POST | `/admin/access-places` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Add a checked accessible place |
| POST | `/admin/access-places/:placeId/review` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Confirm a place, mark it blocked, or remove it |

## Taman

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/taman` | RESIDENT | Gardens, plots, the watering roster and the wildlife log |
| POST | `/taman/plots/:plotId/book` | RESIDENT | Book a garden plot for six months (one per home) |
| POST | `/taman/plots/:plotId/release` | RESIDENT | Give a plot back |
| POST | `/taman/roster` | RESIDENT | Take a day on a garden's watering roster |
| POST | `/taman/watered` | RESIDENT | Scan the garden's code after watering |
| POST | `/taman/sightings` | RESIDENT | Log a bird, insect or plant you spotted (multipart form; photo optional) |
| GET | `/taman/sightings/:sightingId/photo` | Any signed-in user | A sighting photo (the person who logged it, or staff) |
| GET | `/admin/taman/sightings` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Sightings waiting to be confirmed |
| POST | `/admin/taman/sightings/:sightingId` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Confirm or reject a sighting |
| GET | `/admin/taman/gardens` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Gardens with their printable gate codes |
| POST | `/admin/taman/gardens` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Add a community garden and its plots |

## KITA Insights

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/insights` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Township results for the last 30 days (totals only) |

## Finance

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/finance/float` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | The reward float against everything it owes, and recent checks |
| POST | `/finance/float/check` | TOWNSHIP_ADMIN, HQ_ADMIN | Run the float check now, optionally against a bank statement figure |
| GET | `/finance/settlements` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Payments to shops |
| POST | `/finance/settlements/run` | TOWNSHIP_ADMIN, HQ_ADMIN | Pay every shop in the admin's township what it is owed (the weekly settlement) |
| POST | `/finance/community-pool/deposits` | TOWNSHIP_ADMIN, HQ_ADMIN | Record SDP's payment into the community pool |
| GET | `/finance/adjustments` | TOWNSHIP_ADMIN, HQ_ADMIN | Manual balance corrections and their approvals |
| POST | `/finance/adjustments` | TOWNSHIP_ADMIN, HQ_ADMIN | Request a manual correction (needs a second admin) |
| POST | `/finance/adjustments/:adjustmentId/decision` | TOWNSHIP_ADMIN, HQ_ADMIN | Approve or reject a correction (not your own) |

## Admin

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/admin/audit` | TOWNSHIP_ADMIN, HQ_ADMIN | Audit trail |
| GET | `/admin/settings` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Programme rules |
| PATCH | `/admin/settings` | HQ_ADMIN | Change programme rules (SDP HQ only) |

## System

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| POST | `/internal/jobs/:name` | Bearer token (cron) | Run a scheduled job (expire-points, float-check, settle, cleanup, flood-agent); bearer token |
| GET | `/health` | Public | Liveness: the process is up |
| GET | `/ready` | Public | Readiness: the database answers and the schema is migrated |
| GET | `/openapi.json` | Public | This API as an OpenAPI 3.1 document |
