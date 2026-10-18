'use client';

import { Text } from '@/components/ui/localized-text';

import { Building2, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';

/**
 * Couriers of companies with their own sign-in choose the company and sign in
 * there; SimeTown never sees their company password. Shown only when such a
 * company is approved somewhere.
 */
export function CourierSignIn({ next, error }: { next?: string; error?: string | null }) {
  const companies = useApi<{ name: string; code: string; simulated: boolean }[]>('/auth/courier-sso/companies');
  const start = useAction((code: string) => api.post<{ url: string }>('/auth/courier-sso/start', { company: code, returnTo: next?.startsWith('/courier') ? next : undefined }), {
    onSuccess: (r) => window.location.assign(r.url),
  });
  if (!companies.data?.length && !error) return null;
  return (
    <section className="mt-6 space-y-3 border-t border-ink-100 pt-5" aria-labelledby="courier-sso">
      <h2 id="courier-sso" className="flex items-center gap-2 text-sm font-semibold text-ink-900"><Truck className="size-4 text-brand-700" aria-hidden /><Text>Courier? Sign in with your courier company</Text></h2>
      {error && <p role="alert" className="rounded-md bg-accent-50 px-3 py-2 text-sm text-accent-700"><Text>{error}</Text></p>}
      <div className="grid gap-2">
        {companies.data?.map((c) => (
          <Button key={c.code} variant="secondary" onClick={() => void start.run(c.code)} pending={start.pending}>
            <Building2 className="size-4" aria-hidden /><Text>{c.simulated ? `${c.name} (simulated sign-in)` : c.name}</Text>
          </Button>
        ))}
      </div>
    </section>
  );
}
