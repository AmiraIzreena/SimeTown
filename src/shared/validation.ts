/**
 * Field messages people read. The server's schemas use them, the browser's own checks use the same
 * words, and anything unexpected falls back to CHECK_FIELD, so a validator's technical wording
 * ("Too small: expected string to have >=2 characters") can never reach a screen.
 */
export const FIELD_MESSAGES = {
  required: 'Please fill in this field.',
  check: 'Please check this field.',
  choose: 'Please choose one of the options.',
  number: 'Please enter a number.',
  larger: 'Please enter a larger number.',
  smaller: 'Please enter a smaller number.',
  url: 'Please enter a full web address, starting with https://.',
  fullName: 'Please enter your full name (at least 2 characters).',
  email: 'Please enter a valid email address.',
  phone: 'Enter a valid phone number, such as 012-345 6789.',
  township: 'Please choose your township.',
  address: 'Please choose your address.',
  occupancy: 'Please choose owner or tenant.',
  password: 'Use at least 10 characters.',
  terms: 'Please read and accept the Terms of Use and Privacy Notice.',
  postcode: 'Enter the 5-digit postcode.',
  state: 'Choose a state.',
} as const;

export const CHECK_FIELD = FIELD_MESSAGES.check;
export const atLeastCharacters = (n: number | bigint) => `Please enter at least ${n} characters.`;
export const atMostCharacters = (n: number | bigint) => `Please keep this to ${n} characters or fewer.`;

/** What Zod tells us about one problem (only the parts we use). This file has no Zod import, so the browser can use it cheaply. */
export interface Issue {
  code: string;
  input?: unknown;
  origin?: string;
  format?: string;
  expected?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
}

/** A friendly message for any check that does not carry its own. The server installs it for every schema (http/zod-messages.ts). */
export function friendlyIssue(issue: Issue): string {
  const empty = issue.input === undefined || issue.input === null || (typeof issue.input === 'string' && issue.input.trim() === '');
  switch (issue.code) {
    case 'invalid_type':
      if (empty) return FIELD_MESSAGES.required;
      return issue.expected === 'number' ? FIELD_MESSAGES.number : CHECK_FIELD;
    case 'too_small':
      if (issue.origin === 'string') return empty || Number(issue.minimum) <= 1 ? FIELD_MESSAGES.required : atLeastCharacters(issue.minimum!);
      if (issue.origin === 'number' || issue.origin === 'int' || issue.origin === 'bigint') return FIELD_MESSAGES.larger;
      return CHECK_FIELD;
    case 'too_big':
      if (issue.origin === 'string') return atMostCharacters(issue.maximum!);
      if (issue.origin === 'number' || issue.origin === 'int' || issue.origin === 'bigint') return FIELD_MESSAGES.smaller;
      return CHECK_FIELD;
    case 'invalid_format':
      if (issue.format === 'email') return FIELD_MESSAGES.email;
      if (issue.format === 'url') return FIELD_MESSAGES.url;
      if (issue.format === 'uuid' || issue.format === 'guid') return FIELD_MESSAGES.choose;
      return empty ? FIELD_MESSAGES.required : CHECK_FIELD;
    case 'invalid_value':
      return FIELD_MESSAGES.choose;
    default:
      return CHECK_FIELD;
  }
}

/** Wording only a validator writes: "expected", "received", "Too small", "Invalid input", ">=2". */
const TECHNICAL = /\b(expected|received)\b|^(too (small|big)|invalid)\b|[<>]=?\s*\d|\bNaN\b|\bundefined\b/i;

/** The last line of defence: a message that still reads like a validator's becomes "Please check this field." */
export function friendlyFieldMessage(message: string | null | undefined): string {
  return !message || TECHNICAL.test(message) ? CHECK_FIELD : message;
}

export function friendlyFields(fields: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(fields ?? {}).map(([name, message]) => [name, friendlyFieldMessage(message)]));
}
