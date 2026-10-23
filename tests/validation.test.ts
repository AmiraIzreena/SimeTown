import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiError } from '@/lib/api';
import '@/server/http/zod-messages';
import { afterBlur, onSubmitCheck, rules, shownFields } from '@/lib/field-checks';
import { CHECK_FIELD, FIELD_MESSAGES as M, friendlyFieldMessage, friendlyFields } from '@/shared/validation';

/** Field messages people read: friendly wording, shown at the right moment, and never a validator's own text. */

const TECHNICAL = /expected|received|too small|too big|invalid input|invalid option|[<>]=/i;

describe('Every schema speaks plainly', () => {
  it('turns checks without their own message into friendly sentences', () => {
    const schema = z.object({ title: z.string().trim().min(3).max(5), count: z.number().int().positive().max(9), id: z.uuid(), pick: z.enum(['A', 'B']), site: z.url() });
    const messages = (input: unknown) => Object.fromEntries(schema.safeParse(input).error!.issues.map((i) => [i.path.join('.'), i.message]));

    expect(messages({})).toEqual({ title: M.required, count: M.required, id: M.required, pick: M.choose, site: M.required });
    expect(messages({ title: 'ab', count: 0, id: 'x', pick: 'C', site: 'nope' })).toEqual({
      title: 'Please enter at least 3 characters.', count: M.larger, id: M.choose, pick: M.choose, site: M.url,
    });
    expect(messages({ title: 'abcdefgh', count: 50, id: 'x', pick: 'A', site: 'https://a.test' })).toMatchObject({ title: 'Please keep this to 5 characters or fewer.', count: M.smaller });
    expect(messages({ title: 'abc', count: 'seven', id: 'x', pick: 'A', site: 'https://a.test' }).count).toBe(M.number);
  });

  it('keeps a message a schema gives itself', () => {
    expect(z.string().min(10, 'Use at least 10 characters.').safeParse('short').error!.issues[0]!.message).toBe('Use at least 10 characters.');
  });
});

describe('The fallback: a raw validator message never reaches the screen', () => {
  it.each([
    'Too small: expected string to have >=2 characters',
    'Invalid email address',
    'Invalid input: expected string, received undefined',
    'Invalid option: expected one of "OWNER"|"TENANT"',
    'Too big: expected number to be <=5000',
    'Expected number, received nan',
    '',
  ])('replaces "%s"', (raw) => {
    expect(friendlyFieldMessage(raw)).toBe(CHECK_FIELD);
  });

  it('leaves friendly messages alone, including every message the app writes itself', () => {
    for (const message of [...Object.values(M), 'Choose a date.', 'Tell the author why it was removed.']) expect(friendlyFieldMessage(message)).toBe(message);
  });

  it('cleans every field in an error from the server, wherever the browser reads it', () => {
    const error = new ApiError(400, 'VALIDATION_FAILED', 'Please check the highlighted fields.', {
      fields: { fullName: 'Too small: expected string to have >=2 characters', email: M.email, townshipId: 'Invalid input: expected string, received undefined' },
    });
    expect(error.fields).toEqual({ fullName: CHECK_FIELD, email: M.email, townshipId: CHECK_FIELD });
    expect(friendlyFields(undefined)).toEqual({});
  });
});

describe('The sign-up form shows errors only after leaving a field or pressing submit', () => {
  const register = {
    fullName: rules.fullName, email: rules.email, phone: rules.phone,
    townshipId: rules.chosen(M.township), homeId: rules.chosen(M.address), password: rules.password, acceptTerms: rules.terms,
  };

  it('shows nothing on a fresh, empty form', () => {
    expect(shownFields({}, {})).toEqual({});
  });

  it('checks a field when the person leaves it, and clears the message once it is fixed', () => {
    let local = afterBlur({}, {}, 'fullName', '', register.fullName);
    expect(shownFields({}, local)).toEqual({ fullName: M.fullName });
    local = afterBlur(local, {}, 'email', 'aisyah@', register.email);
    expect(shownFields({}, local)).toEqual({ fullName: M.fullName, email: M.email });
    local = afterBlur(local, {}, 'fullName', 'Aisyah Rahman', register.fullName);
    expect(shownFields({}, local)).toEqual({ email: M.email });
  });

  it('checks every field when submit is pressed, with the same words as the server', () => {
    const empty = onSubmitCheck(register, () => '');
    expect(empty).toEqual({
      fullName: M.fullName, email: M.email, phone: M.phone, townshipId: M.township, homeId: M.address, password: M.password, acceptTerms: M.terms,
    });
    for (const message of Object.values(empty)) expect(message).not.toMatch(TECHNICAL);
    const filled: Record<string, string> = { fullName: 'Aisyah Rahman', email: 'aisyah@kita.test', phone: '012-345 6789', townshipId: 't', homeId: 'h', password: 'long enough pass', acceptTerms: 'on' };
    expect(onSubmitCheck(register, (name) => filled[name] ?? '')).toEqual({});
  });

  it("keeps the server's answer until that field changes", () => {
    const server = { email: 'This email is already registered.' };
    const sent = { email: 'aisyah@kita.test' };
    // Leaving the field without changing it keeps the server's message.
    expect(shownFields(server, afterBlur({}, sent, 'email', 'aisyah@kita.test', register.email))).toEqual(server);
    // A new, valid address replaces it.
    expect(shownFields(server, afterBlur({}, sent, 'email', 'aisyah.r@kita.test', register.email))).toEqual({});
  });
});
