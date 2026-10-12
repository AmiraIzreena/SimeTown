# Deployment

How to take SimeTown from a laptop to staging and production. **Nothing in this guide has been
deployed by us**: the production server was run and exercised locally, but the Docker image was not
built and no cloud account was used. Treat the cloud steps as a design to follow and verify.

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
| `LOG_LEVEL` | `info` | `info` | `info` |

Rules the app enforces by itself outside development: `APP_URL` must be `https://`, the database
cannot be PGlite, cookies become `Secure` with the `__Host-` prefix, and the database connection
uses TLS unless `DB_SSL=disable` is set on purpose (for a private network).

Secrets (`DATABASE_URL`, `CRON_SECRET`, `SENSOR_INGEST_TOKEN`, `AI_API_KEY`) go in the host's
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

### First set-up of a real township

A new database has no township, no homes and nobody who can sign in. Describe them in a JSON file
(copy `docs/bootstrap.example.json`; homes come from the property record) and run, once:

```bash
npm run bootstrap -- my-township.json      # or: docker run --env-file .env -v "$PWD:/data" kita-plus-tools bootstrap -- /data/my-township.json
```

It creates the township, zones and homes, and prints a one-time link for the first SDP HQ admin to
set a password. That admin then invites township admins and staff from *People → Accounts*.
Running it again only adds new zones and homes.

## 4. Scheduled jobs

Four jobs keep the programme honest. Each is safe to run twice.

| Job | When | What it does |
| --- | --- | --- |
| `float-check` | daily | Proves the float equals what it owes; pauses points if not |
| `expire-points` | daily | Expires old points to their funders; sends 60- and 14-day reminders |
| `cleanup` | daily | Removes expired sessions, old rate-limit rows and stale requests |
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

## 6. Logs and monitoring

- The app writes one JSON line per request (method, path, status, milliseconds, request id, user
  id) and full details for any 5xx, to stdout. Collect them with the host's log service.
- Every response carries `X-Request-Id`; error messages show the same id, so a user's screenshot
  leads to the log line.
- Alert on: `ready` failing, any 5xx rate above normal, and above all a failed `float-check`
  (admins also get an urgent in-app notification, and points pause automatically).
- An error tracker (Sentry or similar) can be attached in `src/server/logger.ts`; none is bundled.

## 7. Backups and data

- Turn on the database's point-in-time recovery. The ledger is the system of record for money-like
  value; losing it is not recoverable from anywhere else.
- Photos live in the database in this build, so they are covered by the same backups.
- Keep production data out of development. The seed creates everything a demo needs.

## 8. Before going live: checklist

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
