# SimeTown API reference

Generated from the route table by `npm run docs:api`. Do not edit by hand.
The machine-readable version is [openapi.json](openapi.json), also served at `/api/v1/openapi.json`.

- Base path: `/api/v1`
- Success: `{ "data": … }`. Failure: `{ "error": { "code", "message", "details?", "requestId" } }`.
- Money is in whole sen. 1 SimeTown Point = 1 sen.
- Sign-in sets an HttpOnly session cookie. Every POST, PATCH and DELETE must send an `Origin` header equal to the app origin.
- Lists that can grow take `?cursor=&limit=` and return `{ items, nextCursor }`.

## SimeTown ID

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/townships` | Public | Townships that use SimeTown |
| GET | `/townships/:townshipId/addresses` | Public | The township's precincts and streets, for the address picker |
| GET | `/townships/:townshipId/homes` | Public | Houses and units on one street, for the address picker (addresses only) |
| POST | `/auth/register` | Public | Register as a resident (starts unverified) |
| POST | `/auth/login` | Public | Sign in |
| POST | `/auth/accept-invite` | Public | Set a password from an invitation link |
| POST | `/auth/logout` | Any signed-in user | Sign out |
| GET | `/me` | Any signed-in user | The signed-in account, with any required details still missing |
| PATCH | `/me` | Any signed-in user | Update name and phone (both required) |
| POST | `/me/language` | Any signed-in user | Choose English or Bahasa Malaysia |
| POST | `/me/email-preferences` | Any signed-in user | Switch parcel emails on or off (residents; security alerts are always sent) |
| POST | `/me/terms` | Any signed-in user | Accept the Terms of Use and Privacy Notice now in force |
| POST | `/me/home` | RESIDENT | Set or change my address (a new home is confirmed again) |
| POST | `/me/password` | Any signed-in user | Change password (signs out other devices) |
| GET | `/me/export` | Any signed-in user | Download everything held about me (PDPA) |
| POST | `/me/delete` | Any signed-in user | Delete my account (PDPA) |
| GET | `/household/requests` | RESIDENT | Tenants waiting for this owner to confirm them |
| POST | `/household/requests/:userId` | RESIDENT | Owner confirms or declines a tenant |
| GET | `/admin/residents` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Residents by verification status |
| GET | `/admin/residents/places` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Every place (precinct) with residents waiting, confirmed and rejected |
| POST | `/admin/residents/:userId/verify` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Confirm or reject a resident against the property record (a rejection may give a reason) |
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
| POST | `/notifications/:notificationKey/read` | Any signed-in user | Notification: read |
| POST | `/notifications/:notificationKey/dismiss` | Any signed-in user | Notification: dismiss |

## SimeTown Merchant

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| POST | `/merchants/apply` | Public | Apply to join as a shop or a home service company (needs admin approval) |
| PATCH | `/merchant/profile` | MERCHANT | Update the shop's business address |
| GET | `/merchants` | RESIDENT | Shops residents can visit |
| GET | `/merchant/summary` | MERCHANT | Reward pool, amount owed, last 7 days and the rules |
| POST | `/merchant/sales` | MERCHANT | Record a sale: give points, and optionally ask to accept points |
| GET | `/merchant/sales` | MERCHANT | This shop's sales |
| GET | `/merchant/sales/:saleId` | MERCHANT | One sale (used to wait for the resident to confirm) |
| POST | `/merchant/sales/:saleId/refund` | MERCHANT | Refund a sale: claw back earned points, return spent points |
| GET | `/merchant/statements` | MERCHANT | Weekly statements and the amount due this week |
| GET | `/admin/merchants` | TOWNSHIP_ADMIN, HQ_ADMIN | All shops with pool and amounts owed (optional search, offer type and sort) |
| GET | `/admin/merchant-summary` | TOWNSHIP_ADMIN, HQ_ADMIN | Shop counts by status and the totals held in reward pools and owed |
| GET | `/admin/merchants/:merchantId` | TOWNSHIP_ADMIN, HQ_ADMIN | One shop: its record, contacts, money and recent deposits |
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

## SimeTown Partner Hub

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
| GET | `/public/challenges` | Public | The Challenges page: live funded challenges and the actions that earn Impact XP (no budgets, no people) |
| GET | `/sponsored` | RESIDENT | One labelled sponsored banner for the home screen (never on safety screens) |

## Komuniti

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/posts` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Events, help requests and items to give or lend: one type, several (GIVE,LEND) or all |
| GET | `/posts/impact` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Your verified community XP: events attended, items shared, neighbours helped |
| POST | `/posts` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Create an event, a help request or a sharing offer |
| POST | `/posts/:postId/close` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Close a post |
| POST | `/posts/:postId/respond` | RESIDENT | Join, offer help or ask for an item |
| POST | `/posts/:postId/withdraw` | RESIDENT | Cancel your RSVP or request (events: before they start) |
| POST | `/posts/:postId/responses/:userId/accept` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Accept a help, give-away or borrow request (loans need a return date) |
| POST | `/posts/:postId/responses/:userId/decline` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Decline a request |
| POST | `/posts/:postId/responses/:userId/returned` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Mark a lent item returned (gives the lender Impact XP) |
| POST | `/posts/:postId/responses/:userId/confirm` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Confirm it happened (gives Impact XP) |
| POST | `/posts/:postId/flag` | RESIDENT | Report a post to township staff |
| GET | `/admin/komuniti/overview` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Komuniti at a glance: open posts, reports waiting, hidden posts, overdue loans, suspensions |
| GET | `/admin/komuniti/reports` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Reported posts waiting for a decision: hidden first, then scams and safety |
| GET | `/admin/komuniti/posts` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Every post, including hidden and removed ones |
| GET | `/admin/komuniti/posts/:postId` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | One post in full: responses, every report and decision, and the author’s record |
| POST | `/admin/komuniti/posts/:postId/moderate` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Keep (dismiss the reports), hide while checking, or remove with a reason |
| GET | `/admin/komuniti/suspensions` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Residents who cannot post or respond in Komuniti right now |
| POST | `/admin/komuniti/suspensions/:userId` | TOWNSHIP_ADMIN, HQ_ADMIN | Suspend a resident from Komuniti for some days (replaces an earlier suspension) |
| POST | `/admin/komuniti/suspensions/:userId/lift` | TOWNSHIP_ADMIN, HQ_ADMIN | Lift a Komuniti suspension early |

## Lapor

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| POST | `/reports` | RESIDENT | Report a hazard or access barrier (multipart form; a photo is required: JPEG, PNG or WebP, up to 1.5 MB, at least 400 px). Without "issue", a likely matching issue is returned first ({ needsChoice, issue, alreadyYours }) and nothing is saved |
| GET | `/reports` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | My reports and the ones I follow (resident) or the township queue (staff) |
| GET | `/report-issues` | RESIDENT | Public issues in my township (enough residents affected): written title, type, area, status and dates only, with the township's figures |
| GET | `/report-issues/similar` | RESIDENT | Public open issues that look like the report being written, to tap "Me too" instead |
| GET | `/report-issues/attention` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Open issues that reached the public threshold or are urgent, with their reports (Needs attention) |
| GET | `/report-issues/:issueId/photo` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | The photo neighbours see on a public issue (one report's photo, unless staff hid it); staff see any issue's |
| POST | `/report-issues/:issueId/me-too` | RESIDENT | Say "Me too" on an issue (follow it and count as affected; no XP) |
| PATCH | `/report-issues/:issueId` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Staff update every open report in an issue at once, correct its public title, or choose or hide its public photo (logged) |
| GET | `/reports/similar` | RESIDENT | Open reports that look like the one about to be sent, to tap "Me too" instead |
| GET | `/reports/stats` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Open, late, duplicates avoided and time to fix (the one-channel test) |
| GET | `/reports/:reportId` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | One report |
| GET | `/reports/:reportId/photo` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | The report's photo (reporter and township staff only) |
| GET | `/reports/:reportId/fixed-photo` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | The photo staff took once it was fixed (reporter, followers and staff) |
| POST | `/reports/:reportId/me-too` | RESIDENT | Follow a report about the same problem instead of filing another (no XP) |
| PATCH | `/reports/:reportId` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Staff update status, type, urgency, note, who is fixing it and the target date (corrections to the AI are logged) |
| POST | `/reports/:reportId/fixed-photo` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Staff attach a photo of the fix (multipart form) |

## Requests

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/requests` | RESIDENT | Everything my household is waiting on: reports, parcels and collections, with the next step |

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

## SimeTown Home

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/home-services/categories` | RESIDENT | Service categories with the number of companies offering each |
| GET | `/home-services/providers` | RESIDENT | Companies offering a category, with ratings and pricing |
| GET | `/home-services/providers/:merchantId` | RESIDENT | A company's profile, listings and reviews |
| POST | `/home-services/bookings` | RESIDENT | Ask a company for a visit (multipart form; optional photo) |
| GET | `/home-services/bookings` | RESIDENT | My bookings, open ones first |
| GET | `/home-services/reports` | RESIDENT | My private reports about home-service visits, open ones first |
| GET | `/home-services/logbook` | RESIDENT | The home logbook: jobs confirmed at my home, and services due again |
| GET | `/home-services/bookings/:bookingId` | RESIDENT | One of my bookings: the worker, the history and what I can do next |
| GET | `/home-services/bookings/:bookingId/photo` | RESIDENT, MERCHANT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | The problem photo (the resident, the company booked and township staff only) |
| POST | `/home-services/bookings/:bookingId/cancel` | RESIDENT | Cancel my booking before the visit |
| POST | `/home-services/bookings/:bookingId/confirm` | RESIDENT | Confirm the job is done (only the resident can) |
| POST | `/home-services/bookings/:bookingId/review` | RESIDENT | Review the company for a completed booking |
| POST | `/home-services/bookings/:bookingId/reports` | RESIDENT | Privately report a problem to township staff (never shown to the company) |
| POST | `/home-services/bookings/:bookingId/pass` | RESIDENT | Send the assigned worker a Tamu contractor pass for this visit |
| GET | `/merchant/services` | MERCHANT | The company's description, listings and workers |
| PATCH | `/merchant/services/about` | MERCHANT | What residents read about the company |
| POST | `/merchant/services/trades` | MERCHANT | The kinds of home service the company does |
| POST | `/merchant/services/listings` | MERCHANT | Add or update the listing for a category, with its pricing |
| POST | `/merchant/services/listings/:listingId/active` | MERCHANT | Show or hide a listing |
| POST | `/merchant/services/workers` | MERCHANT | Register a worker (name and phone; never an IC) |
| POST | `/merchant/services/workers/:workerId/active` | MERCHANT | Make a worker active or inactive |
| GET | `/merchant/bookings` | MERCHANT | The company's bookings: open (default) or closed |
| GET | `/merchant/bookings/:bookingId` | MERCHANT | One booking with its history |
| POST | `/merchant/bookings/:bookingId/accept` | MERCHANT | Accept with a visit time, and optionally a worker |
| POST | `/merchant/bookings/:bookingId/decline` | MERCHANT | Decline a request |
| POST | `/merchant/bookings/:bookingId/worker` | MERCHANT | Assign or change the worker (the resident is told) |
| POST | `/merchant/bookings/:bookingId/start` | MERCHANT | The worker has arrived |
| POST | `/merchant/bookings/:bookingId/done` | MERCHANT | The work is finished; the resident confirms |
| POST | `/merchant/bookings/:bookingId/cancel` | MERCHANT | Cancel an accepted booking (the resident is told why) |
| GET | `/admin/home-services/reports` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Reports about home service visits, harassment first |
| GET | `/admin/home-services/reports/:reportId` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | One report with the booking, worker assignment history and records |
| PATCH | `/admin/home-services/reports/:reportId` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Update a report (the resident is told) |
| POST | `/admin/merchants/:merchantId/kind` | TOWNSHIP_ADMIN, HQ_ADMIN | Set what a business offers: shop, home services or both |
| POST | `/admin/merchants/:merchantId/trades` | TOWNSHIP_ADMIN, HQ_ADMIN | Set which kinds of home service a company may offer |
| POST | `/admin/trade-requests/:requestId` | TOWNSHIP_ADMIN, HQ_ADMIN | Approve or decline a company’s request for licensed work (the company is told) |

## Parcels

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/parcels` | RESIDENT | My home's parcels: waiting ones with their one-time code, and the last 30 days |
| GET | `/parcels/:parcelId/photo` | RESIDENT, GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | The parcel's photo (its household and the gate) |
| POST | `/parcels/:parcelId/problem` | RESIDENT | Say a parcel marked collected never reached you |
| GET | `/guard/parcels` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN | Every parcel waiting at the guardhouse, oldest first |
| POST | `/guard/parcels` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN | Log a parcel (multipart form; optional photo). The household gets its code |
| POST | `/guard/parcels/check` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN | Check the code a resident shows: which parcel and shelf |
| POST | `/guard/parcels/:parcelId/collect` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN | Hand a parcel over against its code (the code then stops working) |
| POST | `/guard/parcels/:parcelId/return` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN | Send a parcel back to the courier, when the household or the courier asks (with the reason) |
| POST | `/guard/parcels/:parcelId/notes` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN | Add a note to a parcel's history, for example after calling the household |
| GET | `/admin/guardhouse/parcels` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | The guardhouse register: every parcel held there, searchable and filtered, a page at a time |
| GET | `/admin/guardhouse/overview` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | The guardhouse at a glance: held, overdue, calls due, collected, average days held, room |
| GET | `/admin/guardhouse/parcels/:source/:parcelId` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | One parcel's full history at the guardhouse |
| POST | `/admin/guardhouse/check` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN | Check any code shown at the guardhouse: a shelf collection code or a smart locker pickup code |
| GET | `/admin/parcels/stats` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Waiting, time to collect, same-day share and handovers queried (the parcel test) |

## Smart lockers

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/couriers/companies` | Public | Courier companies that may apply for locker access |
| POST | `/couriers/apply` | Public | Apply for a courier account (an admin approves it and chooses the stations) |
| GET | `/lockers/stations/:code` | Public | A station's public name and place, from the code on its QR poster (grants nothing) |
| GET | `/courier` | COURIER | The courier's account status and the stations they may use |
| GET | `/courier/parcels` | COURIER | The courier's recent deliveries |
| POST | `/courier/parcels` | COURIER | Register a parcel at a station and verify the recipient (no resident details are returned) |
| GET | `/courier/parcels/:parcelId` | COURIER | Where a delivery stands, with its door command |
| POST | `/courier/parcels/:parcelId/open` | COURIER | Open the household's own door (or say why it cannot be used, and which guardhouse can take the parcel) |
| POST | `/courier/parcels/:parcelId/station` | COURIER | Choose another station you may use |
| POST | `/courier/parcels/:parcelId/counter` | COURIER | Take the parcel to the guardhouse instead (only while it is open) |
| POST | `/courier/parcels/:parcelId/confirm` | COURIER | Stations without sensors: confirm the parcel is in and the door is shut |
| POST | `/courier/parcels/:parcelId/problem` | COURIER | Say why the parcel could not go into the household's door (frees the door and shows where to take it) |
| POST | `/courier/parcels/:parcelId/fail` | COURIER | Record that the delivery could not be made today (the parcel stays with the courier; the household is told) |
| GET | `/lockers/my-parcels` | RESIDENT | My home's locker parcels with their QR code and PIN, my locker door, the guardhouse and my late collections |
| POST | `/lockers/parcels/:parcelId/open` | RESIDENT | Open my parcel's door from the app, at the station (its code from the QR poster) |
| POST | `/lockers/parcels/:parcelId/confirm` | RESIDENT | Stations without sensors: confirm I have the parcel and the door is shut |
| POST | `/lockers/parcels/:parcelId/extend` | RESIDENT | Ask for more time on a parcel with a deadline (doors belong to one home and have none) |
| POST | `/lockers/parcels/:parcelId/new-code` | RESIDENT | Replace my pickup PIN and QR code (the old one stops working at once) |
| POST | `/lockers/parcels/:parcelId/keypad-help` | RESIDENT | Ask staff to unlock my parcel's station keypad after it locked itself (once per lockout) |
| POST | `/lockers/parcels/:parcelId/report` | RESIDENT | Report a problem with a parcel from the lockers: not collected by us, damaged, wrong contents, not ours |
| POST | `/lockers/parcels/:parcelId/simulate-close` | RESIDENT, COURIER, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Simulated stations only: close the door you opened, with or without the parcel inside |
| GET | `/admin/lockers` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Every station by compartment state, overflow storage, the 14-day trend and alerts |
| GET | `/admin/lockers/forecast` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Tomorrow's expected demand per station, with the method and recommendations |
| POST | `/admin/lockers/stations` | TOWNSHIP_ADMIN, HQ_ADMIN | Add a station and its compartments (a gateway station’s device secret is shown once) |
| GET | `/admin/lockers/stations/:stationId/doors` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | A station's doors and the home each belongs to |
| POST | `/admin/lockers/compartments/:compartmentId/release` | TOWNSHIP_ADMIN, HQ_ADMIN | Free an empty door when its household moves out (admins) |
| POST | `/admin/lockers/stations/:stationId/status` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Put a station online, offline or in maintenance |
| POST | `/admin/lockers/stations/:stationId/keypad-unlock` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Unlock a station keypad that locked itself after too many wrong pickup codes |
| POST | `/admin/lockers/stations/:stationId/secret` | TOWNSHIP_ADMIN, HQ_ADMIN | Issue a new device secret (the old one stops working) |
| GET | `/admin/lockers/stations/:stationId/commands` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | A station's recent door commands and device messages |
| POST | `/admin/lockers/compartments/:compartmentId` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Disable, enable or clear the fault on a compartment |
| POST | `/admin/lockers/compartments/:compartmentId/unlock` | TOWNSHIP_ADMIN, HQ_ADMIN | Open an empty compartment for maintenance (admins; logged) |
| GET | `/admin/lockers/parcels` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Locker parcels by state, station or tracking number |
| GET | `/admin/lockers/parcels/:parcelId` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | One parcel's state history, custody chain and door commands |
| POST | `/admin/lockers/parcels/:parcelId/receive` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Receive a parcel a courier brought to the counter because the lockers were full |
| POST | `/admin/lockers/parcels/:parcelId/return` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Mark a parcel to go back to the courier, when the household or the courier asks |
| POST | `/admin/lockers/parcels/:parcelId/keep` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Keep a parcel at the guardhouse instead of sending it back |
| GET | `/admin/lockers/parcels/:parcelId/notes` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Staff and guards' notes on a parcel |
| POST | `/admin/lockers/parcels/:parcelId/notes` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Add a note to a parcel, for example after calling the household |
| POST | `/admin/lockers/parcels/:parcelId/returned` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | The courier has taken the parcel back |
| POST | `/admin/lockers/parcels/:parcelId/resolve` | TOWNSHIP_ADMIN, HQ_ADMIN | Settle a parcel held as an exception |
| GET | `/admin/lockers/overflow` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Guardhouses, how full each is, and whether each is open now |
| GET | `/admin/lockers/storage/parcels` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Parcels at the counters: days waited, overdue, calls due and notes |
| GET | `/admin/lockers/storage/deliveries` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Parcels a courier is bringing to a counter, and why |
| POST | `/admin/lockers/overflow` | TOWNSHIP_ADMIN, HQ_ADMIN | Add a guardhouse with its opening hours |
| PATCH | `/admin/lockers/overflow/:locationId` | TOWNSHIP_ADMIN, HQ_ADMIN | Change a guardhouse's opening hours, room or instructions |
| POST | `/admin/lockers/overflow/:locationId/active` | TOWNSHIP_ADMIN, HQ_ADMIN | Stop or resume taking parcels at a guardhouse (not its daily hours) |
| POST | `/admin/lockers/overflow/:locationId/check` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Check the pickup code a resident shows at the counter |
| POST | `/admin/lockers/overflow/:locationId/handover` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Hand the parcel over after checking the code and ID |
| GET | `/admin/lockers/couriers` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Courier applications and accounts with their stations |
| POST | `/admin/lockers/couriers/:userId/approve` | TOWNSHIP_ADMIN, HQ_ADMIN | Approve a courier for the chosen stations |
| POST | `/admin/lockers/couriers/:userId/revoke` | TOWNSHIP_ADMIN, HQ_ADMIN | Withdraw a courier's access at once |
| GET | `/admin/lockers/companies` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Courier companies, including paused ones |
| POST | `/admin/lockers/companies` | TOWNSHIP_ADMIN, HQ_ADMIN | Authorise a courier company |
| POST | `/admin/lockers/companies/:companyId/active` | TOWNSHIP_ADMIN, HQ_ADMIN | Pause or resume a courier company |
| GET | `/admin/lockers/incidents` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Security incidents: replayed barcodes, forced doors, refused commands, suspicious sign-ins |
| POST | `/admin/lockers/incidents` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Report something staff saw at a locker |
| POST | `/admin/lockers/incidents/:incidentId` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Acknowledge or resolve an incident |
| GET | `/admin/lockers/exceptions` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Requests to open an occupied door outside the normal flow |
| GET | `/admin/lockers/access-sessions` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Controlled multi-parcel access sessions |
| POST | `/admin/lockers/access-sessions` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Request one controlled session for several occupied doors at one station |
| POST | `/admin/lockers/access-sessions/:sessionId/decision` | TOWNSHIP_ADMIN, HQ_ADMIN | A second admin approves or rejects a controlled access session |
| POST | `/admin/lockers/access-sessions/:sessionId/items/:itemId/open` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Open the next approved session door |
| POST | `/admin/lockers/access-sessions/:sessionId/items/:itemId/complete` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Scan and confirm the parcel removed during a session |
| POST | `/admin/lockers/exceptions/:requestId/decision` | TOWNSHIP_ADMIN, HQ_ADMIN | A second admin approves (the door opens) or rejects a request |
| POST | `/admin/lockers/parcels/:parcelId/exception` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Ask to open an occupied door (wrong door, wrong household, damage, suspected theft, fault) |
| GET | `/admin/lockers/policy` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | The township's reminder timings for doors and the guardhouse |
| PATCH | `/admin/lockers/policy` | TOWNSHIP_ADMIN, HQ_ADMIN | Change the reminder timings (no fees are ever charged) |
| GET | `/admin/lockers/simulator/:stationId` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | A simulated station's compartments, doors and sensors |
| POST | `/admin/lockers/simulator/:stationId` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Simulated stations only: a door, sensor, fault, connectivity or keypad event |
| POST | `/devices/lockers/events` | Signed device (own HMAC key) | Station gateway: command acknowledgements, door events, heartbeats and keypad pickups (HMAC-signed) |

## Courier platform

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| POST | `/courier/shipments/check` | COURIER | Check a scanned label with the courier company and SimeTown: no door opens (masked recipient only) |
| POST | `/courier/shipments/deliver` | COURIER | Check the shipment again and, if verified, reserve and open the smallest door that fits |
| GET | `/courier/team` | COURIER | A company manager's couriers here, and the company's terms |
| POST | `/courier/team` | COURIER | Add one of the company’s couriers (they get a link to set a password) |
| POST | `/courier/team/:userId/status` | COURIER | Suspend, reactivate or remove one of the company’s couriers (sessions end at once) |
| POST | `/courier/team/:userId/reconfirm` | COURIER | Confirm the courier still works for the company |
| GET | `/auth/courier-sso/companies` | Public | Courier companies whose couriers sign in with the company’s own sign-in |
| POST | `/auth/courier-sso/start` | Public | Start signing in through a courier company (OpenID Connect with PKCE) |
| GET | `/auth/courier-sso/callback` | Public | Where the courier company sends the courier back; signs them in for one shift |
| POST | `/couriers/:code/directory-events` | Signed device (own HMAC key) | A courier company suspends, reactivates or removes one of its couriers (HMAC-signed, applied once) |
| GET | `/admin/couriers/companies` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Courier companies with their approval, stations, representatives, integration and history |
| POST | `/admin/couriers/companies` | TOWNSHIP_ADMIN, HQ_ADMIN | Start onboarding a courier company (it can do nothing until approved) |
| PATCH | `/admin/couriers/companies/:companyId/integration` | TOWNSHIP_ADMIN, HQ_ADMIN | How the company’s couriers sign in and how its shipments are checked |
| POST | `/admin/couriers/companies/:companyId/decision` | TOWNSHIP_ADMIN, HQ_ADMIN | Approve, suspend or revoke a company here, with its agreement and assurance terms |
| POST | `/admin/couriers/companies/:companyId/stations` | TOWNSHIP_ADMIN, HQ_ADMIN | The stations the company’s couriers may use |
| POST | `/admin/couriers/companies/:companyId/representatives` | TOWNSHIP_ADMIN, HQ_ADMIN | Add a representative the company has named (returns a one-time link) |
| POST | `/admin/couriers/companies/:companyId/representatives/:userId/remove` | TOWNSHIP_ADMIN, HQ_ADMIN | Remove a company representative |
| GET | `/admin/couriers/shipments` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Shipment checks this week, the latest scans, repeated scans and provider health |

## Simulated courier companies

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/sim-idp/:code/.well-known/openid-configuration` | Public | Discovery document of a simulated company’s sign-in |
| GET | `/sim-idp/:code/jwks` | Public | Signing keys of a simulated company’s sign-in |
| GET | `/sim-idp/:code/page` | Public | What the simulated sign-in page shows |
| POST | `/sim-idp/:code/authorize` | Public | The simulated company checks its employee and issues a one-time code |
| POST | `/sim-idp/:code/token` | Public | The simulated company exchanges the code for a signed ID token (PKCE) |
| GET | `/demo/labels` | Public | Printable demo labels for the simulated companies’ fictional shipments (demo only) |
| POST | `/admin/couriers/companies/:companyId/simulated-outage` | TOWNSHIP_ADMIN, HQ_ADMIN | Simulated companies only: switch the company’s system down or up |
| GET | `/admin/couriers/simulated` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | The simulated companies’ fictional shipments and staff directories |
| POST | `/admin/couriers/simulated/shipments/:shipmentId` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Act as the simulated company changing a shipment’s status |
| POST | `/admin/couriers/simulated/:companyId/directory/:employeeRef` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Act as the simulated company suspending or reactivating one of its staff |

## Incidents

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| POST | `/incidents/report` | RESIDENT, COURIER | Report a problem: sent to the courier company, filed for the township, or checked against the township’s records first |
| POST | `/incidents/report-with-photo` | RESIDENT | Report a Kitar or Gerak problem, with an optional screenshot or photo (multipart form) |
| GET | `/incident-photos/:reference` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | A report's screenshot or photo (the reporter and that township's staff only) |
| GET | `/incidents/mine` | RESIDENT, COURIER | My reports (ongoing or finished, a page at a time, searchable, by type or waiting for my answer), with what the township office told me, and my courier referrals |
| POST | `/incidents/mine/:reference/reply` | RESIDENT, COURIER | Answer the township office’s question about my report |
| POST | `/incidents/mine/:reference/reopen` | RESIDENT, COURIER | Not fixed: reopen my report within the township’s window (the admins are told) |
| POST | `/incidents/referrals/:referralId/ticket` | RESIDENT | Simulated courier companies only: file the complaint in the company’s (simulated) ticket system |
| GET | `/admin/incidents` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | All the township’s cases with counts and filters (Lapor’s reports listed alongside, read-only) |
| GET | `/admin/incidents/policy` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | How fast each priority must be taken and resolved (proposed values) |
| PATCH | `/admin/incidents/policy` | TOWNSHIP_ADMIN, HQ_ADMIN | Change the case deadlines, working hours, holidays and the reopening window |
| POST | `/admin/incidents/run-checks` | TOWNSHIP_ADMIN, HQ_ADMIN | Run the deadline checks now (the scheduler runs them every 5 minutes) |
| POST | `/admin/couriers/companies/:companyId/support` | TOWNSHIP_ADMIN, HQ_ADMIN | Record a courier company’s support channel after checking it with the company |
| GET | `/admin/incidents/by-reference/:reference` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | One case in full, found by its reference (as linked from notifications) |
| GET | `/admin/incidents/:id` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | One case in full: history, escalations and the related records |
| POST | `/admin/incidents/:id/claim` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | “I’ll handle this”: take an unassigned case (only one person can) |
| POST | `/admin/incidents/:id/assign` | TOWNSHIP_ADMIN, HQ_ADMIN | Assign or reassign a case, with a reason when it already has an owner |
| POST | `/admin/incidents/:id/status` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Investigating, or waiting for the courier company, a contractor or someone else |
| POST | `/admin/incidents/:id/note` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | An investigation note only staff see |
| POST | `/admin/incidents/:id/update-resident` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Send the reporter an update (they are notified) |
| POST | `/admin/incidents/:id/request-info` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Ask the reporter for more details; the case waits for their answer |
| POST | `/admin/incidents/:id/escalate` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Ask an admin to step in (the owner keeps the case) |
| POST | `/admin/incidents/:id/resolve` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Record the outcome and tell the reporter; never unlocks, issues codes or changes the parcel |

## Gerak

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/gerak` | RESIDENT | Township loops, today's checkpoints and this month's distance |
| POST | `/gerak/checkins` | RESIDENT | Scan a checkpoint code |
| GET | `/admin/gerak/loops` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Loops with their printable checkpoint codes |
| POST | `/admin/gerak/loops` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Create a loop and its checkpoints |
| POST | `/admin/gerak/loops/:loopId/visibility` | TOWNSHIP_ADMIN, HQ_ADMIN | Show a loop to residents again, or hide it (township admin or SDP HQ; a reason is kept in the audit log). Every part of Gerak follows at once |
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
| POST | `/admin/kitar/kiosks` | TOWNSHIP_ADMIN, HQ_ADMIN | Add a kiosk (township admin or SDP HQ) |
| POST | `/kitar/test-entry` | RESIDENT | Kitar test mode (local demos only): a practice entry, marked TEST and audited |
| POST | `/kitar/machine/join` | RESIDENT | Start recycling at a bin by scanning the code on its screen |
| GET | `/kitar/machine/session` | RESIDENT | My recycling session at a bin, live, and its result |
| POST | `/kitar/claim` | RESIDENT | Claim guest recycling within 14 days (Impact XP only) |
| GET | `/admin/kitar/machines` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Kiosk bins, their state and today’s use |
| POST | `/admin/kitar/machines` | TOWNSHIP_ADMIN, HQ_ADMIN | Put a bin at a kiosk |
| POST | `/admin/kitar/machines/:machineId/status` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Mark a bin online, full or offline |
| POST | `/admin/kitar/machines/:machineId/material` | TOWNSHIP_ADMIN, HQ_ADMIN | Set the one material a bin takes, or null for any material |
| GET | `/admin/kitar/machines/:machineId/screen` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Prototype: the bin's screen (rotating code and the session in progress) |
| POST | `/admin/kitar/machines/:machineId/start` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Prototype: the bin reads a SimeTown QR, or a guest taps "Recycle as guest" |
| POST | `/admin/kitar/machines/:machineId/items` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Prototype: the bin's scale reports one item |
| POST | `/admin/kitar/machines/:machineId/finish` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Prototype: the bin signs its summary and closes the session |
| GET | `/kitar/collectors` | RESIDENT | Partner collectors, what they take and when they come |
| GET | `/kitar/collections` | RESIDENT | My home's booked collections |
| POST | `/kitar/collections` | RESIDENT | Book a collection of bulky or special items; confirmed at once, with the gate pass |
| POST | `/kitar/collections/:collectionId/cancel` | RESIDENT | Cancel a booked collection |
| POST | `/kitar/collections/:collectionId/weight` | RESIDENT | Send what the collector took. The gate record decides it: the collector scanned in that day credits it (counted up to a maximum per material); no record closes it with no reward. On the day itself it waits for the nightly check |
| POST | `/kitar/collections/:collectionId/came` | RESIDENT | Say the collector came on a collection marked missed, with the weight they took. The gate record decides it at once |
| POST | `/kitar/collections/:collectionId/demo/today` | RESIDENT | Local demos only (pglite in development): move my confirmed collection and its gate pass to today |
| POST | `/kitar/collections/:collectionId/demo/gate-scan` | RESIDENT | Local demos only (pglite in development): the real gate scan of my collection's pass, made with the township's guard account |
| GET | `/admin/kitar/collectors` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Partner collectors with what they have collected |
| POST | `/admin/kitar/collectors` | TOWNSHIP_ADMIN, HQ_ADMIN | Add a partner collector (township admin or SDP HQ) |
| POST | `/admin/kitar/collectors/:collectorId/active` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Pause or resume a collector |
| GET | `/admin/kitar/collectors/:collectorId/today` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | A collector's collections today, to copy or print for them |
| GET | `/admin/kitar/collections` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Recent collections, newest first, and how each was settled |
| GET | `/admin/kitar/collections/history` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Collection history: what each household logged, what was counted, the gate record and who settled it. Search, filters and paging |
| GET | `/admin/kitar/collections/exceptions` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Only what needs a person: weights and disputes to check, homes and collectors to look at |
| POST | `/admin/kitar/collections/:collectionId/review` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Settle a collection waiting for review: accept a weight, or close it with no points |
| POST | `/admin/kitar/collections/:collectionId/confirm` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Confirm a request made before bookings were confirmed at once; the collector gets a gate pass for the day |
| POST | `/admin/kitar/collections/:collectionId/collected` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Record the collector's weighed total (earns the household Impact XP) |
| POST | `/admin/kitar/collections/:collectionId/missed` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | The collector did not come |
| GET | `/admin/kitar/stats` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Material accepted by month and why machines turned items away (the recycling test) |
| POST | `/ingest/kitar/start` | Signed device (own HMAC key) | Device: start a session (SimeTown QR read, or guest); signed by the bin |
| POST | `/ingest/kitar/items` | Signed device (own HMAC key) | Device: one item weighed by the bin’s scale; signed by the bin |
| POST | `/ingest/kitar/finish` | Signed device (own HMAC key) | Device: the session's summary, which must match the items; signed by the bin |

## Banjir

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/banjir` | RESIDENT, GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Water level, risk, last verified reading and the latest official message for each zone |
| GET | `/banjir/zones/:zoneId/history` | RESIDENT, GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | A zone's water level over the last hours, in 10-minute steps |
| GET | `/alerts/active` | RESIDENT, GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Open flood alerts that concern me (drives the danger takeover) |
| POST | `/banjir/checkin` | RESIDENT | "I'm safe" or "I need help" during an alert in my zone |
| POST | `/banjir/help-tasks/:taskId/reached` | GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | The guard (or duty staff) marks a resident on the priority help list as reached |
| GET | `/public/flood-status` | Public | The one official flood status page (no sign-in, nothing about any person) |
| POST | `/admin/banjir/zones/:zoneId/level` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | The duty officer sets a zone water level by hand (sent at once) |
| GET | `/admin/banjir/agent` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | The Banjir agent: each zone's signals, sensors, drafts waiting for the officer and the decision timeline |
| POST | `/admin/banjir/zones/:zoneId/signals` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Prototype: a signal from the sensor simulator (signed readings from the zone's simulated sensors), a camera test picture or the rain gauge |
| POST | `/admin/banjir/zones/:zoneId/camera-photo` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | A drain photo (a CCTV stand-in, multipart field "photo") read by the camera reader (your model server or the hosted AI) and recorded as the camera signal. The photo is not stored |
| POST | `/admin/banjir/drafts/:messageId` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | One tap: send (optionally edited) or cancel a one-signal draft; a cancel or an edit needs a reason (BR21) |
| POST | `/flood/readings` | Signed device (own HMAC key) | A sensor (or its gateway) posts signed readings: signature checked, duplicates dropped, stored, and the agent woken |
| GET | `/admin/banjir/sensors` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Every sensor: battery, signal strength, last seen, health, open ticket and maintenance log |
| POST | `/admin/banjir/sensors` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Register a sensor; its signing key is shown once |
| POST | `/admin/banjir/sensors/:sensorId/calibrate` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Calibrate a sensor on site: the base (0%) and overflow (100%) heights |
| POST | `/admin/banjir/sensors/:sensorId/thresholds` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Set the rate-of-rise and low-battery thresholds from the site survey |
| POST | `/admin/banjir/sensors/:sensorId/maintenance` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Log maintenance; closes the sensor's open ticket |
| POST | `/admin/banjir/sensors/:sensorId/simulate` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Prototype: cut power, drain the battery or stick the value of a simulated sensor |
| GET | `/admin/banjir/help` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | The priority help list and "I need help" check-ins for zones under an alert, with their tasks (duty staff only) |
| POST | `/admin/banjir/help-tasks` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Send a guard to reach a resident on the help list |
| GET | `/admin/banjir/events` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Past and open flood events |
| GET | `/admin/banjir/events/:eventId` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | The post-event report: timeline, who was warned, check-in rate and the false-alarm review |
| POST | `/admin/banjir/events/:eventId/review` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Record the false-alarm review after the all clear |
| POST | `/ingest/flood` | Bearer token (sensor) | Older unsigned bridge (bearer token): a zone-level reading. New sensors use POST /flood/readings |

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
| GET | `/access-places` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Accessible places: verification and today’s availability, kept separate |
| POST | `/access-places` | RESIDENT | Suggest an accessible place (checked for duplicates; verified only by an inspection) |
| POST | `/access-places/:placeId/reports` | RESIDENT | Report a problem at a place (multipart form; optional photo). Grouped, classified and routed automatically |
| POST | `/access-places/:placeId/follow` | RESIDENT | Follow a place to hear when it is blocked or available again |
| GET | `/me/access-reports` | RESIDENT | My accessibility reports and their progress |
| POST | `/access-incidents/:reference/confirm` | RESIDENT | Say whether a claimed fix is real (multipart form; optional photo) |
| POST | `/access-incidents/:reference/reopen` | RESIDENT | The problem is back: reopen a resolved incident I reported |
| GET | `/access-photos/:uploadId` | RESIDENT, GUARD, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | An evidence photo (who may see it depends on what it shows) |
| GET | `/access-work` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN, GUARD | Accessibility incidents routed to the teams I belong to |
| POST | `/access-work/:incidentId/acknowledge` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN, GUARD | Confirm the problem and start work |
| POST | `/access-work/:incidentId/resolve` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN, GUARD | Submit a fix with evidence (multipart form; photo needed for most problems). It is verified before it counts |
| GET | `/admin/access/overview` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Accessibility metrics and only what needs a person |
| GET | `/admin/access/incidents` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Accessibility incidents, with filters |
| GET | `/admin/access/incidents/:key` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | One incident (by id or ACC- reference): reports, evidence, fixes, escalations, deliveries and history |
| POST | `/admin/access/incidents/:incidentId/assign` | TOWNSHIP_ADMIN, HQ_ADMIN | Send an unroutable or escalated incident to an organisation |
| POST | `/admin/access/incidents/:incidentId/verify` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Accept or reject a claimed fix after an inspection |
| POST | `/admin/access/incidents/:incidentId/override` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Confirm a problem seen on site, or (admin) close an incident, with a reason |
| POST | `/admin/access/incidents/:incidentId/simulate` | TOWNSHIP_ADMIN, HQ_ADMIN | SIMULATION: make a simulated provider acknowledge or fix (prototype only) |
| POST | `/admin/access/run-checks` | TOWNSHIP_ADMIN, HQ_ADMIN | Run the Akses+ reminders, escalations and deliveries now for my township (the scheduler also runs them) |
| POST | `/admin/access-places` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Add a place staff have checked (verified, with its first inspection) |
| POST | `/admin/access-places/:placeId/inspect` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Record an inspection: the only way verification changes (multipart form; optional photo) |
| POST | `/admin/access-places/:placeId/party` | TOWNSHIP_ADMIN, HQ_ADMIN | Record which organisation runs a place |
| POST | `/admin/access-places/:placeId/archive` | TOWNSHIP_ADMIN, HQ_ADMIN | Archive a place (kept with its history; never deleted) |
| POST | `/admin/access-places/:placeId/restore` | TOWNSHIP_ADMIN, HQ_ADMIN | Bring an archived place back |
| GET | `/admin/access/parties` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Organisations responsible for facilities, and who acts for them |
| POST | `/admin/access/parties` | TOWNSHIP_ADMIN, HQ_ADMIN | Add an organisation |
| POST | `/admin/access/parties/:partyId` | TOWNSHIP_ADMIN, HQ_ADMIN | Change an organisation: active, members, simulated failures |
| GET | `/admin/access/rules` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Routing rules that apply (the township’s own, then the defaults) |
| POST | `/admin/access/rules` | TOWNSHIP_ADMIN, HQ_ADMIN | Set where a kind of problem goes, and its priority |
| POST | `/admin/access/rules/:ruleId/delete` | TOWNSHIP_ADMIN, HQ_ADMIN | Remove a township rule (the default applies again) |
| GET | `/admin/access/policy` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Response targets and verification rules (proposed values) |
| POST | `/admin/access/policy` | TOWNSHIP_ADMIN, HQ_ADMIN | Change response targets and verification rules |

## Assistant

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/assistant/status` | RESIDENT | Whether answers come from the AI or the rules, and your AI questions used today |
| POST | `/assistant/ask` | RESIDENT | Ask the Assistant; it answers from your own data and checked township facts, and saves the turn |
| POST | `/assistant/actions/:actionId/confirm` | RESIDENT | Yes: do what the Assistant proposed (a visitor pass, or sending a question to the office) |
| POST | `/assistant/actions/:actionId/edit` | RESIDENT | Change the details of a proposal before saying Yes (the pass times, or the question for the office) |
| POST | `/assistant/actions/:actionId/cancel` | RESIDENT | No: drop what the Assistant proposed |
| GET | `/assistant/conversations` | RESIDENT | Your saved Assistant conversations, newest first |
| GET | `/assistant/conversations/:conversationId` | RESIDENT | One of your conversations, with its messages |
| POST | `/assistant/conversations/:conversationId/delete` | RESIDENT | Delete one of your conversations |
| POST | `/assistant/conversations/delete-all` | RESIDENT | Delete all your conversations |
| GET | `/admin/assistant/handoffs` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Questions residents sent to the township office through the Assistant |
| POST | `/admin/assistant/handoffs/:handoffId/answer` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Answer a resident's question; the reply appears in their chat |

## SimeTown Insights

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
| POST | `/internal/jobs/:name` | Bearer token (cron) | Run a scheduled job (expire-points, float-check, settle, cleanup, flood-agent, parcel-reminders, lockers, couriers, incidents, access, recycling, emails); bearer token |
| GET | `/health` | Public | Liveness: the process is up |
| GET | `/ready` | Public | Readiness: the database answers and the schema is migrated |
| GET | `/openapi.json` | Public | This API as an OpenAPI 3.1 document |
