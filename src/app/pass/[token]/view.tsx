'use client';

import { Text } from '@/components/ui/localized-text';

import { CalendarClock, Car, CheckCircle2, IdCard, MapPin, Navigation, Send, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Logo } from '@/components/shell/logo';
import {
  detailsBody, emptyVisitorForm, partsMissing, VisitorDetailsFields, VisitorDetailsSummary, type VisitorDetailsView, type VisitorForm,
} from '@/components/features/visitor-details';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { Async, EmptyState } from '@/components/ui/feedback';
import { Checkbox } from '@/components/ui/field';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { QrCode } from '@/components/ui/qr';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import type { VisitorDetail } from '@/shared/domain';

interface PublicPass {
  status: 'ACTIVE' | 'NOT_YET' | 'USED' | 'EXPIRED' | 'CANCELLED';
  typeLabel: string;
  visitorName: string;
  vehicleNo: string | null;
  code: string | null;
  validFrom: string;
  validUntil: string;
  township: string;
  street: string;
  gate: { name: string; lat: number; lng: number } | null;
  details: VisitorDetailsView;
  missing: VisitorDetail[];
}

const WORDS: Record<PublicPass['status'], { label: string; tone: 'success' | 'brand' | 'neutral' | 'warning'; text: string }> = {
  ACTIVE: { label: 'Valid now', tone: 'success', text: 'Show this QR code to the guard at the main gate.' },
  NOT_YET: { label: 'Not valid yet', tone: 'brand', text: 'Your pass starts later. You can show it at the gate from the start time.' },
  USED: { label: 'Already used', tone: 'neutral', text: 'This pass has been used. Ask your host for a new one.' },
  EXPIRED: { label: 'Expired', tone: 'neutral', text: 'This pass has expired. Ask your host for a new one.' },
  CANCELLED: { label: 'Cancelled', tone: 'warning', text: 'Your host cancelled this pass.' },
};

/**
 * The details the host left for the visitor: given here, before they come, so the gate is quick. With the
 * visitor's agreement, which is required. What the host already gave is not shown for changing.
 */
function CompleteDetails({ token, pass, onDone }: { token: string; pass: PublicPass; onDone: (next: PublicPass) => void }) {
  const [form, setForm] = useState<VisitorForm>(() => ({ ...emptyVisitorForm(), transport: pass.details.transport ?? '', vehicleNo: pass.details.vehicleNo ?? '' }));
  const [consent, setConsent] = useState(false);
  const parts = partsMissing(pass.missing);
  const save = useAction((body: Record<string, unknown>) => api.post<PublicPass>(`/passes/${token}/details`, body), {
    success: 'Thank you. Your details are with the gate.',
    onSuccess: onDone,
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save.run({ ...detailsBody(form, parts), consent });
  };
  return (
    <form method="post" noValidate onSubmit={submit} className="space-y-4 border-t border-ink-100 bg-gold-50/60 px-6 py-5">
      <div className="flex items-start gap-3">
        <IdCard className="mt-0.5 size-5 shrink-0 text-gold-700" aria-hidden />
        <div>
          <p className="font-semibold text-ink-900"><Text>Before you come: your details for the gate</Text></p>
          <p className="text-sm text-ink-600"><Text>Your host asked you to give these yourself. It makes the gate quicker. If you prefer, the guard can fill them in from your identity card when you arrive.</Text></p>
        </div>
      </div>
      <VisitorDetailsFields form={form} onChange={setForm} parts={parts} errors={save.fields} />
      <Checkbox
        checked={consent}
        onChange={(event) => setConsent(event.target.checked)}
        error={save.fields.consent}
        label={<><Text>I agree that SimeTown keeps these details for township security, shows the number in full only to the guard at the gate, and deletes them after 90 days. See the </Text><Link href="/privacy" className="font-semibold text-brand-700 underline"><Text>Privacy Notice</Text></Link><Text>.</Text></>}
      />
      <Button type="submit" pending={save.pending}><Send className="size-4" aria-hidden /><Text>Send my details</Text></Button>
    </form>
  );
}

/**
 * What the visitor sees from their link. No sign-in and no app. Only the street is shown, never the house number
 * or the host's name, and of their identity number only the last 4 characters.
 */
export function PassView({ token }: { token: string | null }) {
  const pass = useApi<PublicPass>(token ? `/passes/${token}` : null);
  return (
    <div className="min-h-dvh bg-gradient-to-b from-brand-900 to-brand-950 px-4 py-8">
      <div className="mx-auto max-w-md">
        <Logo tone="light" />
        <div className="mt-6">
          {!token ? (
            <EmptyState title="This link is not complete"><Text>Ask your host to send the pass again.</Text></EmptyState>
          ) : (
            <Async state={pass}>
              {(p) => {
                const w = WORDS[p.status];
                const hasDetails = Boolean(p.details.citizenship || p.details.transport || p.details.reason);
                return (
                  <Card className="overflow-hidden">
                    <div className="border-b border-ink-100 px-6 py-5 text-center">
                      <p className="text-sm font-medium text-ink-500"><Text>{p.township}</Text></p>
                      <h1 className="mt-1 text-2xl font-bold"><Text>Visitor pass</Text></h1>
                      <Badge tone={w.tone} className="mt-2">
                        <Text>{w.label}</Text>
                      </Badge>
                    </div>
                    <div className="flex flex-col items-center gap-3 px-6 py-6">
                      {p.code ? (
                        <>
                          <QrCode value={`KITAPASS:${p.code}`} size={240} label={`Visitor pass code ${p.code}`} />
                          <p className="font-display text-3xl font-bold tracking-[0.2em] text-ink-900"><Text>{p.code}</Text></p>
                        </>
                      ) : null}
                      <p className="text-center text-[15px] text-ink-700"><Text>{w.text}</Text></p>
                    </div>
                    <dl className="space-y-3 border-t border-ink-100 px-6 py-5 text-[15px]">
                      <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3">
                        <ShieldCheck className="row-span-2 mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
                        <dt className="text-xs font-medium text-ink-500"><Text>Visitor</Text></dt>
                        <dd className="font-semibold text-ink-900">
                          {p.visitorName} · <Text>{p.typeLabel}</Text>
                        </dd>
                      </div>
                      {hasDetails ? (
                        <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3">
                          <IdCard className="row-span-2 mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
                          <dt className="text-xs font-medium text-ink-500"><Text>Your details</Text></dt>
                          <dd><VisitorDetailsSummary details={p.details} vehicleNo={p.vehicleNo} className="mt-0.5" /></dd>
                        </div>
                      ) : p.vehicleNo && (
                        <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3">
                          <Car className="row-span-2 mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
                          <dt className="text-xs font-medium text-ink-500"><Text>Vehicle</Text></dt>
                          <dd className="font-semibold text-ink-900">{p.vehicleNo}</dd>
                        </div>
                      )}
                      <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3">
                        <CalendarClock className="row-span-2 mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
                        <dt className="text-xs font-medium text-ink-500"><Text>Valid</Text></dt>
                        <dd className="text-ink-900">
                          <Text>{formatDateTime(p.validFrom)}</Text><Text> to </Text><Text>{formatDateTime(p.validUntil)}</Text>
                        </dd>
                      </div>
                      <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3">
                        <MapPin className="row-span-2 mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
                        <dt className="text-xs font-medium text-ink-500"><Text>Going to</Text></dt>
                        <dd className="text-ink-900">
                          <Text>{p.street}</Text>
                          <Text>{p.gate && `, through the ${p.gate.name}`}</Text>
                        </dd>
                      </div>
                    </dl>
                    {p.missing.length > 0 ? (
                      <CompleteDetails token={token} pass={p} onDone={(next) => void pass.mutate(next, { revalidate: false })} />
                    ) : hasDetails && (p.status === 'ACTIVE' || p.status === 'NOT_YET') && (
                      <p className="flex items-center gap-2 border-t border-ink-100 bg-success-50 px-6 py-3 text-sm text-success-700">
                        <CheckCircle2 className="size-4 shrink-0" aria-hidden /><Text>Your details are with the gate. Bring your identity card: the guard checks it and hands it straight back.</Text>
                      </p>
                    )}
                    {p.gate && (
                      <div className="grid gap-2 border-t border-ink-100 bg-ink-25 px-6 py-4 sm:grid-cols-2">
                        <Button href={`https://waze.com/ul?ll=${p.gate.lat},${p.gate.lng}&navigate=yes`}>
                          <Navigation className="size-4" aria-hidden /><Text>Open in Waze</Text></Button>
                        <Button href={`https://www.google.com/maps/dir/?api=1&destination=${p.gate.lat},${p.gate.lng}`} variant="secondary">
                          <MapPin className="size-4" aria-hidden /><Text>Google Maps</Text></Button>
                      </div>
                    )}
                  </Card>
                );
              }}
            </Async>
          )}
          <p className="mt-6 text-center text-xs text-brand-100/80"><Text>For township security the gate records your name, citizenship, identity number, transport and the reason for your visit. The number is stored encrypted, shown in full only to the guard, and deleted after 90 days. The guard never keeps your identity card.</Text></p>
        </div>
      </div>
    </div>
  );
}
