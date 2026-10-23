'use client';

import { Text } from '@/components/ui/localized-text';

import { BadgeCheck, Bike, Car, CircleAlert, Footprints, IdCard, MessageSquareText, type LucideIcon } from 'lucide-react';
import { Input, Select } from '@/components/ui/field';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  CITIZENSHIP_LABELS, CITIZENSHIPS, maskedId, TRANSPORT_INFO, TRANSPORT_MODES, VISIT_REASON_LABELS, VISIT_REASONS,
  type Citizenship, type TransportMode, type VisitorDetail, type VisitReason,
} from '@/shared/domain';

/**
 * Visitor details (BR26, revised): citizenship, identity number, how the visitor travels (the vehicle number and,
 * when they drive, the licence's expiry) and the reason for the visit. One set of fields for the resident's pass,
 * the visitor's own link and the guard's walk-in and gate forms, and one summary for every list that shows them.
 */

export interface VisitorForm {
  citizenship: '' | Citizenship;
  idNumber: string;
  transport: '' | TransportMode;
  vehicleNo: string;
  licenceExpiry: string;
  reason: '' | VisitReason;
  reasonOther: string;
}

export const emptyVisitorForm = (reason: '' | VisitReason = ''): VisitorForm => ({
  citizenship: '', idNumber: '', transport: '', vehicleNo: '', licenceExpiry: '', reason, reasonOther: '',
});

export type DetailPart = 'identity' | 'transport' | 'licence' | 'reason';

/** The fields to ask for when a pass is missing details (the visitor's link, the gate): only what is missing. */
export function partsMissing(missing: VisitorDetail[]): DetailPart[] {
  const parts = new Set<DetailPart>();
  if (missing.includes('identity')) parts.add('identity');
  if (missing.includes('transport')) { parts.add('transport'); parts.add('licence'); }
  if (missing.includes('vehicleNo')) parts.add('transport');
  if (missing.includes('licenceExpiry')) parts.add('licence');
  if (missing.includes('reason')) parts.add('reason');
  return [...parts];
}

/** Today in Malaysia, for the earliest licence expiry a date picker offers. */
export const todayInMalaysia = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

/** What a form sends: only the parts shown, with empty answers left out so the server says what is missing. */
export function detailsBody(form: VisitorForm, parts: DetailPart[]) {
  const body: Record<string, string> = {};
  const put = (key: keyof VisitorForm) => {
    const value = form[key].trim();
    if (value) body[key] = value;
  };
  if (parts.includes('identity')) { put('citizenship'); put('idNumber'); }
  if (parts.includes('transport')) { put('transport'); }
  const info = form.transport ? TRANSPORT_INFO[form.transport] : null;
  if ((parts.includes('transport') || parts.includes('licence')) && info?.vehicle) put('vehicleNo');
  if (parts.includes('licence') && info?.licence) put('licenceExpiry');
  if (parts.includes('reason')) { put('reason'); if (form.reason === 'OTHER') put('reasonOther'); }
  return body;
}

export function VisitorDetailsFields({ form, onChange, parts, errors = {}, prefix = '', transportFixed, size }: {
  form: VisitorForm;
  onChange: (next: VisitorForm) => void;
  parts: DetailPart[];
  /** Field errors from the server. Keys may carry a prefix, such as "details.idNumber". */
  errors?: Partial<Record<string, string>>;
  prefix?: string;
  /** The transport someone else already gave: shown for context, so the licence question makes sense. */
  transportFixed?: TransportMode | null;
  size?: 'large';
}) {
  const set = <K extends keyof VisitorForm>(key: K, value: VisitorForm[K]) => onChange({ ...form, [key]: value });
  const error = (key: string) => errors[`${prefix}${key}`] ?? errors[key];
  const transport = form.transport || transportFixed || '';
  const info = transport ? TRANSPORT_INFO[transport] : null;
  const big = size === 'large' ? '!text-2xl !font-semibold' : undefined;
  const malaysian = form.citizenship === 'MALAYSIAN';
  return (
    <div className="space-y-4">
      {parts.includes('identity') && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Citizenship" labelClassName={big} value={form.citizenship} required onChange={(e) => set('citizenship', e.target.value as VisitorForm['citizenship'])} error={error('citizenship')}>
            <option value=""><Text>Choose</Text></option>
            {CITIZENSHIPS.map((c) => <option key={c} value={c}><Text>{CITIZENSHIP_LABELS[c]}</Text></option>)}
          </Select>
          <Input
            label={form.citizenship === 'NON_MALAYSIAN' ? 'Passport, ID or licence number' : 'MyKad number'}
            labelClassName={big}
            value={form.idNumber}
            required
            maxLength={30}
            autoComplete="off"
            spellCheck={false}
            inputMode={malaysian ? 'numeric' : 'text'}
            autoCapitalize="characters"
            placeholder={form.citizenship === 'NON_MALAYSIAN' ? 'e.g. A12345678' : 'e.g. 900101-00-1234'}
            hint={form.citizenship === 'NON_MALAYSIAN' ? 'From their own country.' : 'Also their driving licence number. MyKid for children.'}
            onChange={(e) => set('idNumber', e.target.value)}
            error={error('idNumber')}
          />
        </div>
      )}
      {parts.includes('transport') && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Transport" labelClassName={big} value={form.transport} required onChange={(e) => onChange({ ...form, transport: e.target.value as VisitorForm['transport'] })} error={error('transport')}>
            <option value=""><Text>Choose</Text></option>
            {TRANSPORT_MODES.map((m) => <option key={m} value={m}><Text>{TRANSPORT_INFO[m].label}</Text></option>)}
          </Select>
          {info?.vehicle && (
            <Input
              label={info.licence ? 'Vehicle number' : 'Vehicle number (optional)'}
              labelClassName={big}
              value={form.vehicleNo}
              required={info.licence}
              maxLength={12}
              autoCapitalize="characters"
              placeholder="e.g. BKL 2408"
              onChange={(e) => set('vehicleNo', e.target.value.toUpperCase())}
              error={error('vehicleNo')}
            />
          )}
        </div>
      )}
      {parts.includes('licence') && info?.licence && (
        <Input
          type="date"
          label="Driving licence expiry"
          labelClassName={big}
          value={form.licenceExpiry}
          required
          min={todayInMalaysia()}
          hint="An expired licence cannot be used to drive in."
          onChange={(e) => set('licenceExpiry', e.target.value)}
          error={error('licenceExpiry')}
        />
      )}
      {parts.includes('reason') && (
        <div className={cn('grid gap-4', form.reason === 'OTHER' && 'sm:grid-cols-2')}>
          <Select label="Reason for the visit" labelClassName={big} value={form.reason} required onChange={(e) => set('reason', e.target.value as VisitorForm['reason'])} error={error('reason')}>
            <option value=""><Text>Choose</Text></option>
            {VISIT_REASONS.map((r) => <option key={r} value={r}><Text>{VISIT_REASON_LABELS[r]}</Text></option>)}
          </Select>
          {form.reason === 'OTHER' && (
            <Input label="What is the visit for?" labelClassName={big} value={form.reasonOther} required maxLength={80} onChange={(e) => set('reasonOther', e.target.value)} error={error('reasonOther')} />
          )}
        </div>
      )}
    </div>
  );
}

export interface VisitorDetailsView {
  citizenship: Citizenship | null;
  idLast4: string | null;
  /** The full number: only the guard's scan result has it. */
  idNumber?: string | null;
  transport: TransportMode | null;
  vehicleNo: string | null;
  licenceExpiry: string | null;
  reason: VisitReason | null;
  reasonOther: string | null;
}

/** The details as a short list. The household and the visitor see the last 4 characters of the number only. */
export function VisitorDetailsSummary({ details, vehicleNo, className, tone = 'plain' }: { details: VisitorDetailsView; vehicleNo?: string | null; className?: string; tone?: 'plain' | 'onColour' }) {
  const vehicle = details.vehicleNo ?? vehicleNo ?? null;
  // A translatable label and a value shown as it is (numbers, plates, the visitor's own words).
  const items: { key: string; icon: LucideIcon; label?: string; value?: string; strong?: boolean; joiner?: string }[] = [];
  if (details.citizenship) {
    items.push({ key: 'id', icon: IdCard, label: CITIZENSHIP_LABELS[details.citizenship], value: details.idNumber ?? maskedId(details.idLast4), strong: Boolean(details.idNumber) });
  }
  if (details.transport) {
    items.push({ key: 'transport', icon: details.transport === 'ON_FOOT' ? Footprints : details.transport === 'BICYCLE' || details.transport === 'MOTORCYCLE' ? Bike : Car, label: TRANSPORT_INFO[details.transport].label, value: vehicle ?? undefined });
  } else if (vehicle) {
    items.push({ key: 'transport', icon: Car, value: vehicle });
  }
  if (details.licenceExpiry) items.push({ key: 'licence', icon: BadgeCheck, label: 'Licence valid until', value: formatDate(details.licenceExpiry), joiner: ' ' });
  if (details.reason) {
    items.push(details.reason === 'OTHER' && details.reasonOther
      ? { key: 'reason', icon: MessageSquareText, value: details.reasonOther }
      : { key: 'reason', icon: MessageSquareText, label: VISIT_REASON_LABELS[details.reason] });
  }
  if (items.length === 0) {
    return <p className={cn('flex items-center gap-1.5 text-sm', tone === 'onColour' ? 'text-ink-700' : 'text-ink-500', className)}><CircleAlert className="size-4 shrink-0" aria-hidden /><Text>No visitor details yet</Text></p>;
  }
  return (
    <ul className={cn('flex flex-wrap gap-x-4 gap-y-1 text-sm', tone === 'onColour' ? 'text-ink-700' : 'text-ink-600', className)}>
      {items.map((item) => (
        <li key={item.key} className="inline-flex min-w-0 items-center gap-1.5">
          <item.icon className="size-4 shrink-0 text-ink-400" aria-hidden />
          <span className="min-w-0 break-words">
            {item.label && <Text>{item.label}</Text>}
            {item.label && item.value && (item.joiner ?? ' · ')}
            {item.value && <span className={cn(item.strong && 'font-semibold tabular-nums text-ink-900')}>{item.value}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
