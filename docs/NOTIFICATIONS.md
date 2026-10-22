# Notifications center

The signed-in `/notifications` page reuses the existing `notifications` table and `notify()` event service. It uses the current user's role-specific shell. The resident navigation and home shortcut now open Notifications. The former `/app/requests` page remains available as **Request tracking**, linked from Notifications, with its existing records and workflows intact.

## Event sources and destinations

| Source | Events | Destination |
| --- | --- | --- |
| Guardhouse and smart lockers | Arrival in the home’s door, a parcel at the guardhouse counter (and why), not delivered today, door and weekly counter reminders, a door opened without a code (urgent), collection, return, pickup-code changes; for guards and staff: calls to make, a counter nearly full, a door to check | `/app/parcels?tab=guardhouse\|lockers&parcel=<id>`; selects the tab and highlights the record when available |
| Home services | Booking requests, quotes, decisions, cancellations, completion and reviews | Existing resident or merchant booking links |
| Lapor | Submission received, status updates, target dates | `/app/lapor/<id>`; existing report authorization applies |
| Incident engine | Assignment, resident updates, questions, escalation and resolution | Existing case reference links |
| Rewards and merchant sales | Points earned, redemption requests/results, expiry and expiry reminders | `/app/wallet` (History is the default tab) |
| Community | Responses, confirmations and moderation updates | Existing Jiran/Kongsi sections |
| Recycling | Household: booking confirmed (with the gate pass), day-before reminder, enter the weight after the gate scan, weight recorded (XP/points), missed so please rebook, under review, review complete. Staff: exceptions only (weights to check, disputed misses, flagged homes and collectors). SDP HQ: flagged homes and collectors only | `/app/kitar`, `/console/recycling` |
| Township/account services | Flood alerts, access requests, approvals and assistant replies | Existing role-specific sections |

No fictitious marketplace orders or announcement system was added. Existing event producers continue to call the same service. New submission receipts and points-earned notices are created in the transaction that records the event.

## Email

Parcel events are also sent by email, in the resident's language and in the shared design
([EMAIL_DESIGN.md](EMAIL_DESIGN.md)): a parcel in the home's door, a parcel at the guardhouse counter
(and why), a parcel left with the guard, the weekly reminder for an overdue guardhouse parcel, and a door opened without a code.
Each email is queued in the same transaction as its notification (`email_outbox`, migration 035),
once per event and person, and sent by the `lockers` job. Pickup codes are never put in an email.
Residents can switch parcel emails off in *Account › Emails*; security alerts are always sent.
Nothing is sent until `SMTP_*` is configured.

## Persistence and API

Migration `023_notification_center.sql` adds categories, dismiss timestamps and inbox indexes, classifies existing rows and scopes existing deduplication keys to recipients. Dismissal retains the record and its deduplication key. No request records are deleted.

The normal migration runner includes this migration. For the existing development database, `scripts/migrate-notifications.ts` applies only migration 023 and leaves unrelated pending migrations untouched; it is safe to rerun.

- `GET /api/v1/notifications`: supports `category`, `unread=true`, `limit`, and keyset `cursor`; returns items, global unread count and next cursor. Newest insertion first.
- `POST /api/v1/notifications/read`: explicitly marks all visible notifications read.
- `POST /api/v1/notifications/:id/read`: reads one owned notification.
- `POST /api/v1/notifications/:id/dismiss`: dismisses one owned notification.

All routes require a session; mutation queries constrain both ID and authenticated user ID. Existing origin protection applies. Opening the bell does not mark anything read. A notification is read before navigation; failures remain visible through the existing error/toast components.

## Refresh and loading

The header, preview and full page share SWR keys. Mutations revalidate all notification queries. Polling every 30 seconds plus focus/reconnect refresh picks up external events; there is no WebSocket infrastructure. Page controls stay mounted during filtering and pagination; skeletons are limited to results. Preview shows the latest five notifications, with a full-page action. Responsive width and bounded scrolling support small screens. Existing theme, components and reduced-motion behavior are reused.

## Boundaries

Old notifications without a record identifier retain their section-level links. Unknown or non-internal destinations become informational notifications instead of broken links. Parcel history retains its existing retention limits; expired records fall back to the parcel section. Demo seed data remains in the existing seed workflow; runtime code creates no sample notifications. Visual desktop/tablet/mobile verification requires a connected browser.

Key implementation files: `src/shared/notifications.ts`, `src/server/modules/notifications.ts`, `src/server/modules/wallet/routes.ts`, `src/components/features/notification-list.tsx`, `src/components/shell/notification-preview.tsx`, `src/components/shell/shell.tsx`, and `src/app/notifications/`.
