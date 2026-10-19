'use client';

import { Text } from '@/components/ui/localized-text';

import { Droplets, Hammer, Paintbrush, Sparkles, Star, Wind, Zap, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/card';
import { LocalizedImg } from '@/components/ui/localized-elements';
import { formatDateTime } from '@/lib/format';
import {
  BOOKING_STATUS_LABELS, SERVICE_PRICING_LABELS, formatRM,
  type BookingStatus, type ServiceCategory, type ServicePricing, type ServiceReportStatus, type ServiceSlot,
} from '@/shared/domain';

/** SimeTown Home Services: pieces shared by the resident, company and staff screens. */

export const SERVICE_ICONS: Record<ServiceCategory, LucideIcon> = {
  PLUMBING: Droplets,
  ELECTRICAL: Zap,
  AIRCON: Wind,
  CLEANING: Sparkles,
  REPAIRS: Hammer,
  RENOVATION: Paintbrush,
};

const TONES: Record<BookingStatus, 'gold' | 'brand' | 'warning' | 'success' | 'neutral'> = {
  REQUESTED: 'gold',
  ACCEPTED: 'brand',
  SCHEDULED: 'brand',
  IN_PROGRESS: 'brand',
  WORK_DONE: 'warning',
  COMPLETED: 'success',
  DECLINED: 'neutral',
  CANCELLED: 'neutral',
};

/** The company sees the same states in its own words. */
const COMPANY_LABELS: Partial<Record<BookingStatus, string>> = { REQUESTED: 'New request', ACCEPTED: 'Needs a worker', WORK_DONE: 'Waiting for the resident' };

export function BookingStatusBadge({ status, company = false }: { status: BookingStatus; company?: boolean }) {
  return <Badge tone={TONES[status]}><Text>{(company && COMPANY_LABELS[status]) || BOOKING_STATUS_LABELS[status]}</Text></Badge>;
}

export function Rating({ rating, reviews }: { rating: number | null; reviews: number }) {
  if (!rating || reviews === 0) return <span className="text-sm text-ink-500"><Text>No reviews yet</Text></span>;
  return (
    <span className="inline-flex items-center gap-1 text-sm font-semibold text-ink-800">
      <Star className="size-4 fill-gold-400 text-gold-500" aria-hidden />
      <Text>{`${rating.toFixed(1)} out of 5`}</Text>
      <span className="font-normal text-ink-500"><Text>{reviews === 1 ? '(1 review)' : `(${reviews} reviews)`}</Text></span>
    </span>
  );
}

export function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex">
      <span className="sr-only"><Text>{`${rating} out of 5`}</Text></span>
      {[1, 2, 3, 4, 5].map((n) => <Star key={n} className={n <= rating ? 'size-4 fill-gold-400 text-gold-500' : 'size-4 text-ink-300'} aria-hidden />)}
    </span>
  );
}

/** How the job is priced, with any call-out fee, shown before the resident books. */
export function PriceLine({ pricing, calloutFeeSen, priceNote }: { pricing: ServicePricing; calloutFeeSen: number | null; priceNote: string }) {
  return (
    <span className="block text-sm text-ink-600">
      <span className="font-semibold text-ink-800"><Text>{SERVICE_PRICING_LABELS[pricing]}</Text></span>
      {' · '}
      <Text>{calloutFeeSen ? `Call-out fee ${formatRM(calloutFeeSen)}` : 'No call-out fee'}</Text>
      <span className="block text-ink-500">{priceNote}</span>
    </span>
  );
}

export const SLOT_SHORT: Record<ServiceSlot, string> = { MORNING: 'morning', AFTERNOON: 'afternoon', EVENING: 'evening' };

export function BookingPhoto({ bookingId }: { bookingId: string }) {
  return <LocalizedImg src={`/api/v1/home-services/bookings/${bookingId}/photo`} alt="Photo of the problem" loading="lazy" className="max-h-64 w-full rounded-lg border border-ink-200 object-cover" />;
}

export interface BookingEvent {
  kind: 'STATUS' | 'WORKER' | 'PASS';
  from_status: BookingStatus | null;
  to_status: BookingStatus | null;
  worker_name: string | null;
  note: string | null;
  created_at: string;
  /** SYSTEM: done automatically, such as the gate pass made when a worker is assigned. */
  actor: 'RESIDENT' | 'COMPANY' | 'STAFF' | 'SYSTEM';
}

function eventLabel(e: BookingEvent): string {
  if (e.kind === 'PASS') return 'Gate pass ready';
  if (e.kind === 'WORKER') return e.from_status === 'SCHEDULED' ? 'Worker changed' : 'Worker assigned';
  switch (e.to_status) {
    case 'REQUESTED': return 'Booking requested';
    case 'ACCEPTED': return 'Company accepted';
    case 'IN_PROGRESS': return 'Worker arrived';
    case 'WORK_DONE': return 'Company marked the work done';
    case 'COMPLETED': return 'Resident confirmed the job is done';
    case 'DECLINED': return 'Company declined';
    case 'CANCELLED': return e.actor === 'RESIDENT' ? 'Cancelled by the resident' : 'Cancelled by the company';
    default: return 'Updated';
  }
}

/** The booking's history: every change, who made it and when. */
export function BookingTimeline({ events, showPassCode = false }: { events: BookingEvent[]; showPassCode?: boolean }) {
  return (
    <ol className="space-y-3 border-l-2 border-ink-100 pl-4">
      {events.map((e, i) => (
        <li key={i} className="relative">
          <span aria-hidden className="absolute -left-[1.4rem] top-1.5 size-2.5 rounded-full bg-brand-500" />
          <p className="text-sm font-semibold text-ink-800">
            <Text>{eventLabel(e)}</Text>
            {e.kind === 'WORKER' && e.worker_name && <span className="font-normal">: {e.worker_name}</span>}
          </p>
          {e.note && (e.kind !== 'PASS' || showPassCode) && <p className="text-sm text-ink-600">{e.note}</p>}
          <p className="text-xs text-ink-500"><Text>{formatDateTime(e.created_at)}</Text></p>
        </li>
      ))}
    </ol>
  );
}

export const REPORT_STATUS_LABELS: Record<ServiceReportStatus, string> = { NEW: 'Received', REVIEWING: 'Under review', CLOSED: 'Closed' };
export const REPORT_STATUS_TONES: Record<ServiceReportStatus, 'gold' | 'brand' | 'neutral'> = { NEW: 'gold', REVIEWING: 'brand', CLOSED: 'neutral' };
