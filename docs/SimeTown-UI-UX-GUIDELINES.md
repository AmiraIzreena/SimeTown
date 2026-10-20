# SimeTown — Premium Corporate UI/UX Standards

> **Standing instruction for Claude and all coding agents.** Read this file before EVERY task that creates, edits, refactors, or reviews the SimeTown interface. This document governs visual and interaction changes; it does not authorize changes to product functionality.

## 1. Non-negotiable operating rules

1. **Preserve functionality exactly.** Do not remove, rename, disable, or alter existing features, routes, role permissions, workflows, validation, API contracts, data models, business rules, notification behavior, or backend integrations. UI-only refactors must preserve outcomes and state transitions. Do not replace real data with mock data.
2. **The repository is the source of truth for the theme.** Before changing UI, inspect global styles, CSS variables, Tailwind configuration, theme providers, design tokens, shared components, fonts, icons, assets, and nearby screens. Reuse the CURRENT SimeTown palette, brand assets, and established visual patterns. Never guess official Sime Darby Property hex values or override the existing theme with colors taken from a reference website.
3. **Premium corporate, not flashy.** Aim for the polished, credible, calm experience expected of a leading Malaysian property developer: elegant hierarchy, considered whitespace, excellent legibility, refined surfaces, subtle depth, consistent alignment, and purposeful motion.
4. **Improve presentation, not scope.** A requested UI improvement does not grant permission to invent features, rearrange critical workflow steps, introduce new approvals, change wording with legal/business implications, or remove information. Ask before any unavoidable behavior change.
5. **Consistency beats novelty.** Improve or reuse shared primitives rather than creating unique visual styles on every screen. Do not introduce another design system or animation library without checking the existing stack.
6. **Production-ready and inclusive.** Ensure responsive behavior, keyboard support, reduced-motion support, sufficient contrast, sensible loading/error states, and no interaction regressions.

## 2. Mandatory workflow for EVERY UI task

### Before coding
- Identify the precise screen(s), components, and user roles affected.
- Inspect existing design tokens and at least two related pages/components where available.
- Record existing interactive behavior: navigation, links, buttons, dialogs, forms, search, filters, sorting, pagination, selection, submissions, keyboard shortcuts, and permission-sensitive states.
- Identify the smallest safe change set. Avoid unrelated refactoring.
- Determine whether CSS transitions are sufficient; use an already-installed motion library only if necessary.

### During coding
- Preserve component props, public interfaces, handlers, accessibility names, test selectors, and functional behavior.
- Use semantic elements and established shared UI components.
- Keep animations decorative and non-blocking: no delayed submissions, inaccessible hover-only content, or overlays intercepting clicks.
- Maintain visual consistency between resident, merchant, service provider, courier, staff, and admin experiences where these roles exist, without changing their permissions.

### After coding
- Run available lint, type-check, unit/integration tests, and build checks as appropriate; report any that could not run.
- Test desktop, tablet, and mobile; pointer, touch, and keyboard; light/dark themes if supported.
- Verify normal, loading, empty, error, disabled, success, and long-content states.
- Compare affected user flows before and after; ensure identical functionality.
- Summarize modified files, visual improvements, animation behavior, test results, and any remaining risks.

## 3. Visual design direction

**Design keywords:** executive, sophisticated, trustworthy, modern, premium, architectural, welcoming, clean, precise.

- **Colors:** use existing semantic tokens (`background`, `foreground`, `primary`, `muted`, `border`, `accent`, etc.) or the project's equivalents. No invented palette or hard-coded brand shades. Check both themes if present.
- **Typography:** preserve installed fonts. Use a restrained type scale, readable line heights, clear headings, concise labels, and consistent numerical formatting. Avoid decorative fonts and excessive uppercase.
- **Layout:** use consistent spacing increments, clear content widths, disciplined grids, aligned cards and controls, and balanced whitespace. Prioritize scanability for data-heavy dashboards.
- **Surfaces:** subtle elevation and borders; controlled radii consistent with existing tokens; soft shadows rather than strong glows. Avoid excessive glassmorphism, gradients, and thick outlines.
- **Imagery and iconography:** use current branded assets and icon family. Maintain consistent stroke weights, sizing, and visual meaning. Never replace official assets with unverified copies.
- **Dashboards:** establish clear KPI hierarchy, compact yet legible data tables, strong filter affordances, and informative status badges. Do not sacrifice data density for decorative motion.
- **Forms:** stable labels, clear validation, readable helper text, obvious required fields, and unmistakable primary actions. Never animate the input away from the pointer or keyboard focus.
- **Navigation:** clear active states, consistent hover/focus behavior, and stable sidebar/header dimensions. Preserve all existing destinations and role visibility.

## 4. Motion design system

Motion should make the product feel responsive and carefully crafted, never theatrical. Apply hover animation to **appropriate interactive elements**, not every static element. Keep static text, critical tables, and dense controls stable.

| Interaction | Preferred effect | Indicative duration |
|---|---|---|
| Button hover | gentle surface/contrast shift, subtle shadow; optional 1–2px lift | 140–200ms |
| Button press | tactile scale around 0.98–0.99, with immediate action | 90–140ms |
| Clickable card hover | 2–4px lift, softened shadow/border emphasis | 180–260ms |
| Navigation item hover | restrained background tint and icon/text emphasis | 140–200ms |
| Active nav/tab | clear indicator with controlled slide/fade | 180–260ms |
| Dropdown/popover | 6–10px offset plus opacity fade | 160–220ms |
| Modal/drawer | gentle opacity/translate, without delaying focus | 180–280ms |
| Page/section entrance | one-time fade + 8–16px rise, if appropriate | 240–400ms |
| Skeleton-to-content | subtle crossfade; avoid layout shifts | 150–250ms |
| Success feedback | concise state transition, no celebratory effects | 180–300ms |

These are guidelines, not a mandate to animate every element. Reuse existing motion tokens if available. Prefer `transform` and `opacity` to animating layout properties. Use calm ease-out curves and short distances. Avoid bounce, rubber-band, parallax overload, spinning icons, cursor trails, perpetual motion, and attention-seeking glow effects on operational screens.

### Hover and pointer behavior
- Add hover affordances to clickable cards, buttons, menu items, and links; distinguish clickable from non-clickable cards.
- Preserve native cursor semantics (`pointer` only for genuinely actionable targets).
- Never make an action discoverable **only** on hover. Touch and keyboard users must access it.
- Use `@media (hover: hover) and (pointer: fine)` for pointer-specific effects.
- Use `:focus-visible` for visible keyboard focus; do not remove focus outlines without a clear replacement.
- No cursor-following magnetic effects in forms, data tables, administrative actions, or destructive controls. If used at all, restrict to nonessential marketing-style CTAs and ensure no hit-target displacement.

### Reduced motion and performance
- Honor `prefers-reduced-motion: reduce`: disable nonessential movement and use instant or minimal state changes.
- Do not animate huge grids, every row on a large table, or large backdrop blur continuously.
- Avoid layout shift, scroll hijacking, long chained delays, and animation that prevents fast repeat interactions.
- Avoid heavy dependencies for simple CSS transitions; lazy-load advanced animation code where sensible.
- Animations must not interfere with browser back/forward, data fetching, navigation, or async action completion.

## 5. Reusable implementation patterns

Use the project's actual theme tokens. These examples are illustrative; adapt class names and imports to the installed stack.

### CSS: polished, accessible hover

```css
.simetown-interactive-card {
  transition: transform 220ms ease, box-shadow 220ms ease, border-color 220ms ease;
}
@media (hover: hover) and (pointer: fine) {
  .simetown-interactive-card[data-clickable="true"]:hover {
    transform: translateY(-3px);
    box-shadow: var(--card-hover-shadow, 0 10px 28px rgb(0 0 0 / 0.08));
    border-color: var(--interactive-border-hover, currentColor);
  }
}
.simetown-interactive-card:focus-visible {
  outline: 2px solid var(--focus-ring, currentColor);
  outline-offset: 3px;
}
@media (prefers-reduced-motion: reduce) {
  .simetown-interactive-card { transition: none; }
  .simetown-interactive-card:hover { transform: none; }
}
```

Do not copy the fallback colors blindly; map these variables to real theme tokens. Never make a non-interactive `<div>` clickable without correct semantic controls.

### React Motion: only if already installed or justified

```tsx
import { motion, useReducedMotion } from "motion/react";

function PremiumAction({ children, onClick }: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={reduceMotion ? undefined : { y: -1 }}
      whileTap={reduceMotion ? undefined : { scale: 0.985 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className="existing-simetown-button-classes"
    >
      {children}
    </motion.button>
  );
}
```

Retain existing component variants, ref forwarding, loading/disabled behavior, and event contracts when adapting this pattern. Do not replace an established button component just to animate it.

## 6. Component-by-component improvement checklist

- **Buttons:** consistent sizes/variants, crisp hover/press/focus, stable loading indicator, no double submission.
- **Cards:** consistent padding/radius/elevation; hover lift only when actionable; clear click target.
- **Sidebar/header:** strong active-state hierarchy, elegant hover, responsive collapse without lost navigation.
- **Tables:** sticky headers only when appropriate, legible density, row hover that does not hide content, preserved sorting/filtering/pagination.
- **Charts/KPIs:** consistent data formatting, restrained transitions, accessible text alternatives, no fabricated figures.
- **Dialogs/drawers:** preserve focus trapping, Escape/close semantics, scroll behavior, and confirmations.
- **Forms:** polished focus and error states; unchanged validation, submission payloads, and field requirements.
- **Notifications:** clear unread/read hierarchy, gentle status transitions, preserved routing and badge counts.
- **Mobile:** comfortable tap targets, no hover dependence, no overflow, preserved bottom navigation if already used.
- **Empty/loading/error states:** intentional design with helpful copy, without inventing new backend behaviors.

## 7. References — inspiration, not a theme replacement

Use references for **principles, interaction quality, composition, and implementation**, never for copying proprietary branding or replacing SimeTown tokens.

1. **Sime Darby Property (official):** https://www.simedarbyproperty.com/ — corporate brand tone, hierarchy, architectural presentation, restrained polish.
2. **shadcn/ui:** https://ui.shadcn.com/ — composable, accessible open-code UI patterns. Prefer existing project components over installing replacements.
3. **Motion for React:** https://motion.dev/docs/react-animation and https://motion.dev/docs/react-hover-animation — interaction gestures, hover, enter/exit transitions, and motion control.
4. **Radix Primitives:** https://www.radix-ui.com/primitives — accessibility and behavior patterns for complex components.
5. **Linear:** https://linear.app/ — inspiration for precise SaaS density, calm transitions, and consistent interaction patterns; not a palette reference.
6. **Vercel:** https://vercel.com/ — inspiration for disciplined spacing, typography, and sophisticated dashboard presentation; not a branding reference.

Check current documentation and component licensing before incorporating external code. No direct visual cloning.

## 8. Mandatory skeleton loading and asynchronous UX

- **Use branded, layout-matched skeleton placeholders for asynchronous content** (cards, dashboards, tables, lists, profile sections, charts) instead of blank space, layout jumps, or generic spinners. Match the real content geometry, spacing, and current SimeTown theme tokens.
- **600 ms skeleton display target:** when a skeleton is shown, keep it visible for approximately **600 ms minimum** to avoid jarring flashes. Start timing when it becomes visible; if data is still loading after 600 ms, keep the skeleton until the request settles. Never replace actual unresolved loading with fake success or hide the skeleton prematurely.
- **Do not impose a 600 ms artificial wait on already-ready data.** For cached or near-instant content, avoid flashing a skeleton by using a brief display threshold (e.g., 120–180 ms) before showing one. Once shown, honor the ~600 ms minimum. Prioritize perceived speed and responsiveness.
- Use restrained shimmer/pulse with existing palette, reduced-motion alternatives, and accessible `aria-busy` / status semantics. Avoid aggressive shimmer and flashing.
- Preserve existing data-fetching, caching, API contracts, and mutations. Loading UI must not create duplicate requests or block unrelated controls.
- Show accurate error, retry, partial-data, no-results, and truly-empty states. Never present skeletons indefinitely after failure.
- Prevent cumulative layout shift by reserving dimensions; use progressive rendering for large pages and keep interactive elements stable.
- For action submissions, use appropriate button-level pending states and duplicate-submit prevention **without changing submission behavior**.

## 9. Industrial-grade search, filter, sort, and large-data presentation

**Apply whenever a screen displays a substantial or potentially growing collection** (e.g., residents, merchants, bookings, parcels, reports, notifications, transactions, services, requests, audit logs). Inspect existing behavior first. For screens that lack these capabilities, treat adding them as a **proposed feature enhancement requiring approval**, not as an automatic UI-only change.

- **Search:** visible, labeled search field; search meaningful fields; sensible placeholder; clear/reset action; keyboard-friendly focus; debounce client-side or server-side requests (~250–400 ms when suitable); never issue unnecessary requests on every keystroke. Search semantics and permissions must match the existing backend.
- **Filters:** relevant domain-specific filters (status, category, date range, location, owner, type, etc. only when supported by real data); clear active filter chips; obvious Reset all; combine filters predictably; avoid irrelevant filters.
- **Sort:** useful, clearly labeled sortable fields with explicit direction and stable deterministic ordering. Do not sort formatted display strings when typed values exist.
- **Pagination / infinite loading:** choose based on use case; prefer accessible server-side pagination for large admin tables, with page size, total count if available, and stable results. Avoid loading an unbounded dataset into the browser. Preserve query state across pagination.
- **State persistence:** where appropriate, synchronize search/filter/sort/page state with URL query parameters so refresh, back/forward, and shareable views work; do not overwrite existing routing behavior.
- **Responsive data UI:** accessible tables on desktop; compact cards or horizontal-scroll tables on mobile as appropriate; never hide important actions or columns without a usable alternative.
- **Bulk operations:** only if existing permissions and business logic already support them, or after approval; use selection counts, confirmations for destructive actions, and proper feedback.
- **UX states:** display accurate result count, loading skeletons, empty dataset vs no matching results, clear filters, errors with retry, and preserved selection as appropriate.
- **Security and integrity:** enforce authorization and filtering on the server where required; never assume UI filtering is a security boundary; protect sensitive information and avoid exporting fields without permission.
- **Performance:** consider indexes, server-side filtering, virtualization for genuinely large client-rendered lists, request cancellation/race protection, and query caching where appropriate; do not introduce backend changes without approval.

### Large-list decision rule

1. Audit the screen and estimate realistic growth, task frequency, and available query APIs.
2. If search/filter/sort/pagination already exist, improve their **presentation and usability** while preserving their semantics.
3. If missing, include a short **recommended enhancement** with suggested fields, technical dependencies, and expected value; request authorization before implementing functional additions.
4. Once authorized, implement end-to-end and test search + combined filters + sort + pagination + reset + mobile + role permissions.

## 10. Proactive professional-product gap audit

On each relevant UI task, briefly assess the affected screen against mature enterprise applications and **identify useful missing conventions**, rather than adding random features. Look for:

- Consistent page headers, breadcrumbs when navigation depth warrants them, clear primary/secondary actions, and contextual help.
- Meaningful loading/empty/error/success states, actionable validation messages, toast/inline feedback, confirmation for destructive actions, and undo only where safe.
- Search/filter/sort/pagination for growing datasets; saved views only when justified and approved.
- Accessibility: visible keyboard focus, logical tab order, form labels, WCAG-aligned contrast, touch target sizes, screen-reader announcements, reduced motion.
- Responsive navigation, mobile-friendly forms, table alternatives, sensible content density, and cross-device consistency.
- Permission-aware controls, transparent status history, audit trail visibility, and secure handling of sensitive data **where the system already supports it**.
- Reliable notifications with read/unread semantics, direct deep links, clear timestamps, and appropriate user preferences **if relevant and approved**.
- Form draft protection, validation, duplicate-action prevention, recovery from failed network calls, and clear destructive-action warnings.
- Performance: code splitting, image optimization, cache-aware rendering, layout stability, and robust slow-network handling.
- Internationalization-ready layout, date/currency/number formatting suitable for Malaysia, timezone clarity, and consistent terminology.
- Admin-specific quality: helpful table density, export affordances (only if authorized), status explanations, operational metrics, and contextual actions.

**Critical distinction:** A UI polish request authorizes only safe visual/presentation refinements. If an industry-standard improvement needs new features, backend changes, role/permission changes, data collection, new dependencies, or altered workflow, **do not silently implement it**. Report it in a prioritized `Professional UX Opportunities` section:

| Priority | Gap observed in SimeTown | User/business benefit | Proposed UX | Technical/permission impact | Approval needed? |
|---|---|---|---|---|---|
| P0/P1/P2 | Only verified repository findings | Concrete value | Minimal coherent change | Explicit dependencies | Yes/No |

Do not claim a capability is absent without checking the repository. Distinguish confirmed gaps from items requiring investigation. Prefer 3–5 high-impact, context-relevant recommendations, not a huge generic wishlist. Do not expand scope or implement proposals requiring approval until the user agrees.

## 11. Mandatory data organization and information architecture

**Every data-heavy screen MUST be deliberately organized, easy to scan, and decision-oriented.** This applies to resident, merchant, service provider, staff, and admin views. Do not treat a working database query as a well-designed information display.

- **Audit before changing:** Identify the screen's primary user, main question, highest-priority actions, source of truth, existing columns, existing controls, and current workflow. Inspect adjacent screens for consistent conventions.
- **Clear hierarchy:** Place page title, purpose, primary action, meaningful status or summary, controls, and main content in a predictable order. Put essential decision-making fields first; de-emphasize secondary metadata.
- **Logical grouping:** Group related fields, records, and actions into named sections, coherent tables, cards, tabs, or expandable details. Use tabs only for genuinely distinct views; do not hide essential content unnecessarily.
- **Consistent structure:** Use stable labels, terminology, field order, date/time formatting, units, status names, badges, spacing, alignment, and action placement across similar screens. Align numeric columns and use readable dates and currency with appropriate locale.
- **Scannable tables:** Prefer meaningful column order, readable row spacing, truncated long values with accessible full-value access, useful status treatment, and clear row-level actions. Avoid excessive columns on mobile; use a responsive card/detail alternative without losing information.
- **Useful defaults:** Where existing behavior permits, surface actionable/recent/relevant records first. Do not silently alter existing sort semantics or prioritization rules; propose any functional default changes for approval.
- **Search and discovery:** For substantial datasets, provide a discoverable search field, context-appropriate filters, sort, pagination or virtualization as appropriate, visible result counts, active filter indicators, reset controls, and a meaningful no-results state. Use debouncing and server-side querying where needed for scale. Never imply that client-side filtering covers records that were not loaded.
- **Progressive disclosure:** Keep primary tasks visible. Move supplementary details to an accessible disclosure, drawer, or detail view; do not conceal warnings, critical statuses, or required actions.
- **Meaningful states:** Design organized loading, empty, filtered-empty, error, permission-denied, and success states. Preserve table geometry with matching skeletons, following the ~600 ms skeleton policy.
- **No invented data:** Do not fabricate counts, charts, summaries, priorities, categories, or status labels. Preserve authoritative values and permission boundaries.
- **Respect existing behavior:** Reordering purely visual elements is allowed only when it does not alter task meaning, accessibility order, or workflow. New queries, saved filters, export, bulk actions, changed defaults, role-based data exposure, and schema/API changes require approval.

**Data-organization review for every relevant page:** Can a user identify what matters in five seconds? Can they find a specific record quickly? Are labels, statuses, actions, and groups consistent? Can they recover from no results? Does the mobile version retain all critical information? If not, improve UI-only organization and propose functional changes separately.

## 12. Mandatory smooth, intuitive, end-to-end user flows

**Every flow MUST feel coherent, responsive, predictable, and easy to complete**, from entry point through completion, cancellation, and recovery. Motion should reinforce usability rather than distract from it.

1. **Map the current journey:** Before editing, trace the real user path and affected roles: entry point → browse/search → inspect → take action → confirmation/feedback → next step. Verify routes, states, and permissions in code; never invent a journey.
2. **Minimize friction:** Use clear page titles, action labels, field hints, sensible grouping, and predictable button placement. Avoid redundant clicks and confusing choices, but do not remove required checks, confirmations, or existing steps without approval.
3. **Maintain context:** Preserve scroll position, relevant search/filter state, form inputs, selected tabs, and navigation context when technically appropriate. Do not silently introduce persistent state or changed navigation semantics.
4. **Immediate feedback:** Every interaction must show an understandable hover/focus/pressed/selected/disabled/busy state. For async actions, prevent accidental duplicate submissions and show progress and eventual success/error feedback using existing patterns.
5. **Smooth transitions:** Prefer subtle opacity/transform animations and restrained stagger; coordinate panel, modal, drawer, list, and page transitions. Avoid layout shift, animation queues, excessive delays, and motion that blocks the next action. Honor reduced-motion preferences.
6. **Loading without jank:** Use shape-matched skeletons for asynchronous content and the documented ~600 ms minimum *once a skeleton is shown*. Never artificially hold already-ready content just to display a skeleton. Prevent flashes, jumping controls, and double loaders.
7. **Forms and validation:** Use clear required indicators, appropriate input types, inline validation at helpful moments, preserved user input on recoverable errors, accessible error messages, and clear next steps. Do not change validation or backend contracts without approval.
8. **Destructive and consequential actions:** Keep existing confirmations and safeguards, explain consequences clearly, and make cancellation obvious. Do not weaken permissions, security, or auditability for a smoother-looking flow.
9. **Responsive continuity:** Ensure touch targets, keyboard navigation, focus management, overlays, scrolling, and long content work on mobile, tablet, and desktop. No hover-only critical actions.
10. **Recovery and closure:** Every journey should have useful empty/error states, retry or back paths where supported, and a clear completion state. Users should know what happened and what to do next.

**Flow QA requirement:** Walk through at least one realistic happy path and relevant empty, loading, error, cancellation, and mobile scenarios for each affected workflow. Check whether a first-time user can finish without guessing. Fix UI-only friction; document functional gaps for approval.

**Professional enhancement audit:** In affected areas, check for missing industry-standard affordances such as breadcrumbs, contextual help, saved views, bulk actions, export, undo, keyboard shortcuts, notification preferences, audit history, and accessible feedback. Recommend only genuinely useful, verified gaps. Never add new product features or alter flows without approval.

## 13. Change approval boundaries

**Allowed without further approval:** spacing, alignment, hierarchy, token-consistent styling, icon alignment, visual hover/focus/press feedback, responsive layout polish, nonblocking transitions, and accessible presentation improvements.

**Ask first:** changing route destinations, navigation structure, business terminology, button meanings, information visibility, role-based capabilities, form fields, workflow steps, API usage, data storage, third-party dependencies, or existing features—even if the proposed change seems like better UX.

**Never:** silently remove functionality, change business logic, invent data, weaken security/accessibility, replace the current theme, or introduce an unrelated redesign.

## 14. Definition of done

A UI task is complete only when:

- [ ] Existing SimeTown theme tokens, palette, fonts, and brand assets are preserved.
- [ ] Data is logically grouped, consistently labeled, scannable, and prioritized for the user’s task.
- [ ] Affected end-to-end flows feel smooth, intuitive, predictable, and recoverable across devices.
- [ ] Screen looks polished, premium, corporate, and visually consistent with related screens.
- [ ] Appropriate hover, press, focus, and transition states are refined.
- [ ] Reduced-motion and touch interactions are supported.
- [ ] Desktop, tablet, and mobile layouts remain usable.
- [ ] Existing features, roles, routes, integrations, and business rules are unchanged.
- [ ] Skeletons for async content are layout-matched, accessible, and honor the ~600 ms minimum once shown without delaying ready data.
- [ ] Large data views have existing search/filter/sort/pagination polished, or missing functionality is documented for approval.
- [ ] Verified professional UX gaps are reported with impact and approval boundaries.
- [ ] Loading, empty, error, success, and disabled states remain correct.
- [ ] Relevant tests/checks have run or limitations are explicitly reported.
- [ ] The final report identifies visual changes and confirms functionality preservation.

## 15. Standing instruction to Claude

**Before any UI/UX change, read this document and inspect the live repository's theme and affected feature behavior. Make the smallest cohesive, premium, corporate visual improvement that preserves SimeTown's current brand palette and all functionality. Use purposeful, interactive motion where appropriate. Verify responsiveness, accessibility, and regressions. Apply the 600 ms skeleton policy, organize all presented data with clear information hierarchy, audit large lists for industrial-grade search/filter/sort/pagination, verify smooth and user-friendly end-to-end flows, and proactively recommend verified missing enterprise UX conventions. If a desired improvement requires a functional change, propose it and request approval rather than assuming permission.**
