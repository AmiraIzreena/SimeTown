# English and Bahasa Malaysia

The language switch is available on public pages and in every signed-in role's shell. The browser remembers the choice in `kita.lang`; signed-in changes also save through `/me/language`. The account preference is restored when entering a signed-in area. Changing language updates the current screen without reloading forms.

Application copy uses English source strings with Malay entries in `src/lib/i18n-messages.ts` and `src/lib/i18n-extra.ts`. Dynamic messages use `src/lib/i18n-templates.ts`. `src/lib/i18n-core.ts` contains the pure lookup and formatting functions; `src/lib/i18n.ts` provides React hooks and preference storage.

- Wrap application text in `<Text>` from `@/components/ui/localized-text`, or call `useT()` inside client components. Keep whole sentences together where possible.
- Shared buttons, fields, tables, dialogs, feedback and toasts translate their display text. Localized elements translate accessibility labels, placeholders, titles and image descriptions without changing form values or URLs.
- Add a Malay entry when introducing new copy. Keep every interpolation placeholder in the translation. Avoid broad templates that could match ordinary names or personal messages.
- Render user-authored reports, posts, names, addresses, campaign descriptions and other free text verbatim. This feature translates the interface, not people's submissions.
- Do not translate database enum values, API payloads, IDs, links or input values.

Run `npm run i18n:audit` to list any interface text without a Malay entry, or shown without passing through translation (pages, components, server errors and notifications, the Assistant's answers and flood messages). The test suite runs the same audit, so new English-only text fails the build; words that are meant to be the same in both languages are listed in `ALLOWED` in `scripts/i18n-audit.ts`. A sentence or a date inside a templated message ("Water is at 92%.", "Tue, 3 Nov") is translated too, while text written by people or the township, such as a safe route, stays as written.

Run `npm.cmd run check` to validate types, lint and tests. `tests/i18n.test.ts` checks role navigation, domain labels, template placeholders, dynamic messages and preservation of personal values. Browser checks should also cover language switching on populated forms, saved preferences, mobile dialogs and every role. Use an isolated database for interactive tests.
