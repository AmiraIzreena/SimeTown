# Console UI handover: SimeTown look, motion and filters

Read this before changing any admin console screen. It records the design
language already applied to the Parcels console (`/console/operations`) so
that every other screen matches it exactly. **Reuse what exists; do not invent
a new style.** When unsure, open the reference files listed below and copy
their patterns.

---

## 1. Reference files (the source of truth)

| What | File |
|---|---|
| Public guest page (motion and feel to match) | `src/app/guest/view.tsx` |
| Design tokens, keyframes, shared classes | `src/app/globals.css` (`@theme` block at top; console filter classes at the end) |
| Shared filter toolkit | `src/components/ui/filter-bar.tsx` |
| Command-centre dashboard (KPI tiles, queue, health rail) | `src/app/console/lockers/today.tsx` |
| Console-only motion | `src/app/console/operations/parcel-workspace.css` |
| A list with grouped chips + table rows | `src/app/console/lockers/parcels.tsx` |
| A queue with chips, sub-chips and filter pills | `src/components/features/incident-board.tsx` |
| Cards, badges, headers, stats | `src/components/ui/card.tsx` |
| Buttons | `src/components/ui/button.tsx` |
| Tabs with sliding indicator | `src/components/ui/tabs.tsx` |

---

## 2. Design principles

1. **Corporate and calm, not flashy.** Motion is short, soft and purposeful: things settle into place, they never bounce or spin.
2. **One easing curve everywhere:** `var(--ease-soft)` = `cubic-bezier(0.22, 1, 0.36, 1)`. Never use `ease`, `linear` (except infinite loops) or Tailwind's default curves for UI motion.
3. **Three speeds:** `--duration-fast` 180ms (hover, colour), `--duration-base` 300ms (enter, toggle), `--duration-slow` 520ms (page sections, reveals). Entrance animations may run 420–600ms.
4. **Severity is colour-coded consistently:** red (`accent`) = critical/late, amber (`warning`) = needs attention, green (`success`) = healthy, brand orange = selected/active, ink grey = neutral.
5. **Dense, scannable rows** like an operations console (ServiceNow, Zendesk): column headers, a left severity rail, one quiet action per row. No giant buttons on every row.
6. **The same filter pattern on every list** (section 5). No native `<select>` in a filter bar.
7. **Respect reduced motion:** every animation lives inside `@media (prefers-reduced-motion: no-preference)`.
8. **Malay for every visible string** (section 9).

---

## 3. Tokens (only these exist)

Colours, from `globals.css` `@theme`:

- `brand`: 50 100 200 300 400 500 600 700 800 900 950 (warm orange; primary)
- `ink`: 25 50 100 200 300 400 500 600 700 800 900 (neutral text/borders)
- `accent`: 50 100 200 500 600 700 900 (red: danger/critical)
- `gold`: 50 100 300 500 700
- `success`: 50 600 700
- `warning`: 50 600 700

**Do not use** `accent-400`, `warning-500`, `success-500` and so on: they do not exist and silently render nothing.

Radii: `rounded-md` (10px) inputs/buttons, `rounded-lg` (14px) inner panels, `rounded-xl` (20px) cards, `rounded-full` chips/pills/dots, `rounded-3xl` only on public pages.

Shadows: `shadow-xs` controls, `shadow-sm` cards, `shadow-md` hover, `shadow-lg` menus/dialogs. Hover glow on interactive cards: `box-shadow: 0 18px 40px rgb(79 28 8 / 0.12)`.

Type:
- Page title: `PageHeader` (it has the orange gradient bar on the left).
- Section title: `font-display text-xl font-bold text-ink-900` + `mt-1 text-sm text-ink-500` description.
- Card title: `CardHeader` (17px semibold).
- Column headers: `text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500` on `bg-ink-25/70`.
- Identifiers (tracking numbers, case refs): `font-mono font-semibold`.
- Numbers: `tabular-nums`; KPI values `font-display text-[28px] font-bold leading-none tracking-tight`.

Surfaces: `Card` already applies `.glass-surface` (frosted white). Dividers inside cards: `divide-y divide-ink-100/80`, borders `border-ink-100/80`. Card footers: `border-t border-ink-100/80 bg-ink-25/60 px-5 py-3 text-sm sm:px-6`.

---

## 4. Motion recipes (copy, don't reinvent)

All keyframes already exist in `globals.css`: `fade-in`, `rise`, `pop`, `dashboard-card`, `section-pop`, `checkpoint-in`, `checkpoint-done`, `segment-grow`, `dot-ping`, `menu-in`.

**Staggered entrance** (the guest page's `Reveal` feel). Give each item `style={{ '--i': index } as CSSProperties}` and:

```css
@media (prefers-reduced-motion: no-preference) {
  .ops-kpi { animation: dashboard-card 520ms var(--ease-soft) both; animation-delay: calc(var(--i, 0) * 60ms); }
  .ops-panel { animation: section-pop 520ms var(--ease-soft) both; animation-delay: 180ms; }
  .ops-queue > .ops-row { animation: checkpoint-in 420ms var(--ease-soft) both; animation-delay: calc(220ms + var(--i, 0) * 45ms); }
  .ops-bar { animation: segment-grow 800ms var(--ease-soft) both; }
}
```

Cap `--i` at about 12 for long lists (`Math.min(i, 12)`) so the last rows don't wait.

**Interactive card hover** (same as the guest page's `.offer-card` and `.journey-card`): lift `translateY(-3px)`, border to `brand-200`, glow shadow, a radial orange glow fading in from the bottom-right (`::after`), the icon tile fills with its tone colour and tilts `rotate(-6deg) scale(1.08)`, and a hidden arrow slides in. Press: `translateY(-1px) scale(0.99)`. See `.ops-kpi` in `parcel-workspace.css`.

**Selected pill** (same as the guest page's `.offer-tab[aria-current]`): `linear-gradient(135deg, brand-500, brand-700)`, white text, `box-shadow: 0 4px 14px rgb(232 111 32 / 0.28)`.

**Rows:** hover background `rgb(255 247 240 / 0.7)`, 200ms; the severity rail widens `scaleX(1.5)` on hover.

**Links with arrows:** `.ops-link`, where the arrow icon shifts `translateX(3px)` on hover.

**Live data:** `<span className="live-dot" />` (a green dot with a soft ping). Status lights: `status-dot is-ok | is-warning | is-danger | is-idle`, plus `is-pulsing` only for things that need attention now (offline station, transfer in progress).

**Progress or fill bars:** `h-1.5 rounded-full bg-ink-100` track with an `.ops-bar` fill (`bg-brand-500` normal, `bg-accent-500` at 85% or more, `bg-gold-500` storage).

**Success empty state:** a round `bg-success-50 text-success-700` icon with `.ops-ok` (the `checkpoint-done` pop).

**Avoid:** bouncing, spinning (except loading spinners), parallax, infinite animations on static content, durations over 800ms, and animating layout properties (width/height/top). Animate `transform` and `opacity` only (bar widths are the one exception and use `transition: width 600ms var(--ease-soft)`).

---

## 5. Search and filter: one pattern for every list

Use `src/components/ui/filter-bar.tsx`. The order is always the same:

```
┌ FilterBar ───────────────────────────────────────────────────────┐
│ [🔍 SearchField ...................................... ✕ ]      │
│ (All 12) (Needs action 3) (In the locker 5) ...  ← FilterChips   │
│ ─────────────────────────────────────────────                    │
│ (All) (Overdue) (Due to be moved)       ← optional sub-chips sm  │
│ [Priority: Any ▾] [Area: Everything ▾] [Sort: Newest ▾]  ← Menus │
├──────────────────────────────────────────────────────────────────┤
│ ● 8 of 40 parcels                                 Clear filters  │ ← FilterSummary
└──────────────────────────────────────────────────────────────────┘
```

Rules:

1. **Search first**, full width: `<SearchField label="Search …" placeholder="what it matches, e.g. Tracking number, courier or door" value={q} onChange={setQ} />`. The placeholder must say what fields are searched. Debounce server searches with `useDebouncedValue`.
2. **The main dimension as chips** (status, queue, location): `FilterChips` with **counts** when you have accurate ones. Use `alert: true` on counts that mean trouble (unassigned, failed, late), which turns them red. The first chip is always "All …".
3. **Too many values (more than about 7)?** Group them into chips, then show a second `size="sm"` chip row for the members of the selected group (see `parcels.tsx` `STATE_GROUPS`). Never put more than about 7 options in one row, and never a 16-option dropdown.
4. **Secondary dimensions as `FilterMenu` pills** (priority, owner, area, company, station, sort). The first option is the "no filter" value. Mark people's or places' names `raw: true` so they aren't translated. One "Sort" pill per list.
5. **No native `<select>` in filter bars.** Native selects remain only for *form fields* inside dialogs.
6. **`FilterSummary` always shows**: shown count, total when it differs, a plural noun, `live` if the list auto-refreshes, and `onClear` only when something is filtered (resetting search, chips, menus and sort).
7. **Don't duplicate:** if chips show a count, don't also show the same number in stat cards above (we removed those on the case board).
8. Keep data on screen while refetching: `useApi(url, { keepPreviousData: true })`.
9. Empty result: `<EmptyState icon={Search} title="No … match"><Text>Try another … </Text></EmptyState>`.

Already applied to: Parcels, both Cases & reports tabs (`IncidentBoard`), Transfers (`relocations.tsx`), Counter storage and drop-offs (`counter.tsx`), Courier companies, Courier accounts, Parcel check history (`shipments.tsx`) and the emergency-access parcel picker (`security.tsx`). **Any new or remaining list must use the same pattern.**

---

## 6. Dashboard ("Today") pattern

See `today.tsx`. Industrial control-tower layout:

1. **KPI strip:** 4–5 tiles in `grid gap-3 sm:grid-cols-2 lg:grid-cols-5`. Each tile is a `<button>` that jumps to the matching filtered list, with a 3px tone bar on top (`is-danger | is-warning | is-ok | is-neutral`), a label, a `CountUp` value and a one-line hint (coloured and bold when it's a problem), plus an arrow that appears on hover.
2. **Main column: one priority queue**, worst first (critical, then late, then high, then unassigned, oldest breaking ties). It has queue chips with counts, column headers, a severity rail per row, and a small `Take` (secondary) or `Open` (ghost) button. Show about 8, then a footer with links to the full lists.
3. **Side rail: system health**, covering *everything* and not only problems: each station with a status light, fill bar and %, red/amber flags; each storage location with held/capacity. Footer link to the details.
4. A `Live` indicator in the queue header.

---

## 7. Component rules

- **Buttons:** `primary` for the one main action in a view; `secondary` for row actions that start work; `ghost` for "open/view"; `size="sm"` inside rows. Never a full-width primary button on every row.
- **Badges:** `Badge tone=` `danger | warning | success | gold | brand | neutral`, matching the severity colours above. Priority tags in dense rows: `rounded px-1.5 py-px text-[11px] font-bold uppercase tracking-wide` on the tone's 50/700 colours.
- **Rows as table:** on `lg:` use CSS grid columns that match the header row exactly (for example `lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_9.5rem_11rem]`); on mobile, stack with `gap-1.5`. Whole row clickable via `<button>` with `focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600`.
- **Severity rail:** `<span aria-hidden className="ops-rail absolute inset-y-2 left-0 w-1 rounded-r-full bg-…" />` inside a `relative` row; give the row content `pl-7`.
- **Tabs:** use `Tabs` (it has the sliding underline). Sub-navigation stays tabs, not chips.
- **Mobile:** chip rows scroll sideways (no wrapping mess), 16px gutters, no horizontal page scroll, tap targets of 40px or more.
- **Accessibility:** chips use `aria-pressed`; menus use `role="listbox"`/`option` with arrow, Home/End, Enter and Escape; decorative icons get `aria-hidden`.

---

## 8. Domain wording rules (the user is strict about these)

- A locker parcel exists **only after the courier scans it at our locker**. Never imply we track parcels in transit ("Arriving" is banned).
  - `REGISTERED`→`DEPOSITED` = "Courier dropping off" (one visit, under a minute; anything left there is a stuck drop-off).
  - `RETURN_PENDING` = "Waiting for the courier to take back" (on our counter shelf).
  - `DELIVERY_FAILED` = the courier kept the parcel, so it goes under "Closed", not "Needs action".
- Plain, short, human labels. No jargon such as "relocation" in new UI; say "transfer to storage" or "move to the parcel counter".

---

## 9. i18n (required)

- Wrap visible text in `<Text>`. Props such as `label`, `placeholder` and `aria-label` are translated by the `Localized*` elements and components.
- Static strings: `src/lib/i18n-extra.ts` (`'English': 'Malay',`). No duplicate keys (tsc catches them).
- Strings with numbers or names: build them as template literals inside `<Text>` and add the pattern to `src/lib/i18n-templates.ts` as `["{0} need attention", "{0} perlu perhatian"]`.
- Run `npx tsx scripts/i18n-audit.ts`. It must print "Every interface text has a Malay entry."

---

## 10. Definition of done for any UI change

- [ ] Uses existing tokens, components and classes; no new colours or easing curves.
- [ ] Lists use `FilterBar`, `SearchField`, `FilterChips`, `FilterMenu` and `FilterSummary`, in that order.
- [ ] Entrance stagger, hover lift/glow and selected-pill gradient match section 4.
- [ ] All motion is inside `prefers-reduced-motion: no-preference`.
- [ ] Wording follows section 8; Malay is complete (section 9).
- [ ] `npx tsc --noEmit -p .` and `npx eslint <changed paths>` are clean.
- [ ] `npx vitest run tests/lockers.test.ts tests/incidents.test.ts tests/courier-platform.test.ts tests/i18n.test.ts` passes.
- [ ] Checked in the browser at desktop and phone width (dev server `localhost:3000`, admin login).

---

## 11. Open items at handover (2026-10-18)

1. Nothing has been checked visually in a browser yet; do a QA pass on Parcels → Today, Smart lockers → Parcels/Cases, and Manage → Companies/Accounts/Parcel check history.
2. `/console/incidents` also uses `IncidentBoard` and lost its 4 stat cards. Ask the user whether to restore them there (for example a `showStats` prop).
3. Optional: a styled menu for form selects inside dialogs (not decided).
4. Parcels chips have no counts: the list API is capped at 200 rows, so accurate counts need a server endpoint that counts by state.
5. API note: `GET /admin/lockers/parcels?state=A,B,C` accepts a comma-separated list (`server/modules/lockers/routes.ts`, `admin.ts`).
6. None of this is committed. The branch `updates` had many unrelated uncommitted changes before this work; don't revert them.
