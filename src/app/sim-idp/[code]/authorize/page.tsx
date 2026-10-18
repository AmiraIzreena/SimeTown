'use client';

import { Text } from '@/components/ui/localized-text';

import { AlertTriangle, LogIn } from 'lucide-react';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';

interface PageData {
  company: string;
  code: string;
  requireMfa: boolean;
  otpHint: string;
  staff: { employee_ref: string; full_name: string; active: boolean }[];
}

/**
 * The simulated courier company's own sign-in page: what J&T or Ninja Van
 * would host on their own site in a real integration. SimeTown never sees the
 * password typed here in a real deployment; this stand-in exists only so the
 * demo can show the whole flow, and says so.
 */
export default function SimulatedSignInPage() {
  return (
    <Suspense fallback={null}>
      <SignIn />
    </Suspense>
  );
}

function SignIn() {
  const { code } = useParams<{ code: string }>();
  const q = useSearchParams();
  const page = useApi<PageData>(`/sim-idp/${code}/page`);
  const [employee, setEmployee] = useState('');
  const authorize = useAction((body: Record<string, unknown>) => api.post<{ redirect: string }>(`/sim-idp/${code}/authorize`, body), {
    onSuccess: (r) => window.location.assign(r.redirect),
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    void authorize.run({
      clientId: q.get('client_id') ?? '', redirectUri: q.get('redirect_uri') ?? '', state: q.get('state') ?? '', nonce: q.get('nonce') ?? '',
      codeChallenge: q.get('code_challenge') ?? '', codeChallengeMethod: q.get('code_challenge_method') ?? '',
      employeeRef: employee, password: String(f.get('password') ?? ''), otp: String(f.get('otp') ?? '').trim() || undefined,
    });
  };
  const d = page.data;
  return (
    <main className="grid min-h-dvh place-items-center bg-ink-900 px-4 py-10">
      <div className="w-full max-w-md space-y-4">
        <p className="flex gap-2 rounded-lg bg-warning-50 p-3 text-sm text-ink-800" role="note">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-700" aria-hidden />
          <span><Text>Simulated sign-in for the demo. In a real integration this page belongs to the courier company, on its own website, and SimeTown never sees the password.</Text></span>
        </p>
        <div className="rounded-xl bg-white p-6 shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Staff sign-in</Text></p>
          <h1 className="font-display text-2xl font-bold text-ink-900">{d ? <Text>{`${d.company} (simulated)`}</Text> : '…'}</h1>
          <p className="mt-1 text-sm text-ink-600"><Text>SimeTown lockers asked you to sign in with your company.</Text></p>
          {d && (
            <form method="post" onSubmit={submit} className="mt-5 space-y-4" noValidate>
              <Select label="Staff member (demo directory)" value={employee} onChange={(event) => setEmployee(event.target.value)} required>
                <option value="">{' '}</option>
                {d.staff.map((s) => <option key={s.employee_ref} value={s.employee_ref}><Text>{s.active ? `${s.full_name} · ${s.employee_ref}` : `${s.full_name} · ${s.employee_ref} (suspended by the company)`}</Text></option>)}
              </Select>
              <Input label="Password" name="password" type="password" autoComplete="off" required hint="Demo staff use the same password as the other demo accounts." error={authorize.fields.password} />
              <Input label={d.requireMfa ? 'One-time code' : 'One-time code (optional)'} name="otp" inputMode="numeric" maxLength={6} autoComplete="one-time-code" hint={`Simulated authenticator: ${d.otpHint}`} />
              <Button type="submit" pending={authorize.pending} disabled={!employee} className="w-full"><LogIn className="size-4" aria-hidden /><Text>Sign in and return to SimeTown</Text></Button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
