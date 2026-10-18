'use client';

import { Text } from '@/components/ui/localized-text';

import { CheckCircle2, Copy, ExternalLink, Phone, ShieldQuestion, Truck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { REPORT_REASONS, type ReportContext } from '@/shared/incidents';

export interface CourierGuidance {
  referralId: string;
  company: { id: string; name: string; simulated: boolean; identifiedBy: string };
  trackingNo: string | null;
  support: { name: string | null; url: string | null; phone: string | null; verified: boolean } | null;
  canSubmitTicket: boolean;
}
type Outcome =
  | { route: 'COURIER'; guidance: CourierGuidance }
  | { route: 'CHOOSE_COURIER'; companies: { id: string; name: string }[] }
  | { route: 'CONFIRM'; evidence: string[]; question: string }
  | { route: 'FOUND'; message: string }
  | { route: 'TOWNSHIP'; incident: { reference: string; created: boolean } };

/**
 * Report a problem. The resident says what went wrong; SimeTown decides who
 * must act. A courier problem shows the courier and its verified support
 * channel (nothing is filed with the township); a township problem becomes a
 * case; a mixed one shows the township's records first.
 */
export function ReportProblemDialog({ open, onClose, context, subtitle, lockerParcelId, guardParcelId, stationId, onFiled }: {
  open: boolean;
  onClose: () => void;
  context: ReportContext;
  subtitle?: string;
  lockerParcelId?: string;
  guardParcelId?: string;
  stationId?: string;
  onFiled?: () => void;
}) {
  const reasons = REPORT_REASONS[context];
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [tracking, setTracking] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const chosen = reasons.find((r) => r.key === reason);
  const send = useAction((confirm: boolean) => api.post<Outcome>('/incidents/report', {
    context, reason, lockerParcelId, guardParcelId, stationId, note: note.trim() || undefined, trackingNo: tracking.trim() || undefined, companyId: companyId || undefined, confirm,
  }), {
    onSuccess: (r) => {
      setOutcome(r);
      if (r.route === 'TOWNSHIP' || r.route === 'COURIER') onFiled?.();
    },
  });
  const close = () => {
    setReason('');
    setNote('');
    setTracking('');
    setCompanyId('');
    setOutcome(null);
    onClose();
  };
  const needsTracking = context === 'NOT_ARRIVED' && reason !== 'NOT_SURE';
  const ready = Boolean(reason) && (!chosen?.needsNote || note.trim().length >= 5) && (!needsTracking || tracking.trim().length >= 4);

  const footer = !outcome || outcome.route === 'CHOOSE_COURIER'
    ? <><Button variant="secondary" onClick={close}><Text>Cancel</Text></Button><Button onClick={() => void send.run(false)} pending={send.pending} disabled={!ready || (outcome?.route === 'CHOOSE_COURIER' && !companyId)}><Text>Continue</Text></Button></>
    : outcome.route === 'CONFIRM'
      ? <><Button variant="secondary" onClick={close}><Text>It was someone in my home</Text></Button><Button onClick={() => void send.run(true)} pending={send.pending}><Text>Please investigate</Text></Button></>
      : <Button onClick={close}><Text>Done</Text></Button>;

  return (
    <Modal open={open} onClose={close} title="Report a problem" description={subtitle} footer={footer}>
      {!outcome && (
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold text-ink-900"><Text>What went wrong?</Text></legend>
            {reasons.map((r) => (
              <label key={r.key} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3', reason === r.key ? 'border-brand-600 bg-brand-50' : 'border-ink-200 bg-white hover:border-ink-300')}>
                <input type="radio" name="report-reason" value={r.key} checked={reason === r.key} onChange={() => setReason(r.key)} className="mt-1 accent-brand-700" />
                <span>
                  <span className="block text-[15px] font-semibold text-ink-900"><Text>{r.label}</Text></span>
                  <span className="block text-sm text-ink-600"><Text>{r.hint}</Text></span>
                </span>
              </label>
            ))}
          </fieldset>
          {context === 'NOT_ARRIVED' && <Input label="Tracking number" value={tracking} onChange={(event) => setTracking(event.target.value.toUpperCase())} maxLength={60} hint="From the courier’s message or the shop’s order page." />}
          <Textarea label={chosen?.needsNote ? 'What happened' : 'Anything to add (optional)'} value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} />
        </div>
      )}
      {outcome?.route === 'CHOOSE_COURIER' && (
        <div className="space-y-3">
          <p className="text-[15px] text-ink-700"><Text>SimeTown does not know which courier company is delivering this. Which one is it?</Text></p>
          <Select label="Courier company" value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
            <option value="">{' '}</option>
            {outcome.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
      )}
      {outcome?.route === 'CONFIRM' && (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-900"><ShieldQuestion className="size-4 text-brand-700" aria-hidden /><Text>What the township’s records show</Text></p>
          <ul className="space-y-1.5 rounded-lg bg-ink-50 p-3 text-[15px] text-ink-800">{outcome.evidence.map((line) => <li key={line}><Text>{line}</Text></li>)}</ul>
          <p className="text-[15px] text-ink-700"><Text>{outcome.question}</Text></p>
        </div>
      )}
      {outcome?.route === 'FOUND' && <p className="flex gap-2 text-[15px] text-ink-800"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success-700" aria-hidden /><Text>{outcome.message}</Text></p>}
      {outcome?.route === 'TOWNSHIP' && (
        <div className="space-y-2 text-[15px] text-ink-800">
          <p className="flex gap-2"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success-700" aria-hidden /><span><Text>{outcome.incident.created ? `Report ${outcome.incident.reference} received.` : `You already reported this: ${outcome.incident.reference}.`}</Text></span></p>
          <p><Text>The township office will look into it. You will be told what happens.</Text></p>
          {context !== 'COURIER_STATION' && <Button size="sm" variant="secondary" href={`/app/reports#${outcome.incident.reference}`}><Text>Open My reports</Text></Button>}
        </div>
      )}
      {outcome?.route === 'COURIER' && <CourierGuidanceCard guidance={outcome.guidance} />}
    </Modal>
  );
}

/** For a courier company's problem: who to contact, the tracking number to give them, and only a support channel the township has verified. */
export function CourierGuidanceCard({ guidance: g }: { guidance: CourierGuidance }) {
  const toast = useToast();
  const t = useT();
  const [ticket, setTicket] = useState<string | null>(null);
  const submit = useAction(() => api.post<{ ticketRef: string; simulated: boolean }>(`/incidents/referrals/${g.referralId}/ticket`), { onSuccess: (r) => setTicket(r.ticketRef) });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(g.trackingNo ?? '');
      toast.show(t('Tracking number copied'), 'success');
    } catch {
      /* clipboard not available */
    }
  };
  return (
    <div className="space-y-4 text-[15px] text-ink-800">
      <p className="flex items-start gap-2 font-semibold text-ink-900">
        <Truck className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden />
        <span><Text>{`This is for ${g.company.name} to handle`}</Text>{g.company.simulated && <> <Badge tone="neutral"><Text>Simulated company</Text></Badge></>}</span>
      </p>
      <p><Text>Delivery problems such as delays, damage and wrong items are handled by the courier company. The township office is not told about this report.</Text></p>
      {g.company.identifiedBy === 'RESIDENT' && <p className="text-sm text-ink-600"><Text>You chose this courier company; SimeTown has no record of the delivery.</Text></p>}
      {g.trackingNo && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-ink-50 p-3">
          <span><span className="block text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Tracking number</Text></span><span className="font-mono text-ink-900">{g.trackingNo}</span></span>
          <Button size="sm" variant="secondary" onClick={() => void copy()}><Copy className="size-4" aria-hidden /><Text>Copy</Text></Button>
        </div>
      )}
      {g.support ? (
        <div className="space-y-2 rounded-lg border border-ink-200 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Support channel checked by the township</Text></p>
          {g.support.name && <p className="font-semibold text-ink-900">{g.support.name}</p>}
          <div className="flex flex-wrap gap-2">
            {g.support.url && (
              <a href={g.support.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 text-sm font-semibold text-ink-800 hover:border-ink-300">
                <ExternalLink className="size-4" aria-hidden /><Text>Open their support page</Text>
              </a>
            )}
            {g.support.phone && <Button size="sm" variant="secondary" href={`tel:${g.support.phone.replace(/[^+\d]/g, '')}`}><Phone className="size-4" aria-hidden />{g.support.phone}</Button>}
          </div>
          {g.support.url && <p className="text-sm text-ink-600"><Text>Opening their page does not file a complaint for you: follow their steps there.</Text></p>}
        </div>
      ) : (
        <p className="rounded-lg bg-warning-50 p-3 text-sm text-ink-800"><Text>The township has not verified this company’s support details yet. Use the contact in the courier’s own app or message, or ask the shop where you ordered.</Text></p>
      )}
      {g.canSubmitTicket && (
        ticket
          ? <p className="text-sm text-ink-700"><Text>{`Sent to the simulated company. Its reference: ${ticket}`}</Text></p>
          : <Button size="sm" onClick={() => void submit.run()} pending={submit.pending}><Text>{`Send it to ${g.company.name} (simulated)`}</Text></Button>
      )}
    </div>
  );
}
