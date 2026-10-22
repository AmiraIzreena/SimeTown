# Deployment

How to take SimeTown from a laptop to staging and production. **Nothing in this guide has been
deployed by us**: the Docker images were built and the `docker compose` stack (PostgreSQL 16,
migrations, app) was run and checked locally, but no cloud account was used. Treat the cloud steps
as a design to follow and verify.

## 1. The shape of a deployment

```
 Residents, shops, staff
        │ HTTPS
        ▼
 Cloudflare (DNS, TLS, CDN for /_next/static, WAF and rate-limit rules)
        │ HTTPS, origin reachable only from Cloudflare
        ▼
 App container (Node 22, `node server.js`)   ──►  Managed PostgreSQL 15+ (TLS)
        ▲
        │ bearer token
 Scheduler (daily and weekly jobs)        Sensor bridge (flood readings)
```

Why this split, rather than putting everything on Cloudflare Workers:

- The app keeps a PostgreSQL connection pool and hashes passwords with scrypt (about 32 MB and
  tens of milliseconds of CPU per sign-in). Both fit a long-running Node process naturally. On
  Workers they need a per-request database client through Hyperdrive and a paid CPU limit.
- Cloudflare is still the right front door: TLS, caching of static files, WAF, bot and rate-limit
  rules, and hiding the origin.

Any host that runs a container works for the app: Fly.io, Render, Railway, Google Cloud Run, AWS
App Runner, Azure Container Apps, or SDP's own cloud. For the database: Neon, Supabase, RDS,
Cloud SQL or similar, in a Malaysian or Singapore region to keep personal data close.

## 2. Configuration

All configuration is environment variables, read and validated once in `src/server/config.ts`.
A wrong or missing value stops the app at start-up with a message naming the variable.
`.env.example` documents every one.

| Variable | Development | Staging | Production |
| --- | --- | --- | --- |
| `APP_ENV` | `development` | `staging` | `production` |
| `APP_URL` | `http://localhost:3000` | the staging `https://` address | the live `https://` address |
| `DATABASE_URL` | `pglite://./.data/pglite` or local Postgres | staging database | production database |
| `DB_SSL` | off by default | `require` (default) | `require` (default) |
| `DB_POOL_MAX` | 10 | size to the plan | size to the plan and instance count |
| `TRUST_PROXY` | `none` | `cloudflare`, or `forwarded` on a host without Cloudflare | `cloudflare` |
| `TRUSTED_PROXY_HOPS` | – | with `forwarded`: the number of proxies in front of the app (usually 1) | – |
| `SESSION_TTL_HOURS` | 168 | 168 | decide with SDP |
| `CRON_SECRET` | optional | set | set |
| `SENSOR_INGEST_TOKEN` | optional | set if testing sensors | set when sensors exist |
| `AI_PROVIDER`, `AI_API_URL`, `AI_API_KEY`, `AI_MODEL` | `none` | optional | optional |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | not set | optional | recommended with more than one instance |
| `SESSION_CACHE_SECONDS` | 60 | 60 | 60 (0 turns the cache off) |
| `LOG_LEVEL` | `info` | `info` | `info` |

Rules the app enforces by itself outside development: `APP_URL` must be `https://`, the database
cannot be PGlite, cookies become `Secure` with the `__Host-` prefix, and the database connection
uses TLS unless `DB_SSL=disable` is set on purpose (for a private network).

**Redis (optional).** Create an Upstash Redis database in the same region as the app and copy its
REST URL and token. Set both or neither; the URL must be `https://` outside development. Use a
separate database (or at least separate credentials) for staging and production. Keys are also
prefixed with `APP_ENV`. Without Redis, rate limits count in the `rate_limits` table and every
sign-in lookup reads the database, exactly as before. If Redis fails while the app is running, the
app logs `Redis unavailable; using PostgreSQL` and carries on. The session cache holds each
signed-in person's id, role, name and email for at most a minute, so treat the Redis database as
personal data, in the same region rules as PostgreSQL.

If you change `users` or `sessions` directly in SQL (for example, disabling an account by hand),
the app does not know. Allow `SESSION_CACHE_SECONDS` before relying on it, or set it to 0.

Secrets (`DATABASE_URL`, `CRON_SECRET`, `SENSOR_INGEST_TOKEN`, `AI_API_KEY`, `UPSTASH_REDIS_REST_TOKEN`) go in the host's
secret store, never in the repository or the image. Generate tokens with
`openssl rand -base64 36`.

## 3. Build and run

### With Docker

```bash
docker build -t kita-plus .                       # the image that serves traffic
docker build --target tools -t kita-plus-tools .  # the image for migrations and jobs

docker run --env-file .env kita-plus-tools db:migrate
docker run --env-file .env -p 3000:3000 kita-plus
```

Or the whole stack locally, with PostgreSQL:

```bash
export POSTGRES_PASSWORD=$(openssl rand -hex 16) APP_URL=http://localhost:3000
docker compose up --build -d db app
docker compose run --rm tools db:migrate
SEED_DEMO_PASSWORD=choose-a-demo-password docker compose run --rm tools db:seed   # demo data only
```

### Without Docker

```bash
npm ci && npm run build
npm run db:migrate
npm start                 # listens on $PORT (3000 if unset)
```

### Release order

1. CI passes (lint, types, tests on both databases, build).
2. Run `db:migrate` against the target database. Migrations only add; they are safe to run before
   the new code starts.
3. Start the new app version. The host should wait for `GET /api/v1/ready` (database reachable and
   migrated) before sending traffic, and use `GET /api/v1/health` to restart a stuck process.
4. Never run `db:seed` in production. It refuses when `APP_ENV=production`.

### Continuous deployment (GitHub Actions)

`.github/workflows/cd.yml` runs after CI passes on a push to `main`, and can also be started by hand
(*Actions → CD → Run workflow*). It always uses the exact commit CI tested.

**1. Images (always on, no set-up).** Builds and publishes two images to GitHub Container Registry:

| Image | What it is |
| --- | --- |
| `ghcr.io/<owner>/kita-plus:sha-<commit>` and `:latest` | The app: pages and API in one Next.js server (`node server.js`) |
| `ghcr.io/<owner>/kita-plus-tools:sha-<commit>` and `:latest` | Migrations, bootstrap and jobs (`db:migrate`, `job -- settle`, ...) |

The repository is private, so the packages are too. A host pulls them with a GitHub token that has
`read:packages` (registry `ghcr.io`, user = your GitHub name). Deploy a `sha-` tag when you want to
know exactly which commit is live; `latest` is the newest build of `main`.

**2. Deploy (off until you turn it on).** Set the repository variable `DEPLOY_ENABLED=true`. The job
uses the `production` environment (*Settings → Environments*); add required reviewers there if each
release should be approved by hand. It follows the release order above:

| Name | Kind | Needed | What it does |
| --- | --- | --- | --- |
| `APP_URL` | variable | yes | The live address; the job waits for `APP_URL/api/v1/ready` |
| `DEPLOY_HOOK_URL` | secret | yes | The host's deploy hook. It receives `POST {"image": "ghcr.io/...:sha-..."}`, then pulls and restarts the app |
| `DATABASE_URL` | secret | no | When set, the job runs `db:migrate` with the tools image first. Leave it unset if the host runs migrations itself (a release command) or the database is not reachable from GitHub |
| `APP_ENV` | variable | no | Defaults to `production` (use `staging` for a staging environment) |
| `DB_SSL` | variable | no | Only `disable` for a database without TLS on a private network |

The app's own secrets (`CRON_SECRET`, `LOCKER_CREDENTIAL_SECRET`, `AI_API_KEY`, ...) stay in the
host's secret store, not in GitHub. Releases run one at a time; a newer one waits for the current one.

### First set-up of a real township

A new database has no township, no homes and nobody who can sign in. Describe them in a JSON file
(copy `docs/bootstrap.example.json`; homes come from the property record) and run, once:

```bash
npm run bootstrap -- my-township.json      # or: docker run --env-file .env -v "$PWD:/data" kita-plus-tools bootstrap -- /data/my-township.json
```

It creates the township, zones and homes, and prints a one-time link for the first SDP HQ admin to
set a password. That admin then invites township admins and staff from *People → Staff & partner access*.
Running it again only adds new zones and homes.

## 4. Scheduled jobs

These jobs keep the programme honest. Each is safe to run twice.

| Job | When | What it does |
| --- | --- | --- |
| `float-check` | daily | Proves the float equals what it owes; pauses points if not |
| `expire-points` | daily | Expires old points to their funders; sends 60- and 14-day reminders |
| `cleanup` | daily | Removes expired sessions, old rate-limit rows and stale requests (Redis counters expire by themselves) |
| `parcel-reminders` | daily | Reminds a household once about a parcel waiting three days or more |
| `lockers` | every 5 minutes | Settles unanswered locker door commands and unused reservations; flags doors left open; sends locker reminders; marks parcels overdue and opens relocation tasks; tells courier companies about deposits (retried) |
| `incidents` | every 5 minutes | Escalates township cases nobody took in time, or that are past their resolution deadline, to the township admins (once per case and round); closes resolved cases once the reopening window has passed |
| `recycling` | nightly | Booked collections: confirms requests left from before bookings confirmed themselves; day-before reminders; a past collection the gate never scanned and nobody weighed becomes missed (pass cancelled); one scanned but not weighed closes after 2 days with no points; flags homes with 3+ large weights or reward-limit hits, and collectors with 3+ misses, in 30 days (to township staff and SDP HQ) |
| `couriers` | daily | Pauses company-managed couriers not reconfirmed in 90 days; flags agreements ending within 14 days; ends access when an agreement has ended |
| `settle` | weekly | Pays every shop what it is owed and writes its statement |

Run them from any scheduler, either as a command (`npm run job -- settle` in the tools image) or
over HTTP:

```bash
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/v1/internal/jobs/float-check"
```

A GitHub Actions `schedule`, the host's cron, or a Cloudflare Worker with a Cron Trigger can make
that call. The endpoint does not exist unless `CRON_SECRET` is set.

## 5. Cloudflare in front

1. **DNS and TLS.** Proxy the app's hostname through Cloudflare. Set SSL mode to *Full (strict)*
   and turn on *Always Use HTTPS*. The app already sends HSTS.
2. **Protect the origin.** Allow inbound traffic only from Cloudflare (a Cloudflare Tunnel, or the
   host's firewall limited to Cloudflare's address ranges). Then set `TRUST_PROXY=cloudflare`, so
   rate limits use the visitor's real address from `CF-Connecting-IP`. Do not set it if the origin
   can be reached directly: the header could then be forged.
3. **Caching.** Cache `/_next/static/*` (fingerprinted, safe for a year). Do not cache anything
   else: pages carry a per-request security nonce, and the API sends `Cache-Control: no-store`.
4. **Compression.** Leave Brotli on at the edge.
5. **WAF and rate limits.** The app limits per account and per address; add edge rules for volume:
   for example a low limit on `POST /api/v1/auth/*` and `POST /api/v1/merchants/apply`, and the
   managed rule set for common attacks.
6. **Do not turn on** features that rewrite HTML (Rocket Loader, automatic script minification or
   e-mail obfuscation). They inject scripts that the Content-Security-Policy will block.

Later, if useful: Cloudflare R2 for report photos (replace the `uploads` table), and Turnstile on
registration.

### Running on Workers instead

Possible, but not set up or tested here. It would need: the OpenNext adapter for Cloudflare;
Hyperdrive in front of PostgreSQL; a database client created per request instead of one pool
(`src/server/db/client.ts`); a Workers plan with enough CPU time for scrypt; and moving the four
jobs to Cron Triggers. The backend's `Request → Response` router was written so that this stays a
contained change.

## 6. Smart parcel lockers

**Setting up.** Set `LOCKER_CREDENTIAL_SECRET` (32+ random characters; it derives pickup PINs and
QR codes, which are never stored). In production the lockers refuse to issue codes without it.
Schedule the `lockers` job every five minutes. Add stations, courier companies and overflow
counters in the console under *Smart lockers*, and review the collection policy there: its starting
values (reminders at 24 and 36 hours, relocation after 48) are proposals, not a township policy.
Print each station's QR poster from its link `/locker/<code>`.

**Simulated or real.** A station is either `SIMULATED` (the console's simulator plays its doors,
sensors and keypad, through the same server logic) or `HTTP_GATEWAY` (real hardware). No vendor's
locker API or protocol is built in, and none is claimed: real hardware connects through a small
gateway (supplied with the lockers or written for them) that speaks the contract below and
translates it to the controller's own protocol (REST, MQTT over TLS, serial, and so on).

**The gateway contract.** Every message is signed with the station's device secret (shown once when
the station is added, and rotatable): `HMAC-SHA256(secret, text)` in lowercase hex.

- *SimeTown → gateway*: `POST {gateway_url}/commands` with JSON
  `{ commandId, stationId, compartment, action: "UNLOCK", purpose, parcelId, expiresAt, authorisation }`, headers
  `x-simetown-timestamp` (ISO time) and `x-simetown-signature` = HMAC of `timestamp + "." + body`.
  Answer 2xx to accept. The command must be acknowledged within 30 seconds or it times out and is
  reconciled (the reservation is released; nothing is confirmed).
- *The controller must check `authorisation`* before opening anything: it is
  `HMAC(secret, "UNLOCK|commandId|stationId|compartment|purpose|parcelId|expiresAt")`. Refuse it when
  the signature is wrong, when `expiresAt` has passed, or when that `commandId` was carried out
  before. SimeTown also refuses an acknowledgement that arrives after the command expired. The
  built-in simulator plays a controller that does exactly this; a real controller must be shown to.
- *Gateway → SimeTown*: `POST /api/v1/devices/lockers/events` with JSON
  `{ stationId, eventId, type, commandId?, ok?, error?, compartment?, door?, itemPresent?, credential?, ts, signature }`.
  `type` is `ACK` (did the door open), `DOOR` (`OPEN`/`CLOSED` with `itemPresent`), `HEARTBEAT`, or
  `PICKUP` (a PIN or QR read at the station's keypad). The signature covers
  `stationId|eventId|type|commandId|ok|error|compartment|door|itemPresent|credential|ts` (empty for
  absent fields). Messages older than 5 minutes are refused, and an `eventId` is accepted once.
- A deposit is confirmed only by `DOOR CLOSED` with `itemPresent: true`; a collection only by
  `DOOR CLOSED` with `itemPresent: false`. Stations without presence sensors are marked so, and the
  courier or resident confirms in the app instead.

**Pickup codes and guessing.** A PIN works only at its own station, once. Ten wrong codes in 10
minutes make a station refuse codes for the rest of that window and warn staff; thirty in a day lock
its keypad until staff unlock it under *Smart lockers → Overview* (an urgent notification is sent).
That caps guessing at about 30 tries per lock, so with 20 parcels waiting the chance of hitting one
is about 0.06%. Staffed counters never lock, since staff check ID there. Opening from the app needs
the resident's own sign-in and is not affected. While a keypad is locked, residents with a parcel there
see a notice in the app with an *Ask staff to unlock it* button (staff get an urgent notification,
once per resident), and the station's QR poster page tells everyone else to sign in. A resident can
swap their code for a new one in the app at any time (not while the door is open); the old code
stops working at once.

Changing `LOCKER_CREDENTIAL_SECRET` changes every live PIN and QR code, so do it only when no
parcels are waiting, or reissue their codes afterwards. For a large rollout, consider storing each
random PIN encrypted with a key held in a managed key service (KMS) instead: the key can then be
rotated without changing anyone's code.

## 6a. Courier companies and shipment checks

**Approving companies, not couriers.** Under *Smart lockers → Couriers & companies*, onboard a
company, record how its identity was checked (registration, signed agreement), approve it, choose
its stations and set its agreement's end date. Then either:

- **The company manages its couriers** (`COMPANY_MANAGED`): add the representatives the company has
  named to you in writing. They sign in, invite their couriers by staff number, suspend them and
  reconfirm them at least every 90 days (the `couriers` job pauses anyone not reconfirmed).
- **Couriers sign in through the company** (`FEDERATED`, OpenID Connect): register SimeTown with the
  company's identity provider (redirect URI `{APP_URL}/api/v1/auth/courier-sso/callback`), then set
  the issuer, client id and the *name* of the environment variable holding the client secret. SimeTown
  uses the authorisation code flow with PKCE, checks state, nonce, issuer, audience, expiry and the
  RS256 signature against the provider's keys, and can require an MFA claim (`amr`). A courier's
  account is created on first sign-in; each session lasts one shift (12 hours).
- **Couriers approved one by one** (`MANUAL`): the old way, for independent couriers and companies
  without an arrangement.

A company can suspend a courier here from its own system by posting to
`/api/v1/couriers/{code}/directory-events` with `{ eventId, employeeRef, status: ACTIVE|SUSPENDED|REMOVED, ts, signature }`,
where `signature` is `HMAC-SHA256(secret, "eventId|employeeRef|status|ts")` with the secret in the
environment variable named on the company. Messages older than 5 minutes are refused and each
`eventId` is applied once. Suspensions end the courier's sessions at once.

**Shipment checks.** No courier company's real system is built in. A company that agrees to
integrate implements SimeTown's lookup contract (or a bridge translates it to its own API):

- `POST {provider_url}/shipments/lookup` with `{ trackingNo, requestedAt }`, signed like the locker
  gateway (`x-simetown-timestamp`, `x-simetown-signature` = HMAC of `timestamp + "." + body`, with the
  secret from the environment variable named on the company). Answer within 4 seconds with
  `{ found: false }` or `{ found: true, shipment: { trackingNo, providerRef, status, lockerEligible,
  recipient: { name, phone, addressLine, postcode, simetownCode }, parcel: { weightG, dimensionsMm },
  assignedCourierRef? } }`. `status` is one of `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `DELIVERED`,
  `ON_HOLD`, `CANCELLED`, `RETURNED`. Send `assignedCourierRef` (the courier's staff number) only if
  the company really tracks it, and tick *the provider says which courier carries each shipment*.
- `POST {provider_url}/shipments/deposited` with `{ trackingNo, depositedAt }`, retried by the
  `lockers` job if it fails.

What SimeTown does with the answer: a deposited shipment is never deposited again; a shipment the
company has no record of, or will not allow in a locker, is refused; where the company names the
courier, it must be the one scanning; the household is matched by the resident's delivery code, by a
verified phone with a compatible name and address, or by the address with a compatible name, never by
a name alone. Recipient details are used for matching and not stored; couriers see them masked. When
the company's system does not answer, the township decides (per company) whether couriers may fall
back on the resident's delivery code; such deliveries are recorded as low assurance.

**What a real integration needs from each company:** a signed agreement covering data sharing under
the PDPA; a lookup endpoint implementing the contract above (or an API a bridge can call); its
identity provider details, or named representatives; a webhook secret if it will suspend couriers
from its own system; and the tracking number format its labels use. Until then, use the simulated
companies only for demonstration (they refuse to run in production).

## 6b. Incidents and reports

Residents, guards and couriers report problems from the page where they happen (a locker parcel, a
guardhouse parcel, the gate, the courier station). Problems that belong to the courier company (late,
damaged, wrong item, cancelled) are sent to that company: SimeTown shows the company's support
channel and opens no township case. Everything else becomes a case in the central incident system
(`/console/incidents`), with one person handling it and a deadline. Community reports from Lapor keep
their own queue and are only listed on the same dashboard.

Before going live:

- Agree the deadlines with SDP under *Incidents & reports → Deadlines* (the built-in values are a
  proposal), including working hours, working days and public holidays.
- Schedule the `incidents` job every 5 minutes; without it, nothing escalates.
- For each courier company, record its customer-service channel only after checking it with the
  company (*Smart lockers → Courier companies → Integration*). Residents are told to use the
  courier's own app until a channel is recorded; SimeTown never guesses a link or a number.
- Filing a complaint with a courier company on a resident's behalf is only simulated. A real
  integration needs the company's ticket API and an agreement covering the data shared.

## 7. Logs and monitoring

- The app writes one JSON line per request (method, path, status, milliseconds, request id, user
  id) and full details for any 5xx, to stdout. Collect them with the host's log service.
- Every response carries `X-Request-Id`; error messages show the same id, so a user's screenshot
  leads to the log line.
- Alert on: `ready` failing, any 5xx rate above normal, and above all a failed `float-check`
  (admins also get an urgent in-app notification, and points pause automatically).
- An error tracker (Sentry or similar) can be attached in `src/server/logger.ts`; none is bundled.

## 8. Backups and data

- Turn on the database's point-in-time recovery. The ledger is the system of record for money-like
  value; losing it is not recoverable from anywhere else.
- Photos live in the database in this build, so they are covered by the same backups.
- Keep production data out of development. The seed creates everything a demo needs.

## 9. Before going live: checklist

- [ ] `APP_ENV=production`, `APP_URL` is the final `https://` address
- [ ] Database in the chosen region, TLS on, backups on, least-privilege user for the app
- [ ] Secrets set in the host's secret store; none in the repository
- [ ] Origin reachable only through Cloudflare; `TRUST_PROXY=cloudflare`
- [ ] Jobs scheduled; a test run of each returns 200
- [ ] Township set up with `npm run bootstrap`; admins created by invitation; demo accounts absent
- [ ] Programme rules reviewed under *Rules* (rates and limits are the proposal's assumptions)
- [ ] The open items in [SECURITY.md](SECURITY.md#known-limits) reviewed with SDP
- [ ] Terms of Use and Privacy Notice reviewed by a lawyer, a Bahasa Malaysia version added, and the
      operator and contact address in `src/shared/legal.ts` set to real, monitored details
- [ ] Homes imported with full postal addresses from SDP's property record (`npm run bootstrap`)
- [ ] Smart lockers: `LOCKER_CREDENTIAL_SECRET` set, the `lockers` and `couriers` jobs scheduled, the collection policy agreed, and each real station's controller tested against the contract in section 6 (including refusing expired and repeated authorisations)
- [ ] Incidents: deadlines agreed and saved, the `incidents` job scheduled, each courier company's support channel checked and recorded, and the people who handle cases given staff accounts
- [ ] Courier companies: agreements signed, identities recorded, providers and sign-in set up per section 6a, secrets in the environment; the simulated companies removed; [RISK_REGISTER.md](RISK_REGISTER.md) reviewed
