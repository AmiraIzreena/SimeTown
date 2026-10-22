import { translateMessage, type Lang } from '@/lib/i18n-core';

/**
 * The one SimeTown email frame (docs/EMAIL_DESIGN.md): logo band, white card, status pill, heading, facts,
 * one button, a note and the footer. Table layout and inline styles, so Gmail, Outlook and Apple Mail show it the
 * same way. Every value is escaped; every fixed line goes through the translation catalogue, so an email reads
 * like the app in the resident's language.
 */

/** The logo is attached to each email under this id and shown with src="cid:simetown-mark". */
export const LOGO_CID = 'simetown-mark';

export type Tone = 'success' | 'info' | 'warning' | 'alert';

export interface EmailContent {
  lang: Lang;
  subject: string;
  /** The inbox preview line after the subject. */
  preheader: string;
  /** "brand" for everyday emails, "alert" for security emails (red band and button). */
  band?: 'brand' | 'alert';
  bandLabel: string;
  status?: { tone: Tone; label: string };
  heading: string;
  /** "Hi {name}," is added in front. */
  firstName: string | null;
  intro: string;
  highlight?: { value: string; label: string };
  facts: { label: string; value: string }[];
  action: { label: string; url: string };
  note?: string;
  /** Why the person got this email, and how to stop it (left out for security emails, which are always sent). */
  footer: string;
}

const PILL: Record<Tone, [string, string]> = {
  success: ['#ebf7f0', '#14643f'],
  info: ['#fff7f0', '#9f4312'],
  warning: ['#fdf5e6', '#865008'],
  alert: ['#fdf1f2', '#970f21'],
};

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Only links to the app's own pages are ever put in an email. */
function safeUrl(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Email links must be web links.');
  return parsed.toString();
}

export function renderEmail(c: EmailContent): { subject: string; html: string; text: string } {
  const t = (text: string) => translateMessage(c.lang, text);
  const e = (text: string) => escape(text);
  const url = safeUrl(c.action.url);
  const alert = c.band === 'alert';
  const accent = alert ? '#970f21' : '#9f4312';
  const band = alert
    ? 'background:#970f21;background-image:linear-gradient(120deg,#4a0710,#970f21);'
    : 'background:#7a2f0d;background-image:linear-gradient(120deg,#2d1407,#7a2f0d 70%,#9f4312);';
  const greeting = c.firstName ? t('Hi {name},').replace('{name}', c.firstName) : t('Hello,');
  const subject = t(c.subject);
  const footerLines = [t('SimeTown · Township app for City of Elmina'), t(c.footer), t('This is an automated message. Please do not reply.')];

  const facts = c.facts.map((f, i) => {
    const border = i === 0 ? '' : 'border-top:1px solid #ebeeee;';
    return `<tr><td class="fact-label" width="150" style="padding:10px 14px;font-size:14px;color:#677373;${border}">${e(t(f.label))}</td>`
      + `<td class="fact-value" style="padding:10px 14px;font-size:14px;color:#131818;font-weight:500;${border}">${e(f.value)}</td></tr>`;
  }).join('');
  const [pillBg, pillFg] = c.status ? PILL[c.status.tone] : ['', ''];

  const html = `<!doctype html>
<html lang="${c.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${e(subject)}</title>
<style>@media (max-width:480px){.px{padding-left:18px!important;padding-right:18px!important}.fact-label,.fact-value{display:block!important;width:auto!important}.fact-label{padding-bottom:0!important}}</style>
</head>
<body style="margin:0;padding:0;background:#f4f1ee;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4f1ee;">${e(t(c.preheader))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ee;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td class="px" style="padding:18px 24px;${band}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle;"><img src="cid:${LOGO_CID}" width="68" height="51" alt="SimeTown" style="display:inline-block;vertical-align:middle;border:0;"><span style="display:inline-block;vertical-align:middle;margin-left:10px;font:800 18px/1 'Plus Jakarta Sans',Arial,Helvetica,sans-serif;color:#ffffff;">SimeTown</span></td>
<td align="right" style="vertical-align:middle;font:12px/1.4 Arial,Helvetica,sans-serif;color:#ffffff;opacity:.8;">${e(t(c.bandLabel))}</td>
</tr></table>
</td></tr>
<tr><td class="px" style="padding:26px 26px 8px;font:15px/1.6 'Inter',Arial,Helvetica,sans-serif;color:#374040;">
${c.status ? `<span style="display:inline-block;padding:4px 11px;border-radius:999px;background:${pillBg};color:${pillFg};font:600 12px/1.4 Arial,Helvetica,sans-serif;">&#9679;&nbsp;${e(t(c.status.label))}</span>` : ''}
<h1 style="margin:14px 0 0;font:800 22px/1.25 'Plus Jakarta Sans',Arial,Helvetica,sans-serif;color:#131818;">${e(t(c.heading))}</h1>
<p style="margin:12px 0 0;">${e(greeting)} ${e(t(c.intro))}</p>
${c.highlight ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;background:#fdf5e6;border-radius:12px;"><tr><td style="padding:14px 16px;color:#865008;"><span style="font:800 34px/1 'Plus Jakarta Sans',Arial,Helvetica,sans-serif;">${e(c.highlight.value)}</span><span style="margin-left:8px;">${e(t(c.highlight.label))}</span></td></tr></table>` : ''}
${facts ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border:1px solid #ebeeee;border-radius:12px;">${facts}</table>` : ''}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:18px;"><tr><td style="border-radius:10px;background:${accent};"><a href="${e(url)}" style="display:inline-block;padding:12px 20px;font:600 15px/1.4 Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none;border-radius:10px;">${e(t(c.action.label))}</a></td></tr></table>
${c.note ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;background:#f5f7f7;border-radius:12px;"><tr><td style="padding:12px 14px;font-size:13px;line-height:1.5;color:#4c5757;">${e(t(c.note))}</td></tr></table>` : ''}
</td></tr>
<tr><td class="px" style="padding:18px 26px 22px;border-top:1px solid #ebeeee;font:12px/1.6 Arial,Helvetica,sans-serif;color:#677373;"><strong style="color:#374040;">${e(footerLines[0]!)}</strong><br>${e(footerLines[1]!)}<br>${e(footerLines[2]!)}</td></tr>
</table>
</td></tr></table>
</body>
</html>`;

  // The plain-text part: the same words, with the link written out.
  const text = [
    t(c.heading),
    '',
    `${greeting} ${t(c.intro)}`,
    ...(c.highlight ? ['', `${c.highlight.value} ${t(c.highlight.label)}`] : []),
    ...(c.facts.length ? ['', ...c.facts.map((f) => `${t(f.label)}: ${f.value}`)] : []),
    '',
    `${t(c.action.label)}: ${url}`,
    ...(c.note ? ['', t(c.note)] : []),
    '',
    '--',
    ...footerLines,
  ].join('\n');
  return { subject, html, text };
}
