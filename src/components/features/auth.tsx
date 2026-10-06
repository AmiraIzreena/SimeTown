'use client';

import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Logo } from '@/components/shell/logo';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { Checkbox, Input, Select } from '@/components/ui/field';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useHydrated } from '@/lib/use-hydrated';
import { MALAYSIAN_STATES, ROLE_HOME, type Role } from '@/shared/domain';
import { AddressPicker } from './address';
import { reloadTo } from '@/lib/navigate';

/** Two-column frame for the sign-in family of screens: form on the left, a calm brand panel on larger screens. */
export function AuthFrame({ title, intro, children, footer }: { title: string; intro: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main className="flex flex-col px-6 py-8 sm:px-10">
        <Link href="/" aria-label="KITA+ home" className="self-start rounded-md">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <div className="animate-rise">
            <h1 className="text-[28px] font-bold">{title}</h1>
            <p className="mt-2 text-[15px] text-ink-500">{intro}</p>
            <div className="mt-8">{children}</div>
            {footer && <div className="mt-8 space-y-2 text-sm text-ink-600">{footer}</div>}
          </div>
        </div>
        <nav aria-label="Legal" className="flex gap-4 text-sm text-ink-500">
          <Link href="/terms" className="hover:text-ink-800 hover:underline">
            Terms of Use
          </Link>
          <Link href="/privacy" className="hover:text-ink-800 hover:underline">
            Privacy Notice
          </Link>
        </nav>
      </main>
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-800 via-brand-900 to-brand-950 lg:block">
        <svg aria-hidden className="absolute inset-0 size-full opacity-[0.07]" preserveAspectRatio="xMidYMid slice" viewBox="0 0 600 600">
          <defs>
            <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
              <path d="M60 0H0v60" fill="none" stroke="white" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="600" height="600" fill="url(#grid)" />
          <circle cx="470" cy="140" r="170" fill="none" stroke="white" strokeWidth="1" />
          <circle cx="470" cy="140" r="250" fill="none" stroke="white" strokeWidth="1" />
        </svg>
        <div className="relative flex h-full flex-col justify-end p-14 text-white">
          <ShieldCheck className="size-10 text-brand-300" aria-hidden />
          <p className="mt-6 max-w-md font-display text-3xl font-bold leading-tight">No pool, no points.</p>
          <p className="mt-4 max-w-md text-[17px] leading-relaxed text-brand-100/90">
            Every KITA Point is paid for before a resident receives it, and the float is checked against the points residents hold every day, to the sen.
          </p>
        </div>
      </aside>
    </div>
  );
}

interface SignedIn {
  role: Role;
}

/** Only ever send people to a path inside this site. */
const safeNext = (next: string | undefined, role: Role) => (next && next.startsWith(ROLE_HOME[role]) && !next.startsWith('//') ? next : ROLE_HOME[role]);

export function LoginForm({ next }: { next?: string }) {
  const login = useAction((body: { email: string; password: string }) => api.post<SignedIn>('/auth/login', body), {
    onSuccess: (user) => reloadTo(safeNext(next, user.role)),
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void login.run({ email: String(form.get('email')), password: String(form.get('password')) });
  };
  return (
    <form onSubmit={submit} method="post" className="space-y-4" noValidate>
      <Input label="Email" name="email" type="email" autoComplete="username" required error={login.fields.email} />
      <Input label="Password" name="password" type="password" autoComplete="current-password" required error={login.fields.password} />
      <Button type="submit" size="lg" className="w-full" pending={login.pending}>
        Sign in
      </Button>
    </form>
  );
}

const useTownships = () => useApi<{ id: string; name: string }[]>('/townships');

const PHONE_HINT = 'A Malaysian mobile number, such as 012-345 6789.';

/** The consent every new account gives, with the documents one click away. */
export function TermsConsent({ error }: { error?: string }) {
  const doc = (href: string, text: string) => (
    <Link href={href} target="_blank" rel="noopener" className="font-semibold text-brand-700 underline underline-offset-2">
      {text}
    </Link>
  );
  return (
    <Checkbox
      name="acceptTerms"
      required
      error={error}
      label={
        <>
          I have read and accept the {doc('/terms', 'Terms of Use')} and the {doc('/privacy', 'Privacy Notice')}, and I agree to my personal data being used as the Privacy Notice explains.
        </>
      }
    />
  );
}

/** Form values as the API expects them: the consent box becomes true or false. */
function formBody(form: HTMLFormElement): Record<string, unknown> {
  const values: Record<string, unknown> = Object.fromEntries(new FormData(form));
  values.acceptTerms = values.acceptTerms === 'on';
  return values;
}

export function RegisterForm() {
  const townships = useTownships();
  const [townshipId, setTownshipId] = useState('');
  const register = useAction((body: Record<string, unknown>) => api.post<SignedIn>('/auth/register', body), {
    onSuccess: () => reloadTo('/app'),
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void register.run(formBody(event.currentTarget));
  };
  const f = register.fields;
  return (
    <form onSubmit={submit} method="post" className="space-y-4" noValidate>
      <Input label="Full name (as in your MyKad or passport)" name="fullName" autoComplete="name" required error={f.fullName} />
      <Input label="Email" name="email" type="email" autoComplete="email" required error={f.email} />
      <Input label="Phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" required hint={PHONE_HINT} error={f.phone} />
      <Select label="Township" name="townshipId" required error={f.townshipId} value={townshipId} onChange={(event) => setTownshipId(event.target.value)}>
        <option value="" disabled>
          {townships.data ? 'Choose your township' : 'Loading…'}
        </option>
        {townships.data?.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </Select>
      <AddressPicker key={townshipId} townshipId={townshipId || null} error={f.homeId} />
      <Select label="I am the" name="occupancy" defaultValue="OWNER" error={f.occupancy}>
        <option value="OWNER">Owner</option>
        <option value="TENANT">Tenant</option>
      </Select>
      <Input label="Password" name="password" type="password" autoComplete="new-password" hint="At least 10 characters." required error={f.password} />
      <TermsConsent error={f.acceptTerms} />
      <Button type="submit" size="lg" className="w-full" pending={register.pending}>
        Create account
      </Button>
      <p className="text-sm text-ink-500">Your home is confirmed against the property record before you can earn or spend. Tenants are confirmed by the owner or the township office.</p>
    </form>
  );
}

/** A business address: street line, postcode, city and state. Used when a shop applies and on its account page. */
export function ShopAddressFields({ fields, initial }: { fields: Record<string, string>; initial?: { addressLine?: string | null; postcode?: string | null; city?: string | null; state?: string | null } }) {
  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-medium text-ink-700">Shop address</legend>
      <Input label="Lot, building and street" name="addressLine" placeholder="e.g. Lot G-05, KITA Square, Jalan Melur 2/KT2" autoComplete="street-address" defaultValue={initial?.addressLine ?? ''} required error={fields.addressLine} />
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3">
        <Input label="Postcode" name="postcode" inputMode="numeric" maxLength={5} autoComplete="postal-code" defaultValue={initial?.postcode ?? ''} required error={fields.postcode} />
        <Input label="City" name="city" autoComplete="address-level2" defaultValue={initial?.city ?? ''} required error={fields.city} />
      </div>
      <Select label="State" name="state" defaultValue={initial?.state ?? ''} required error={fields.state}>
        <option value="" disabled>
          Choose
        </option>
        {MALAYSIAN_STATES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>
    </fieldset>
  );
}

export function MerchantApplyForm() {
  const townships = useTownships();
  const [done, setDone] = useState(false);
  const apply = useAction((body: Record<string, unknown>) => api.post('/merchants/apply', body), { onSuccess: () => setDone(true) });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void apply.run(formBody(event.currentTarget));
  };
  if (done) {
    return (
      <div className="rounded-lg border border-success-600/30 bg-success-50 p-5 text-[15px] text-success-700">
        <p className="font-semibold">Application received.</p>
        <p className="mt-1">The township office checks your business registration. You can sign in now and will be able to give and accept points once approved.</p>
        <Button href="/login" variant="secondary" className="mt-4">
          Go to sign in
        </Button>
      </div>
    );
  }
  const f = apply.fields;
  return (
    <form onSubmit={submit} method="post" className="space-y-4" noValidate>
      <Input label="Shop name" name="businessName" required error={f.businessName} />
      <div className="grid grid-cols-2 gap-3">
        <Input label="Business registration no." name="registrationNo" required error={f.registrationNo} />
        <Input label="Type of shop" name="category" placeholder="e.g. Groceries" required error={f.category} />
      </div>
      <Select label="Township" name="townshipId" required error={f.townshipId} defaultValue="">
        <option value="" disabled>
          {townships.data ? 'Choose the township' : 'Loading…'}
        </option>
        {townships.data?.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </Select>
      <ShopAddressFields fields={f} />
      <Input label="Your name" name="contactName" autoComplete="name" required error={f.contactName} />
      <Input label="Email" name="email" type="email" autoComplete="email" required error={f.email} />
      <Input label="Phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" required hint={PHONE_HINT} error={f.phone} />
      <Input label="Password" name="password" type="password" autoComplete="new-password" hint="At least 10 characters." required error={f.password} />
      <TermsConsent error={f.acceptTerms} />
      <Button type="submit" size="lg" className="w-full" pending={apply.pending}>
        Apply to join
      </Button>
    </form>
  );
}

/**
 * Links carry their token after "#" (/invite#token). Browsers never send that
 * part to a server, so it stays out of access logs, proxies and CDNs.
 */
export function InviteFromLink() {
  const hydrated = useHydrated();
  if (!hydrated) return null;
  const token = window.location.hash.slice(1);
  if (!token) {
    return (
      <EmptyState icon={ShieldCheck} title="This link is incomplete">
        Copy the whole link from the message you received, or ask your admin for a new one.
      </EmptyState>
    );
  }
  return <InviteForm token={token} />;
}

export function InviteForm({ token }: { token: string }) {
  const accept = useAction((body: Record<string, unknown>) => api.post<SignedIn>('/auth/accept-invite', { ...body, token }), {
    onSuccess: (user) => reloadTo(ROLE_HOME[user.role]),
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void accept.run(formBody(event.currentTarget));
  };
  return (
    <form onSubmit={submit} method="post" className="space-y-4" noValidate>
      <Input label="Choose a password" name="password" type="password" autoComplete="new-password" hint="At least 10 characters." required error={accept.fields.password} />
      <TermsConsent error={accept.fields.acceptTerms} />
      <Button type="submit" size="lg" className="w-full" pending={accept.pending}>
        Set password and sign in
      </Button>
    </form>
  );
}
