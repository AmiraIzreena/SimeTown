# Security

What is protected, how, and what is still open. Priority throughout: correctness of the points
ledger first, then access control, then everything else.

## Controls in place

| Risk | Control | Where |
| --- | --- | --- |
| **Broken access control** | Every endpoint declares who may call it; the router refuses everyone else before the handler runs. The browser's own checks only decide what to show. | `modules/*/routes.ts`, `http/router.ts` |
| **Reading or changing someone else's record (IDOR)** | Services look records up *together with* their owner: a resident's own sale, a shop's own sale, a sponsor's own campaign, staff's own township. Someone else's record answers "not found". | services; tests "does not let one shop…", "keeps one township's staff out…" |
| **Broken authentication** | Passwords hashed with scrypt (N=2¹⁵, per-password salt). One error message for any sign-in failure, with the same work done whether or not the account exists. Sign-in limited per address and per account. Minimum 10 characters. | `auth/password.ts`, `identity/routes.ts` |
| **Session theft** | Random 256-bit token in an `HttpOnly`, `SameSite=Lax` cookie, `Secure` and `__Host-` prefixed over HTTPS. Only its SHA-256 hash is stored. Sign-out and password change delete sessions at once. Role and status are re-read on every request. | `auth/session.ts` |
| **CSRF** | Every state-changing request must carry an `Origin` header equal to `APP_URL`, plus `SameSite=Lax`. | `http/router.ts → assertSameOrigin` |
| **Injection** | Every query is parameterised. The only SQL built from strings uses fixed, in-code column lists. Request bodies and queries are validated by Zod schemas before any handler runs. | services, `http/router.ts` |
| **XSS** | React escapes all output; there is no `dangerouslySetInnerHTML`. A strict Content-Security-Policy with a per-request nonce blocks injected scripts. | `src/proxy.ts` |
| **Clickjacking, sniffing, downgrade** | `frame-ancestors 'none'` and `X-Frame-Options: DENY`; `X-Content-Type-Options: nosniff`; HSTS; `Referrer-Policy`; `Permissions-Policy`. | `next.config.ts`, `src/proxy.ts` |
| **Unsafe uploads** | Photos only. The type is read from the file's first bytes, not from its name or stated type; JPEG, PNG and WebP only; 1.5 MB limit checked before reading; stored in the database, never on a web-served path; served only to the reporter and that township's staff, with `nosniff`. The browser re-encodes photos first, which drops embedded location data. | `http/uploads.ts`, `reports/service.ts`, `lib/image.ts` |
| **API abuse** | A database-backed rate limit on every write (120 a minute per person by default), tighter on sign-in, registration, flagging, scanning and reporting. JSON bodies capped at 64 KB. Lists are paginated with a maximum page size. | `http/router.ts` |
| **Double spending and overdrawing** | Row locks inside one transaction per money operation; the database refuses any negative balance and any unbalanced transaction; sales are idempotent on a client key. | `ledger/*`, `001_init.sql`, `tests/concurrency.test.ts` |
| **Insider fraud** | The ledger is append-only (database triggers). Balance corrections need a second admin, enforced in code and by a constraint. Deposits need a unique bank reference. An audit trail records approvals, money, corrections of AI suggestions and settings changes. | `ledger/finance.ts`, `modules/audit.ts` |
| **Reward farming** | Verified homes only; XP and points capped per person per day and per home per month; each verified thing counts once; kiosk and checkpoint codes are random and shown only to staff; reports earn XP only after staff confirm them. | `rewards.ts`, `ledger/points.ts` |
| **Credential exposure** | No secret is in the repository. Configuration is read once, validated, and fails fast with a clear message. Demo passwords come from the environment or are generated at seed time. Forms post by default and submit buttons stay disabled until the page is interactive, so a password can never land in the address bar. Invitation links are single-use, expire in 7 days and are stored hashed. | `server/config.ts`, `.env.example`, `scripts/seed.ts`, `components/ui/button.tsx` |
| **Information leakage** | Unknown errors become a generic message with a request id; details go to the server log only. Shops see a customer's first name and initial. Sponsors see totals only, and nothing below the minimum group size. | `http/router.ts → errorResponse`, `merchant/service.ts`, `campaigns/service.ts` |
| **Machine endpoints** | Scheduled jobs and sensor readings need a bearer token from the environment, compared in constant time. Without the token configured the endpoint does not exist. | `http/router.ts` |
| **Prompt injection through reports** | The resident's text is passed to the optional AI service as quoted data; the reply is accepted only if it parses to one of the fixed categories; staff can always override it. | `ai/classifier.ts` |
| **Personal data (PDPA)** | Download-my-data and delete-my-account for every user; deletion wipes personal fields and photos and anonymises the rest. Solar contact details are shared with staff only after the resident asks. | `identity/service.ts`, `jimat/service.ts` |
| **Forged recycling records** (BR23) | Each machine signs every record with its own 256-bit key (HMAC-SHA256, compared in constant time). Records older than 5 minutes are refused; a repeated sequence number is refused; the closing summary must match the items received. The screen code changes every 30 seconds. The device endpoints take no cookie and no Origin, and verify the signature before anything is stored. | `kitar/machine.ts`, `http/router.ts` (`auth: 'machine'`) |
| **Harmful uploads** (BR25) | Bills go through a gate: the type is read from the file's first bytes; 4 MB and 4 pages at most; the EICAR test signature is refused; PDFs with scripts, launch actions, embedded files, forms or encryption are refused, including names hidden with #-escapes, also inside compressed streams. Compressed streams are inflated with a hard output limit (no zip bombs). A PDF is never rendered; photos are re-drawn on the phone first. The file is never stored. | `files/gate.ts`, `files/pdf.ts` |
| **Visitor links** | A pass link carries a random 256-bit token; only its SHA-256 is stored, and sharing again replaces it. The public pass page shows the street, never the house number or host, sends no referrer, is not indexed, and is rate-limited per address. The guard can only scan passes of their own township. | `tamu/service.ts`, `app/pass/[token]` |
| **Location privacy** (BR24) | Positions are accepted only for the resident's own running activity, with checked coordinates and timestamps. The first and last 200 m are cut before a route is stored; routes are deleted after 30 days. Demo GPS playback is refused when `APP_ENV=production`. | `gerak/tracking.ts`, `retention.ts` |
| **Assistant history** | Each resident's chats are saved to their own account. Only the owner can list, open or delete them (anyone else gets 404, staff get 403). Only the server writes answers, and saved links stay inside the app. Conversations are deleted 90 days after the last message, can be deleted one by one or all at once, are included in the data export and are removed with the account. | `assistant/service.ts`, `assistant/routes.ts`, `retention.ts` |
| **Assistant agent** | The AI acts only through tools that run as the signed-in resident, with the same checks as the app's screens. It can only propose a visitor pass or a handover; the resident's Yes runs it, once, before it expires. Tool results are passed as data, and the prompt says to ignore instructions inside them. The resident is told their question and the details needed to answer it go to the AI provider. Each resident has a daily AI limit, the routes are rate-limited, and a question about danger always gets 999 first, even if the AI forgets. Pass share links are never stored. | `assistant/agent.ts`, `assistant/tools.ts`, `assistant/service.ts` |
| **Sensitive personal data** (BR32) | Access needs are stored only with explicit consent, never shown to carers or sponsors, shown to duty staff only while the zone is under a flood alert, and deleted on request. Bill account numbers are kept only as a SHA-256 fingerprint (with the township as a prefix) and their last four digits; the full number is never stored or sent back. | `akses/service.ts`, `banjir/agent.ts`, `jimat/bills.ts` |
| **Safety decided by AI** (BR28) | Fixed rules on numbers decide every flood level. Camera readings below 60% confidence do not count. One signal never sends Danger on its own unless nobody answers in 3 minutes and the water is still rising. AI only reads pictures and fills fixed message templates. | `banjir/agent.ts` |
| **Offer-backed points and money** (BR29, BR30) | Offer points live outside the cash ledger, so they cannot affect the float. Issuing locks the township's month row; spending locks the shop's pledge row; the database refuses a pledge used beyond its budget. The success fee moves real money through the ledger like the issuance fee. | `offers/service.ts`, `004_third_edition.sql` |

## Known limits

Be honest about these with judges and mentors.

- **No independent review.** There has been no penetration test and no security audit.
- **Sign-in is e-mail and password.** The proposal's phone one-time code and any second factor for
  admins are not built. Admin accounts should get a second factor before a pilot.
- **No self-service password reset** (there is no e-mail or SMS). An admin issues a new set-password
  link. For an account that is already in use, and for any admin account, a second admin must
  approve it and only the approver sees the link; the owner gets an urgent notice. New admin
  accounts likewise need a second HQ admin. Whoever holds a link can still set the password, so
  the pilot needs delivery straight to the person (e-mail or SMS).
- **Registration says when an e-mail is already used.** Signing in gives one answer for every
  failure, but registering (and applying as a shop) cannot hide that an e-mail is taken without
  sending mail. Per-address limits slow anyone checking many addresses; the full fix is e-mail
  verification ("if this address can be used, we have sent a link") once e-mail delivery exists.
- **Rate limits need the real client address.** Outside development the app refuses to start with
  `TRUST_PROXY=none`. With `forwarded`, only the right-most `TRUSTED_PROXY_HOPS` entries of
  X-Forwarded-For are trusted, because anything to their left was written by the client. A wrong
  hop count either merges visitors or lets them pick their own address, so check it on the host.
  Volumetric attacks should be handled at the edge (see DEPLOYMENT.md).
- **Inline style attributes are allowed** by the policy (`style-src-attr 'unsafe-inline'`), for
  computed widths in charts and progress bars. Scripts are not relaxed.
- **Kiosk weights and meter readings are self-reported.** Caps limit the damage; a pilot needs
  weighing kiosks or staff checks before they earn points.
- **Printed codes can be photographed and shared.** Daily caps apply; a pilot should rotate codes or
  add a location check.
- **Photos are not scanned** for malware or unsuitable content, only type- and size-checked.
- **The bill virus scan is a stand-in.** Only the EICAR test signature is checked; a real scanner (for example ClamAV) is added in the pilot. The PDF text reader handles text stored as plain characters; other bills fall back to the AI service (if configured) or to typing.
- **The bill account fingerprint is unkeyed.** It stops the same bill being used twice, but an account number is short enough that its hash could be guessed by someone who already holds the database. A pilot should use a keyed hash (HMAC) with a secret from the environment.
- **The recycling machine is simulated.** Its signing keys are stored in the database (needed to check HMAC signatures); in a pilot they belong in a key store, and each real device gets its key at set-up.
- **GPS can be faked** by a determined user, as on any phone app. Speed bands, daily limits and per-home caps limit the damage; demo playback is off in production.
- **Garden, kiosk and patrol codes are printed** and can be photographed and shared. Daily caps apply; the machine's rotating screen code does not have this weakness.
- **QR scanning on the guard screen** uses the browser's own barcode reader where available; elsewhere the guard types the code.
- **Bahasa Malaysia covers part of the app**: navigation, the home screen, Simple Mode, Tamu and flood safety messages. The rest shows in English.
- **The ledger's "bank" is a number.** Real money needs reconciliation against real bank statements
  and a regulated holder for the float; the float check accepts a statement figure for this reason.
- **Audit entries are append-only by convention** (no endpoint edits them), not by a database trigger
  like the ledger.
- **Whether SimeTown Points fall under Bank Negara Malaysia's e-money rules** is a legal question for
  SDP's counsel. This build assumes the closed-loop, no-cash-out design in the proposal.

## Reporting a problem

Tell the team lead privately. Do not open a public issue for anything that could expose residents' data.
