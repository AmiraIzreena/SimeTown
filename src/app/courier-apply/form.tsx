'use client';

import { Text } from '@/components/ui/localized-text';

import { CheckCircle2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';

/** A courier asks for an account under an authorised company. Nothing works at the lockers until an admin approves it. */
export function CourierApplyForm() {
  const companies = useApi<{ id: string; name: string }[]>('/couriers/companies');
  const townships = useApi<{ id: string; name: string }[]>('/townships');
  const [done, setDone] = useState(false);
  const apply = useAction((body: Record<string, unknown>) => api.post('/couriers/apply', body), { onSuccess: () => setDone(true) });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const text = (k: string) => String(f.get(k) ?? '').trim();
    void apply.run({ townshipId: text('townshipId') || townships.data?.[0]?.id, companyId: text('companyId'), fullName: text('fullName'), email: text('email'), phone: text('phone'), password: String(f.get('password') ?? '') });
  };
  if (done) {
    return (
      <div className="flex items-start gap-3 rounded-lg bg-success-50 p-5">
        <CheckCircle2 className="size-6 shrink-0 text-success-700" aria-hidden />
        <div>
          <p className="font-semibold text-success-700"><Text>Application sent</Text></p>
          <p className="text-[15px] text-ink-700"><Text>You can sign in now. You can deliver once the township office approves your account and chooses your stations.</Text></p>
        </div>
      </div>
    );
  }
  const f = apply.fields;
  return (
    <form method="post" onSubmit={submit} className="space-y-4" noValidate>
      {(townships.data?.length ?? 0) > 1 && (
        <Select label="Township" name="townshipId" required error={f.townshipId}>
          {townships.data!.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      )}
      <Select label="Courier company" name="companyId" required defaultValue="" error={f.companyId}>
        <option value="" disabled><Text>Choose…</Text></option>
        {companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
      <Input label="Full name" name="fullName" autoComplete="name" required maxLength={80} error={f.fullName} />
      <Input label="Email" name="email" type="email" autoComplete="email" required error={f.email} />
      <Input label="Phone" name="phone" type="tel" autoComplete="tel" required placeholder="e.g. 012-345 6789" error={f.phone} />
      <Input label="Password" name="password" type="password" autoComplete="new-password" hint="At least 10 characters." required error={f.password} />
      <Button type="submit" size="lg" className="w-full" pending={apply.pending}><Text>Apply for locker access</Text></Button>
    </form>
  );
}
