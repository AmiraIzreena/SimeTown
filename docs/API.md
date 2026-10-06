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

## Gerak

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/gerak` | RESIDENT | Township loops, today's checkpoints and this month's distance |
| POST | `/gerak/checkins` | RESIDENT | Scan a checkpoint code |
| GET | `/admin/gerak/loops` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Loops with their printable checkpoint codes |
| POST | `/admin/gerak/loops` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Create a loop and its checkpoints |

## Kitar

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/kitar` | RESIDENT | My recycling totals, my street's total and the kiosks |
| POST | `/kitar/identify` | RESIDENT | Photo check: what material is this? (multipart form; the photo is not stored) |
| POST | `/kitar/dropoffs` | RESIDENT | Record a drop-off at a kiosk |
| GET | `/admin/kitar/kiosks` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Kiosks with their printable codes |
| POST | `/admin/kitar/kiosks` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Add a kiosk |

## Jimat

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/jimat` | RESIDENT | My home's readings, the change from last month and tips |
| POST | `/jimat/readings` | RESIDENT | Enter monthly electricity and water readings |
| POST | `/jimat/solar-interest` | RESIDENT | Ask to be contacted about solar, or withdraw that request |
| GET | `/admin/solar-leads` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Residents who asked to be contacted about solar |

## Banjir

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/banjir` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Water level and risk for each zone |
| GET | `/alerts/active` | RESIDENT, TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Open flood alerts that concern me (drives the danger takeover) |
| POST | `/admin/banjir/zones/:zoneId/level` | TOWNSHIP_STAFF, TOWNSHIP_ADMIN, HQ_ADMIN | Staff set a zone water level (the prototype sensor) |
| POST | `/ingest/flood` | Bearer token (sensor) | Sensor bridge posts a reading (bearer token) |

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
| POST | `/internal/jobs/:name` | Bearer token (cron) | Run a scheduled job (expire-points, float-check, settle, cleanup); bearer token |
| GET | `/health` | Public | Liveness: the process is up |
| GET | `/ready` | Public | Readiness: the database answers and the schema is migrated |
| GET | `/openapi.json` | Public | This API as an OpenAPI 3.1 document |
