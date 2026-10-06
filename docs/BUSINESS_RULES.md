# Business rules: where each one lives

The proposal lists 22 business rules (section 12). This table shows where each is enforced on the
server and which automated test proves it. "Ledger", "API" and "Concurrency" refer to
`tests/ledger.test.ts`, `tests/api.test.ts` and `tests/concurrency.test.ts`.

| Rule | In short | Enforced in | Proved by |
| --- | --- | --- | --- |
| BR1 | Residents are verified against a unit; tenants by owner or management | `identity/service.ts` (`registerResident`, `verifyResident`, `decideTenant`); `auth/actor.ts → requireVerifiedResident`; `merchant/service.ts → createSale` | API: "registers a resident as unverified…", "lets an owner confirm their own tenant…"; Ledger: "only serves verified residents of the township" |
| BR2 | Six roles, each sees only its own data and tools | `roles` on every route (`modules/*/routes.ts`), checked in `http/router.ts`; per-record checks in services (`assertTownshipAccess`, own-shop and own-sponsor filters) | API: "enforces roles on the server", "keeps one township's staff out of another township", "does not let one shop read or refund another shop's sale"; Ledger: "shows a sponsor only its own campaigns…" |
| BR3 | Shops need a business registration and admin approval | `merchant/admin.ts` (`applyAsMerchant`, `setMerchantStatus`); `createSale` refuses unapproved shops | API: "keeps a new shop from trading until an admin approves it" |
| BR4 | XP for every verified action; points only with a funded pool | `rewards.ts → recordAction`, `awardCampaigns`; `ledger/points.ts → issueFromPool` | Ledger: "counts each verified action once…", "gives no points when the shop has not paid into its pool", "stops giving points the moment the pool runs out", "gives nothing before the campaign is funded or outside its dates" |
| BR5 | 1 point = RM0.01; no cash-out, no transfer | Points and sen share one unit in the ledger. No endpoint moves points between residents or out as cash | By construction (see [API.md](API.md): there is no such endpoint) |
| BR6 | Daily and monthly limits per person and per home | `ledger/points.ts → earnAllowance` (points); `rewards.ts → recordAction` with `activity_rules` (XP actions) | Ledger: "applies the daily limit per person and the monthly limit per home", "counts each verified action once and respects the daily limit"; API: "…within the daily limit"; Concurrency: "holds the household limit when two members earn at once" |
| BR7 | Alive with activity every 12 months; 24 months at most; reminders at 60 and 14 days | `ledger/points.ts` (`expirePoints`, `sendExpiryReminders`); job `expire-points` | Ledger: "expires points after 12 months without activity…", "keeps points alive while the resident stays active, but never beyond 24 months", "reminds the resident 60 and 14 days before, once each" |
| BR8 | Every point records its funder; money enters the float when the point is given | `point_lots.funder_account_id`; `issueFromPool` debits the funder's prefunded pool in the same transaction | Ledger: "gives 1 point per RM1 and charges the shop the points plus a 15% fee"; API: "shows the resident the pending request and who funded each point" |
| BR9 | Float kept apart; equals points outstanding; checked daily | Separate `TRUST_BANK` and `OPERATING_BANK` accounts; `ledger/finance.ts → runFloatCheck`; job `float-check`; database triggers | Ledger: "passes the daily float check to the sen after everything above", "pauses all point movements when the float check fails", "rejects a transaction that does not balance, in code and in the database"; `expectFloatBalanced` after most tests |
| BR10 | Unused campaign money refunded; expired value back to funder or community pool; never KITA+ income | `campaigns/service.ts → closeCampaign`; `ledger/points.ts → expireLotsForUser` | Ledger: "splits the budget, awards from the pool… and refunds the rest", "expires points… and returns the value to the funder", "sends the value to the community pool when the campaign that funded it has closed" |
| BR11 | No stored customer cash, no top-up | There is no resident cash account and no top-up endpoint. Deposits exist only for shops, campaigns and the community pool | By construction |
| BR12 | From 100 points, at most 30% of a bill, confirmed on the phone, no points on the part paid with points | `merchant/service.ts` (`assertRedeemAllowed`, `decideSale`, `completeSale`) | Ledger: "needs at least 100 points, in whole ringgit, and at most 30% of the bill", "moves nothing until the resident confirms on their own phone, and only they can", "expires a request the resident does not answer in time", "pays the accepting shop 100%… and gives no points on the part paid with points" |
| BR13 | Shops paid 100% weekly; no fee for accepting | `decideSale` credits the shop's payable in full; `ledger/finance.ts → runSettlement`; job `settle` | Ledger: "pays the accepting shop 100%, charges it nothing…", "settles every shop in full each week and shows it on the statement" |
| BR14 | Service fee charged to the funder when points are given; every fee visible | `issueFromPool` (fee from the funder's pool); `sales.fee_sen`; shop summary and statements | Ledger: "gives 1 point per RM1 and charges the shop the points plus a 15% fee" |
| BR15 | Refund: earned points taken back; spent points returned as points | `merchant/service.ts → refundSale` | Ledger: the four tests under "refunds (BR15)" |
| BR16 | Partners get grouped data above a minimum group size, unless a resident opts in | `campaigns/service.ts → campaignReport`; `jimat/service.ts → setSolarInterest`; `insights/service.ts` returns totals only | Ledger: "shows a sponsor only its own campaigns, and no numbers for a small group"; API: "…shares solar interest only on request" |
| BR17 | Sponsored content is labelled | Every campaign card and wallet entry names its funder ("Funded by …") | Visual; the label text is asserted in API: "…who funded each point" |
| BR18 | PDPA: download or delete your data; a DPO is named | `identity/service.ts` (`exportMyData`, `deleteAccount`). Naming a Data Protection Officer is an organisational step, not code | API: "lets a resident download their data and delete their account" |
| BR19 | Danger-level flood alerts and urgent safety reports override other notifications | `banjir/service.ts → recordLevel`; `reports/service.ts → createReport`; `components/shell/alert-takeover.tsx` | API: "raises a warning at 75%, a danger alert at 90%, and puts the danger alert first", "pushes an urgent safety report to staff as URGENT" |
| BR20 | Content flagged by 3+ users is hidden until reviewed | `community/service.ts` (`flagPost`, `moderatePost`) | API: "hides a post after three different residents flag it, until a moderator decides" |
| BR21 | Staff can always override an AI decision; every override is logged | `reports/service.ts → updateReport` writes `AI_OVERRIDE` to the audit log | API: "suggests type and urgency, lets staff correct it with a log entry…" |
| BR22 | No manual balance change without a second person; all logged | `ledger/finance.ts` (`requestAdjustment`, `decideAdjustment`) plus a database constraint (`decided_by <> requested_by`) | Ledger: "needs a second admin for a manual balance change" |

## Decisions the proposal left open

These are choices made in code. Each should be confirmed, or changed, before a pilot.

| Question | What the code does | Where |
| --- | --- | --- |
| How does a shop's money reach the float? | A shop pays into its own **reward pool** in advance. An admin records the transfer (with a unique bank reference) once it shows in the trust account. Points and their fee are taken from that pool as they are given. | `ledger/finance.ts → recordMerchantDeposit` |
| What if a shop's pool is empty? | The sale is still recorded, but **no points are given** and the cashier is told why. | `merchant/service.ts → completeSale` |
| How is a fee that is not a whole sen rounded? | Half up to the nearest sen, per sale (20 points → 3 sen). | same |
| What if the float holds more than "points residents hold"? | It also holds money owed to shops this week and pools not yet given out. The check is float = points held + owed to shops + pools + community pool. | `ledger/finance.ts → floatPosition` |
| Is the service fee returned on a refund? | No. The points go back to the shop's pool; the fee for the original issue is kept. | `refundSale` |
| What if refunded points were already spent elsewhere? | Whatever the resident still holds is taken back. The shortfall is shown to the cashier to deduct from the cash refund. | `refundSale` |
| What if spent points are refunded after the shop was already paid for them? | The value comes from what the float still owes that shop, then from the shop's pool. If neither is enough the refund is refused until the shop tops up. | `refundSale` |
| Which points are spent first? | The batch that expires soonest. | `ledger/points.ts → consumeLots` |
| Do sponsor campaigns also pay the 15% issuance fee? | No. Sponsors pay the campaign fee (default 25%) and running costs (15%) up front, as in the proposal's example 3. | `campaigns/service.ts → fundCampaign` |
| How are SDP community programmes funded? | As a campaign with no sponsor, with the whole budget as reward pool by default. | console → Campaigns |
| Where do balance corrections come from? | The community pool, which SDP pays into. A correction is refused if the pool cannot cover it. | `decideAdjustment` |
| What happens when the float check fails? | All earning and spending pause. An SDP HQ admin resumes them under Rules. | `runFloatCheck`, `assertNotPaused` |
| When does a Lapor report earn XP? | When staff move it to "in progress" or "resolved", never on submission. | `reports/service.ts → updateReport` |
| What makes a Jimat "saver" month? | Neither electricity nor water went up, and at least one fell by 5% or more. Readings are typed in, so this earns XP only. | `jimat/service.ts → submitReading` |
| What happens to points when an account is deleted? | They are given up and the value returns to whoever funded them. | `identity/service.ts → deleteAccount` |
| Danger line at 90% | The proposal gives 75% for Warning. 90% for Danger is our own demo rule; both are editable. | `program_settings` |
