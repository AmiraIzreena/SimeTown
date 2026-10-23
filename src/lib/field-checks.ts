import { useCallback, useState, type FocusEvent } from 'react';
import { normalizePhone } from '@/shared/domain';
import { FIELD_MESSAGES as M, atLeastCharacters } from '@/shared/validation';

/** One field's check in the browser: the message to show, or null when the value is fine. */
export type FieldRule = (value: string) => string | null;
export type FieldRules = Record<string, FieldRule>;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Ready-made checks, worded exactly like the server's messages. */
export const rules = {
  fullName: (v: string) => (v.trim().length >= 2 ? null : M.fullName),
  email: (v: string) => (EMAIL_SHAPE.test(v.trim()) ? null : M.email),
  phone: (v: string) => (normalizePhone(v) ? null : M.phone),
  password: (v: string) => (v.length >= 10 ? null : M.password),
  terms: (v: string) => (v ? null : M.terms),
  postcode: (v: string) => (/^\d{5}$/.test(v.trim()) ? null : M.postcode),
  chosen: (message: string): FieldRule => (v) => (v ? null : message),
  atLeast: (n: number): FieldRule => (v) => (!v.trim() ? M.required : v.trim().length >= n ? null : atLeastCharacters(n)),
};

/** Browser messages: field name → message, where '' means "checked and fine". */
type Local = Record<string, string>;

/** After the person leaves one field. A fine value that is unchanged since the last send leaves the server's answer showing. */
export function afterBlur(local: Local, sent: Record<string, string>, name: string, value: string, rule: FieldRule): Local {
  const message = rule(value) ?? '';
  const next = { ...local };
  if (!message && sent[name] === value) delete next[name];
  else next[name] = message;
  return next;
}

/** After pressing submit: every field is checked. Returns only the problems found. */
export function onSubmitCheck(fieldRules: FieldRules, values: (name: string) => string): Local {
  const found: Local = {};
  for (const [name, rule] of Object.entries(fieldRules)) {
    const message = rule(values(name));
    if (message) found[name] = message;
  }
  return found;
}

/** The messages to show, shaped like useAction's `fields`: the browser's own check wins once it has run for a field. */
export function shownFields(server: Record<string, string>, local: Local): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [name, message] of Object.entries(server)) if (!(name in local)) fields[name] = message;
  for (const [name, message] of Object.entries(local)) if (message) fields[name] = message;
  return fields;
}

const valueOf = (el: HTMLInputElement) => (el.type === 'checkbox' ? (el.checked ? 'on' : '') : el.value);

/**
 * When a form shows its field errors: a field is checked when the person leaves it, every field when
 * they press submit, and never on a fresh form. After a submit the server's messages show until the
 * person changes that field. Put `onBlur` on the <form> and call `check(form)` before sending.
 */
export function useFieldChecks(fieldRules: FieldRules, server: Record<string, string>) {
  const [local, setLocal] = useState<Local>({});
  // What each field held when it was last sent, so the server's answer stays until the value changes.
  const [sent, setSent] = useState<Record<string, string>>({});

  const onBlur = useCallback((event: FocusEvent<HTMLFormElement>) => {
    const el = event.target as unknown as HTMLInputElement; // blur bubbles up from the field that lost focus
    const rule = el.name ? fieldRules[el.name] : undefined;
    if (rule) setLocal((now) => afterBlur(now, sent, el.name, valueOf(el), rule));
  }, [fieldRules, sent]);

  /** Checks every field; true when the form may be sent. */
  const check = useCallback((form: HTMLFormElement): boolean => {
    const data = new FormData(form);
    const found = onSubmitCheck(fieldRules, (name) => String(data.get(name) ?? ''));
    setLocal(found);
    if (Object.keys(found).length) return false;
    setSent(Object.fromEntries([...data.entries()].map(([name, value]) => [name, typeof value === 'string' ? value : ''])));
    return true;
  }, [fieldRules]);

  return { onBlur, check, fields: shownFields(server, local) };
}
