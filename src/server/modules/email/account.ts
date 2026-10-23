import { translateMessage } from '@/lib/i18n-core';
import type { Queryable } from '../../db/client';
import { appLink, queueEmails } from './outbox';
import { when } from './parcels';

/**
 * Account emails, in the design every SimeTown email shares (docs/EMAIL_DESIGN.md). They are always sent, whatever
 * the person's email preferences. They never carry a password: the reset email carries a single-use link that
 * expires, and the link's token sits after "#" so it never reaches a server's logs.
 */

const RESET_FOOTER = 'You received this because a password reset was asked for with this email address. Account emails are always sent.';
const WELCOME_FOOTER = 'You received this because a SimeTown account was created with this email address. Account emails are always sent.';

/** A resident has just created their account. */
export function emailWelcome(q: Queryable, userId: string, p: { email: string; township: string; at: Date }) {
  return queueEmails(q, [userId], 'ACCOUNT_CREATED', (lang) => ({
    subject: 'Welcome to SimeTown',
    preheader: 'Your account is ready. Your township office will confirm your home next.',
    bandLabel: 'Account',
    status: { tone: 'success', label: 'Account created' },
    heading: 'Your SimeTown account is ready',
    intro: `thank you for joining SimeTown in ${p.township}. Your account has been created, and your township office will now confirm your home.`,
    facts: [
      { label: 'Account email', value: p.email },
      { label: 'Township', value: p.township },
      { label: 'Created', value: when(p.at, lang) },
      { label: 'Your home', value: translateMessage(lang, 'Waiting for the township office to confirm') },
    ],
    action: { label: 'Open SimeTown', url: appLink('/app') },
    note: 'You can look around the app now. Earning and spending points starts once your home is confirmed. If you did not create this account, contact the township office.',
    footer: WELCOME_FOOTER,
  }), `email-welcome:${userId}`, { always: true }, p.at);
}

/** Someone asked to reset this account's password. `token` is the single-use secret; `id` names this request. */
export function emailPasswordReset(q: Queryable, userId: string, p: { id: string; email: string; token: string; minutes: number; at: Date }) {
  return queueEmails(q, [userId], 'PASSWORD_RESET', (lang) => ({
    subject: 'Reset your SimeTown password',
    preheader: `This link works once and expires in ${p.minutes} minutes.`,
    bandLabel: 'Account',
    status: { tone: 'info', label: 'Account' },
    heading: 'Reset your SimeTown password',
    intro: 'we received a request to reset the password for your SimeTown account. Choose a new one with the button below.',
    facts: [
      { label: 'Account email', value: p.email },
      { label: 'Requested', value: when(p.at, lang) },
      { label: 'Expires in', value: translateMessage(lang, `${p.minutes} minutes`) },
    ],
    action: { label: 'Reset my password', url: appLink(`/reset-password#${p.token}`) },
    note: 'If you did not ask for this, you can ignore this email. Your password stays the same.',
    footer: RESET_FOOTER,
  }), `email-password-reset:${p.id}`, { always: true }, p.at);
}
