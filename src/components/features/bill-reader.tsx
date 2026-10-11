'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv, LocalizedInput } from '@/components/ui/localized-elements';

import { CheckCircle2, Download, FileText, FileUp, ShieldCheck, Trash2, TriangleAlert, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMonth, parseRM, rewardMessage } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { shrinkPhoto } from '@/lib/image';
import type { ActionRewardView } from '@/lib/types';
import { formatRM, type BillKind } from '@/shared/domain';

interface Field<T> {
  value: T | null;
  unsure: boolean;
}
interface Step {
  step: string;
  ok: boolean;
  detail: string;
}
interface ReadResult {
  billId: string;
  source: 'TEXT' | 'MODEL' | 'NONE';
  fields: { kind: Field<BillKind>; usage: Field<number>; amountSen: Field<number>; month: Field<string>; accountLast4: Field<string> };
  gate: Step[];
  checks: Step[];
  aiAvailable: boolean;
}
interface ConfirmedBill {
  id: string;
  kind: BillKind;
  read_source: 'TEXT' | 'MODEL' | 'NONE';
  usage: number;
  amount_sen: number;
  period_month: string;
  address_match: boolean | null;
}

const SOURCE = { TEXT: 'Read from the PDF’s own text', MODEL: 'Read by the AI service', NONE: 'Typed by you' };

/** Recent months, newest first, as YYYY-MM. */
function recentMonths(): string[] {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
  return [0, 1, 2, 3].map((back) => {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="space-y-1.5">
      {steps.map((s) => (
        <li key={s.step} className="flex items-start gap-2 text-sm">
          {s.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-700" aria-hidden /> : <XCircle className="mt-0.5 size-4 shrink-0 text-accent-600" aria-hidden />}
          <span>
            <span className="font-semibold text-ink-900"><Text>{s.step}</Text>.</span> <span className="text-ink-600"><Text>{s.detail}</Text></span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Jimat bill reading (proposal 6.3): upload a photo or PDF, see each step of
 * the file-safety gate, then confirm or correct what was read. Unsure fields
 * are highlighted. Only the numbers are kept; the file never is.
 */
export function BillReader({ onSaved }: { onSaved: () => void }) {
  const toast = useToast();
  const bills = useApi<ConfirmedBill[]>('/jimat/bills');
  const [kind, setKind] = useState<BillKind>('ELECTRICITY');
  const [reading, setReading] = useState(false);
  const [refused, setRefused] = useState<{ message: string; steps: Step[] } | null>(null);
  const [result, setResult] = useState<ReadResult | null>(null);
  const [usage, setUsage] = useState('');
  const [amount, setAmount] = useState('');
  const [month, setMonth] = useState('');
  const months = recentMonths();

  const upload = async (file: File) => {
    setReading(true);
    setRefused(null);
    setResult(null);
    try {
      const form = new FormData();
      // A photo is re-drawn on the phone first: the clean copy drops anything hidden in the file.
      if (file.type.startsWith('image/')) form.set('file', await shrinkPhoto(file, 1800, 0.9), 'bill.jpg');
      else form.set('file', file, 'bill.pdf');
      form.set('kind', kind);
      const r = await api.post<ReadResult>('/jimat/bills', form);
      setResult(r);
      const k = r.fields.kind.value ?? kind;
      setKind(k);
      setUsage(r.fields.usage.value === null ? '' : String(k === 'WATER' ? r.fields.usage.value / 1000 : r.fields.usage.value));
      setAmount(r.fields.amountSen.value === null ? '' : (r.fields.amountSen.value / 100).toFixed(2));
      setMonth(r.fields.month.value && months.includes(r.fields.month.value) ? r.fields.month.value : (months[1] ?? ''));
    } catch (error) {
      if (error instanceof ApiError) setRefused({ message: error.message, steps: (error.details?.steps as Step[] | undefined) ?? [] });
      else toast.show('Could not read the file. Please try again.', 'error');
    } finally {
      setReading(false);
    }
  };

  const usageNumber = Number(usage);
  const amountSen = parseRM(amount);
  const confirm = useAction(
    () =>
      api.post<{ saved: boolean; savedSen: number; reward: ActionRewardView }>(`/jimat/bills/${result!.billId}/confirm`, {
        kind,
        usage: Math.round(kind === 'WATER' ? usageNumber * 1000 : usageNumber),
        amountSen,
        month,
      }),
    {
      onSuccess: () => {
        setResult(null);
        void bills.mutate();
        onSaved();
      },
      success: (r) => `${r.saved ? `You used less than last month${r.savedSen ? `, ${formatRM(r.savedSen)} less on the bill` : ''}. ` : 'Bill saved. '}${rewardMessage(r.reward, '')} The file was not kept.`,
    },
  );
  const discard = useAction(() => api.post(`/jimat/bills/${result!.billId}/discard`), { onSuccess: () => setResult(null), success: 'Discarded. Nothing was kept.' });
  const unsure = (f: Field<unknown> | undefined) => Boolean(f?.unsure);
  const canConfirm = result && Number.isFinite(usageNumber) && usage !== '' && amountSen !== null && month;

  return (
    <Card>
      <CardHeader
        title="Read a bill"
        description="Upload a photo or PDF of your electricity or water bill. The app reads it; you confirm the numbers. The file is checked, read and thrown away."
        action={
          <Badge tone="success">
            <ShieldCheck className="size-3.5" aria-hidden /><Text>File-safety gate</Text></Badge>
        }
      />
      <div className="space-y-5 p-5">
        {!result && (
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <LocalizedDiv className="flex flex-wrap gap-2" role="group" aria-label="Kind of bill">
              {(['ELECTRICITY', 'WATER'] as const).map((k) => (
                <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={cn('min-h-11 rounded-md border px-4 text-sm font-semibold transition-colors duration-200', kind === k ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-ink-200 text-ink-700 hover:border-ink-300')}>
                  <Text>{k === 'ELECTRICITY' ? 'Electricity bill' : 'Water bill'}</Text>
                </button>
              ))}
            </LocalizedDiv>
            <div className="flex flex-wrap gap-2">
              <a href={`/api/v1/jimat/sample-bill?kind=${kind}`} className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50" download>
                <Download className="size-4" aria-hidden /><Text>Sample bill (demo)</Text></a>
              <label className={cn('inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md bg-brand-700 px-4 text-[15px] font-semibold text-white shadow-xs transition-colors duration-200 hover:bg-brand-800', reading && 'pointer-events-none opacity-60')}>
                <FileUp className="size-4" aria-hidden />
                <Text>{reading ? 'Checking and reading…' : 'Upload photo or PDF'}</Text>
                <LocalizedInput type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(event) => event.target.files?.[0] && void upload(event.target.files[0])} />
              </label>
            </div>
          </div>
        )}

        {refused && (
          <div className="animate-rise space-y-3 rounded-lg border border-accent-200 bg-accent-50 p-4">
            <p className="flex items-center gap-2 font-semibold text-accent-700">
              <TriangleAlert className="size-4" aria-hidden />
              <Text>{refused.message}</Text>
            </p>
            {refused.steps.length > 0 && <StepList steps={refused.steps} />}
            <p className="text-sm text-ink-600"><Text>Nothing was kept.</Text></p>
          </div>
        )}

        {result && (
          <div className="animate-rise grid gap-5 lg:grid-cols-[1fr_1.1fr]">
            <div className="space-y-4">
              <div className="rounded-lg bg-ink-50 p-4">
                <p className="mb-2 text-sm font-semibold text-ink-900"><Text>1. File-safety gate</Text></p>
                <StepList steps={result.gate} />
              </div>
              <div className="rounded-lg bg-ink-50 p-4">
                <p className="mb-2 text-sm font-semibold text-ink-900"><Text>2. Reading and sense checks</Text></p>
                <p className="mb-2 flex items-center gap-2 text-sm text-ink-600">
                  <FileText className="size-4" aria-hidden />
                  <Text>{SOURCE[result.source]}</Text>
                  <Text>{result.source === 'NONE' && (result.aiAvailable ? ': the picture could not be read.' : ': picture reading needs the AI service, which is off in this demo.')}</Text>
                </p>
                {result.checks.length > 0 ? <StepList steps={result.checks} /> : <p className="text-sm text-ink-500"><Text>The checks run once the numbers are known.</Text></p>}
              </div>
            </div>
            <div className="space-y-4">
              <p className="text-sm font-semibold text-ink-900"><Text>3. Confirm the numbers</Text></p>
              {[result.fields.usage, result.fields.amountSen, result.fields.month].some(unsure) && <p className="rounded-md bg-warning-50 px-3 py-2 text-sm text-warning-700"><Text>Fields marked “Please check” could not be read with confidence.</Text></p>}
              <div className={cn('rounded-md', unsure(result.fields.usage) && 'ring-2 ring-warning-600/40 ring-offset-4')}>
                <Input label={kind === 'WATER' ? 'Water used (m³)' : 'Electricity used (kWh)'} value={usage} onChange={(event) => setUsage(event.target.value)} inputMode="decimal" hint={unsure(result.fields.usage) ? 'Please check' : 'Read from the bill'} error={confirm.fields.usage} />
              </div>
              <div className={cn('rounded-md', unsure(result.fields.amountSen) && 'ring-2 ring-warning-600/40 ring-offset-4')}>
                <Input label="Amount due (RM)" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" hint={unsure(result.fields.amountSen) ? 'Please check' : 'Read from the bill'} error={confirm.fields.amountSen ?? (amount && amountSen === null ? 'Enter an amount such as 149.11.' : undefined)} />
              </div>
              <div className={cn('rounded-md', unsure(result.fields.month) && 'ring-2 ring-warning-600/40 ring-offset-4')}>
                <Select label="The month it is for" value={month} onChange={(event) => setMonth(event.target.value)} hint={unsure(result.fields.month) ? 'Please check' : 'From the billing period'} error={confirm.fields.month}>
                  {months.map((m) => (
                    <option key={m} value={m}>
                      <Text>{formatMonth(m)}</Text>
                    </option>
                  ))}
                </Select>
              </div>
              {result.fields.accountLast4.value && <p className="text-sm text-ink-500"><Text>Account ending </Text><Text>{result.fields.accountLast4.value}</Text><Text>. The same bill cannot be used twice.</Text></p>}
              <div className="flex flex-wrap gap-2">
                <Button size="lg" onClick={() => void confirm.run()} pending={confirm.pending} disabled={!canConfirm}><Text>Confirm and save</Text></Button>
                <Button size="lg" variant="ghost" onClick={() => void discard.run()} disabled={discard.pending}>
                  <Trash2 className="size-4" aria-hidden /><Text>Discard</Text></Button>
              </div>
            </div>
          </div>
        )}

        {bills.data && bills.data.length > 0 && (
          <div className="border-t border-ink-100 pt-4">
            <p className="mb-2 text-sm font-semibold text-ink-900"><Text>Bills read for your home</Text></p>
            <ul className="divide-y divide-ink-100 text-sm">
              {bills.data.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-ink-800">
                    <Text>{b.kind === 'ELECTRICITY' ? 'Electricity' : 'Water'}</Text> · <Text>{formatMonth(b.period_month)}</Text> · <Text>{b.kind === 'WATER' ? `${(b.usage / 1000).toLocaleString('en-MY')} m³` : `${b.usage} kWh`}</Text> · <Text>{formatRM(b.amount_sen)}</Text>
                  </span>
                  <span className="flex gap-1.5">
                    <Badge tone="brand"><Text>{b.read_source === 'NONE' ? 'Typed' : 'Read'}</Text></Badge>
                    {b.address_match && <Badge tone="success"><Text>Address matches</Text></Badge>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
