# SimeTown email design

The one design every SimeTown email uses: parcel notices today; password resets, account and
township notices later. **Building a new email? Start from the template in section 6 and adjust
the content blocks. Keep the frame (logo band, card, button, footer) exactly as it is.**

Preview of the parcel emails: the *Parcel lockers: emails and screens* artifact shared with the team.

---

## 1. Principles

1. **One look for every email.** Same logo band, card, type, button and footer. Only the content
   blocks change.
2. **The app holds anything sensitive.** Never put a pickup PIN, QR code, password, one-time code,
   IC number or full address in an email. Link to the app instead. A forwarded or stolen email
   must not open a door or an account.
3. **Plain, professional wording.** It should sound like a premium property developer's township
   office: courteous, short sentences, no slang, no exclamation marks, no emoji.
4. **Works everywhere.** Gmail (web and app), Outlook, Apple Mail; phones first. Use table layout and
   inline CSS. No SVG, no web fonts you rely on, no JavaScript, no background images.
5. **Accessible.** Real text (not text in images), at least 14 px body text, 4.5:1 contrast, alt text
   on the logo, `lang` set to the resident's language.

---

## 2. Brand assets

| Asset | File | Use |
| --- | --- | --- |
| SimeTown mark, with "SimeTown" written on it | `public/email/simetown-mark@2x.png` (272 × 204) | The logo in every email, shown at **68 × 51 px** |
| Same, larger | `public/email/simetown-mark@4x.png` (544 × 408) | Only if a layout needs it bigger than 100 px wide |

- The PNGs are rendered from the app's own vector mark (`src/components/shell/logo.tsx`): the red,
  orange and yellow squircles with **SimeTown** in white. Do not redraw, recolour, stretch or crop
  it, and never use Sime Darby Property's own logo.
- **Embed the logo as an inline attachment** (`cid:simetown-mark`, see section 7), so it shows even
  when the email client blocks remote images.
- `alt="SimeTown"`. The word **SimeTown** also appears as live text beside the mark, in white.
- If the mark ever changes in `logo.tsx`, render the PNGs again from it (transparent background,
  2× and 4×).

---

## 3. Colours and type

Taken from the app theme (`src/app/globals.css`). Use the hex values inline; email clients do not
read CSS variables.

| Role | Token | Hex |
| --- | --- | --- |
| Brand band, gradient start | brand-950 | `#2d1407` |
| Brand band, gradient end / solid fallback | brand-800 | `#7a2f0d` |
| Primary button, links | brand-700 | `#9f4312` |
| Info pill background / text | brand-50 / brand-700 | `#fff7f0` / `#9f4312` |
| Security band and button | accent-700 | `#970f21` (band gradient from `#4a0710`) |
| Alert pill background / text | accent-50 / accent-700 | `#fdf1f2` / `#970f21` |
| Success pill background / text | success-50 / success-700 | `#ebf7f0` / `#14643f` |
| Warning pill, overdue box | warning-50 / warning-700 | `#fdf5e6` / `#865008` |
| Page background (behind the card) | — | `#f4f1ee` |
| Card | — | `#ffffff` |
| Heading text | ink-900 | `#131818` |
| Body text | ink-700 | `#374040` |
| Labels, footer text | ink-500 | `#677373` |
| Dividers, fact-table borders | ink-100 | `#ebeeee` |
| Note box background | ink-50 | `#f5f7f7` |

**Type.** Headings: `'Plus Jakarta Sans', Arial, Helvetica, sans-serif`, weight 800, 22 px / 1.25.
Body: `'Inter', Arial, Helvetica, sans-serif`, 15 px / 1.6. Small print: 12–13 px. Most clients fall
back to Arial, which is intended. Numbers in facts use `font-variant-numeric: tabular-nums`.

**Dark mode.** Keep the card white and the text dark. Add `<meta name="color-scheme" content="light">`
and `<meta name="supported-color-schemes" content="light">` so clients do not invert the band and logo.

---

## 4. Layout

```
┌──────────────── page background #f4f1ee ────────────────┐
│ ┌──────────── card, max 560 px, radius 16 ────────────┐ │
│ │ [mark] SimeTown                         Elmina Valley│ │  ← brand band (or red "Security alert" band)
│ ├──────────────────────────────────────────────────────┤ │
│ │ ● Status pill                                        │ │
│ │ Heading: what happened, in one line                  │ │
│ │ Hi {first name}, one or two sentences of context.    │ │
│ │ ┌ facts table ───────────────────────────────────┐  │ │
│ │ │ Label            Value                         │  │ │
│ │ └────────────────────────────────────────────────┘  │ │
│ │ [ Primary button ]                                   │ │
│ │ ⓘ Note box: one helpful tip or a safety line         │ │
│ ├──────────────────────────────────────────────────────┤ │
│ │ SimeTown · Township app for City of Elmina           │ │  ← footer
│ │ Why you got this · how to manage emails              │ │
│ │ This is an automated message. Please do not reply.   │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

| Block | Rules |
| --- | --- |
| Preheader | Hidden first line, about 90 characters, adds to the subject (shown in the inbox list). |
| Brand band | Mark (68 × 51) + "SimeTown" (white, 18 px, 800). Right side: the township area (e.g. *Elmina Valley*) or, for alerts, *Security alert*. Padding 18 × 24 px. |
| Status pill | One of: *Ready to collect* (success), *At the guardhouse* (info), *Overdue* (warning), *Security alert* (alert), *Action needed* (warning), *Account* (info). Optional. |
| Heading | What happened, as a statement: "Your parcel is ready in your locker". Max about 60 characters. |
| Greeting and context | "Hi {first name}," then one or two sentences. First name only. |
| Facts table | 2–4 rows of label + value. Labels in ink-500, values in ink-900. Stack to one column under 480 px. Never sensitive values (see principle 2). |
| Highlight (optional) | A big number in the warning box, e.g. **7** *days uncollected*. |
| Primary button | One per email. Brand-700 (accent-700 for security), white text, 12 × 20 px padding, radius 10 px, min 44 px tall. Label is an action: *Get my pickup code*, *View my parcel*, *Reset my password*. |
| Note box | Optional. One short line: a tip, the reminder rhythm, or a safety reassurance. |
| Footer | Line 1 bold: *SimeTown · Township app for City of Elmina*. Then why they got it, and how to manage emails (*Account › Notifications*), unless it is a security or account email, which is always sent. Last line: *This is an automated message. Please do not reply.* |

---

## 5. Wording

- **Sender:** `SimeTown <{SMTP_USER}>`. Reply-To: the township office address, when there is one.
- **Subject:** sentence case, no full stop, under about 60 characters, says what happened:
  *Your parcel is ready in your locker* · *Your parcel is at the guardhouse* ·
  *Reminder: your parcel has been waiting for 7 days* · *Security alert: your locker door was opened
  without a code* · *Reset your SimeTown password*.
- **Language:** send in the resident's chosen language (English or Bahasa Malaysia). Take every line
  from the i18n catalogues (`src/lib/i18n-*.ts`) so the email and the app say the same thing; add the
  Malay entry with the English one, and run `npm run i18n:audit`.
- **Dates and times:** township time (Asia/Kuala_Lumpur), e.g. *Mon, 20 Oct 2026, 10:02 am*. Hours as
  *8:00 am – 10:00 pm*.
- **Names:** the courier company, the locker and the counter by name. The resident by first name only.
- **Tone:** say what happened, what to do next, and (for problems) that someone is already on it.
  Avoid blame ("you failed to collect"); prefer "has not been collected yet".
- **No fees.** Do not mention charges. The late-collection charge is a planned feature only.

---

## 6. The template

Copy this file, replace the `{{…}}` placeholders, and delete the optional blocks you do not need.
Everything is inline and table-based on purpose.

```html
<!doctype html>
<html lang="{{lang}}" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>{{subject}}</title>
  <style>
    @media (max-width: 480px) {
      .px { padding-left: 18px !important; padding-right: 18px !important; }
      .fact-label, .fact-value { display: block !important; width: auto !important; }
      .fact-label { padding-bottom: 0 !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f4f1ee;">
  <!-- Preheader: shown in the inbox list, hidden in the email -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4f1ee;">{{preheader}}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ee;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">

        <!-- Brand band. Security emails: background #970f21 and
             background-image:linear-gradient(120deg,#4a0710,#970f21) -->
        <tr><td class="px" style="padding:18px 24px;background:#7a2f0d;background-image:linear-gradient(120deg,#2d1407,#7a2f0d 70%,#9f4312);">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;">
              <img src="cid:simetown-mark" width="68" height="51" alt="SimeTown" style="display:inline-block;vertical-align:middle;border:0;">
              <span style="display:inline-block;vertical-align:middle;margin-left:10px;font:800 18px/1 'Plus Jakarta Sans',Arial,Helvetica,sans-serif;color:#ffffff;">SimeTown</span>
            </td>
            <td align="right" style="vertical-align:middle;font:12px/1.4 Arial,Helvetica,sans-serif;color:#ffffff;opacity:.8;">{{band_label}}</td>
          </tr></table>
        </td></tr>

        <!-- Body -->
        <tr><td class="px" style="padding:26px 26px 8px;font:15px/1.6 'Inter',Arial,Helvetica,sans-serif;color:#374040;">

          <!-- Status pill (optional). Colours: success #ebf7f0/#14643f, info #fff7f0/#9f4312,
               warning #fdf5e6/#865008, alert #fdf1f2/#970f21 -->
          <span style="display:inline-block;padding:4px 11px;border-radius:999px;background:#ebf7f0;color:#14643f;font:600 12px/1.4 Arial,Helvetica,sans-serif;">&#9679;&nbsp;{{status}}</span>

          <h1 style="margin:14px 0 0;font:800 22px/1.25 'Plus Jakarta Sans',Arial,Helvetica,sans-serif;color:#131818;">{{heading}}</h1>
          <p style="margin:12px 0 0;">Hi {{first_name}}, {{context}}</p>

          <!-- Highlight (optional), e.g. days uncollected -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;background:#fdf5e6;border-radius:12px;"><tr>
            <td style="padding:14px 16px;color:#865008;">
              <span style="font:800 34px/1 'Plus Jakarta Sans',Arial,Helvetica,sans-serif;">{{big_number}}</span>
              <span style="margin-left:8px;">{{big_number_label}}</span>
            </td>
          </tr></table>

          <!-- Facts: 2 to 4 rows, never a PIN, password or code -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border:1px solid #ebeeee;border-radius:12px;">
            <tr>
              <td class="fact-label" width="150" style="padding:10px 14px;font-size:14px;color:#677373;">{{label_1}}</td>
              <td class="fact-value" style="padding:10px 14px;font-size:14px;color:#131818;font-weight:500;">{{value_1}}</td>
            </tr>
            <tr>
              <td class="fact-label" width="150" style="padding:10px 14px;font-size:14px;color:#677373;border-top:1px solid #ebeeee;">{{label_2}}</td>
              <td class="fact-value" style="padding:10px 14px;font-size:14px;color:#131818;font-weight:500;border-top:1px solid #ebeeee;">{{value_2}}</td>
            </tr>
          </table>

          <!-- Primary button (bulletproof). Security emails: background #970f21 -->
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:18px;"><tr>
            <td style="border-radius:10px;background:#9f4312;">
              <a href="{{action_url}}" style="display:inline-block;padding:12px 20px;font:600 15px/1.4 Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none;border-radius:10px;">{{action_label}}</a>
            </td>
          </tr></table>

          <!-- Note (optional) -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;background:#f5f7f7;border-radius:12px;"><tr>
            <td style="padding:12px 14px;font-size:13px;line-height:1.5;color:#4c5757;">{{note}}</td>
          </tr></table>

        </td></tr>

        <!-- Footer -->
        <tr><td class="px" style="padding:18px 26px 22px;border-top:1px solid #ebeeee;font:12px/1.6 Arial,Helvetica,sans-serif;color:#677373;">
          <strong style="color:#374040;">SimeTown · Township app for City of Elmina</strong><br>
          {{why_you_got_this}}<br>
          This is an automated message. Please do not reply.
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
```

Always send a **plain-text part** too, with the same words and the link written out.

---

## 7. Sending: the email module

It is already built, in `src/server/modules/email/`. **Use it; do not call nodemailer yourself.**

| File | What it does |
| --- | --- |
| `layout.ts` | `renderEmail(content)`: the frame in section 6, filled in, escaped and translated, plus the plain-text part |
| `outbox.ts` | `queueEmails(...)` writes an email to the outbox inside the event's transaction; `sendQueuedEmails` sends what is due (the `lockers` and `emails` jobs call it); `cleanupEmails` keeps the words 30 days and the record 180 days |
| `parcels.ts` | The four parcel emails, as examples to copy |

**Adding a new email (for example a password reset):**

1. Add its kind to the `kind` check in a new migration and to `EmailKind` in `outbox.ts`.
2. Write a builder like those in `parcels.ts`: return the content blocks (subject, heading, intro,
   facts, button, note, footer) in English; `renderEmail` translates them through the catalogue.
3. Add the Malay lines to `src/lib/i18n-*.ts` and run `npm run i18n:audit`.
4. Call it where the event happens, inside the same transaction, with a dedupe key unique to that
   event. Pass `{ always: true }` only for security and account emails.
5. Add a test like `tests/email.test.ts`.

**Turning sending on.** The account lives only in `.env` (never in code, chat or Git):

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your-account@gmail.com
SMTP_PASS=<16-character Google App Password>
```

For Gmail: turn on 2-Step Verification for the account, then create an App Password (Google
Account › Security › App passwords) and paste it as `SMTP_PASS`. Restart the app. Until these are
set, emails wait in the outbox, and any that waited more than a day are skipped rather than sent late.

How it behaves:

- The logo is attached to each email (`cid:simetown-mark`), so it shows even when images are blocked.
- Addresses on reserved test domains (`.test`, `.example`, `.invalid`, `.localhost`, so all the
  demo accounts) are never sent to.
- A failed send is retried twice (10 and 20 minutes later), then marked failed with the mail
  server's answer. Credentials are never logged.
- Links point to the app's own pages on `APP_URL`; `renderEmail` refuses anything that is not a web link.
- Gmail allows about **500 recipients a day**. A larger township needs a transactional email
  provider; only the transport in `outbox.ts` changes, the template stays the same.
- Residents switch parcel emails off under *Account › Emails*. Security alerts are always sent.

---

## 8. Examples

| Email | Pill | Heading | Facts | Button |
| --- | --- | --- | --- | --- |
| Parcel in the locker | Ready to collect | Your parcel is ready in your locker | Locker · Your door · Tracking no. · Delivered | Get my pickup code |
| Locker parcel at the guardhouse | At the guardhouse | Your parcel is waiting at the guardhouse | Collect at · Opening hours · Reason · Please bring | Get my pickup code |
| Parcel left with the guard | At the guardhouse | Your parcel is waiting at the guardhouse | Collect at · Shelf · Opening hours · Arrived | Get my collection code |
| Overdue reminder (weekly) | Overdue | Your parcel has not been collected yet | Big number: days uncollected; Collect at · Opening hours · Tracking no. | View my parcel |
| Door opened without a code | Security alert (red band) | Your locker door was opened without a code | Locker · Time · Parcels inside | View locker activity |
| Password reset (future) | Account | Reset your SimeTown password | Requested · Expires in (e.g. 30 minutes) | Reset my password |

For a password reset: the link carries a single-use, short-lived token; say "If you did not ask for
this, you can ignore this email. Your password stays the same." in the note box; never include the
old or new password.

---

## 9. Checklist before shipping a new email

- [ ] Built from the template; frame unchanged; logo is `cid:simetown-mark` at 68 × 51 with `alt="SimeTown"`.
- [ ] No PIN, QR, password, one-time code or full address in the email.
- [ ] Subject, preheader, heading and button follow section 5; one primary button.
- [ ] English and Malay text in the i18n catalogues; `npm run i18n:audit` passes.
- [ ] All values escaped; links use the configured app domain.
- [ ] Plain-text part included.
- [ ] Checked in Gmail (web and phone) and Outlook, in light and dark mode, at 360 px wide.
- [ ] Sent from a background job, once per event, respecting notification preferences.
