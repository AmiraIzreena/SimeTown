'use client';

import { Text } from '@/components/ui/localized-text';
import { CopyButton } from '@/components/ui/copy-button';
import { LocalizedInput } from '@/components/ui/localized-elements';

import { ArrowRight, BellRing, Building, Camera, ChevronRight, ClipboardList, DoorOpen, House, KeyRound, Phone, ShieldCheck, Star, UserRound } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { SERVICE_CATEGORY_PAGE, serviceCategoryHref } from '@/components/features/home-service-categories';
import { BookingPhoto, BookingStatusBadge, BookingTimeline, PriceLine, Rating, REPORT_STATUS_LABELS, REPORT_STATUS_TONES, SERVICE_ICONS, SLOT_SHORT, Stars, type BookingEvent } from '@/components/features/home-services';
import { PreviewBadge, SimulatedNote } from '@/components/features/preview';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { Async, EmptyState, SkeletonList } from '@/components/ui/feedback';
import { Input, Select, Textarea } from '@/components/ui/field';
import { QrCode } from '@/components/ui/qr';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { PHOTO_ACCEPT, PHOTO_HINT, shrinkPhoto, usePhotoPick } from '@/lib/image';
import {
  formatPhone, SERVICE_CATEGORY_LABELS, SERVICE_REPORT_CATEGORIES, SERVICE_REPORT_CATEGORY_LABELS, SERVICE_SLOTS, SERVICE_SLOT_LABELS,
  type BookingStatus, type ServiceCategory, type ServicePricing, type ServiceReportStatus, type ServiceSlot,
} from '@/shared/domain';

export interface Provider {
  merchant_id: string;
  name: string;
  about: string | null;
  listing_id: string;
  category: ServiceCategory;
  /** The company's main trade: the first service it listed (picks its photo). */
  main_category?: ServiceCategory | null;
  description: string;
  pricing: ServicePricing;
  callout_fee_sen: number | null;
  price_note: string;
  rating: number | null;
  reviews: number;
  completed_jobs: number;
}
interface Listing {
  id: string;
  category: ServiceCategory;
  description: string;
  pricing: ServicePricing;
  callout_fee_sen: number | null;
  price_note: string;
}
export interface Profile {
  id: string;
  name: string;
  about: string | null;
  address: string | null;
  rating: number | null;
  reviews: { rating: number; comment: string | null; created_at: string; reviewer: string; category: ServiceCategory }[];
  completed_jobs: number;
  listings: Listing[];
}
interface Booking {
  id: string;
  status: BookingStatus;
  category: ServiceCategory;
  merchantId: string;
  merchantName: string;
  pricing: ServicePricing;
  calloutFeeSen: number | null;
  priceNote: string;
  problem: string;
  hasPhoto: boolean;
  preferredDate: string;
  preferredSlot: ServiceSlot;
  scheduledAt: string | null;
  providerNote: string | null;
  closedReason: string | null;
  worker: { id: string; name: string } | null;
  review: { rating: number; comment: string | null } | null;
  createdAt: string;
  updatedAt: string;
}
interface BookingDetail extends Booking {
  companyPhone: string | null;
  pass: { code: string; validFrom: string; validUntil: string } | null;
  history: BookingEvent[];
  reports: { id: string; category: string; status: ServiceReportStatus; created_at: string }[];
  can: { cancel: boolean; confirm: boolean; review: boolean; report: boolean; sendPass: boolean };
}
interface IssuedPass {
  code: string;
  token: string;
  validUntil: string;
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());

/** What the booking form needs to know about a company's listing. */
export type Bookable = Pick<Provider, 'listing_id' | 'name' | 'category' | 'pricing' | 'callout_fee_sen' | 'price_note'>;
interface Rebook {
  listingId: string;
  merchantName: string;
  category: ServiceCategory;
  pricing: ServicePricing;
  calloutFeeSen: number | null;
  priceNote: string;
}
const toBookable = (r: Rebook): Bookable => ({ listing_id: r.listingId, name: r.merchantName, category: r.category, pricing: r.pricing, callout_fee_sen: r.calloutFeeSen, price_note: r.priceNote });
interface Logbook {
  entries: { id: string; category: ServiceCategory; completedAt: string; merchantName: string; workerName: string | null; providerNote: string | null; mine: boolean; problem: string | null; rating: number | null; rebook: Rebook | null }[];
  reminders: { category: ServiceCategory; lastAt: string; dueAt: string; daysLeft: number; state: 'OK' | 'DUE_SOON' | 'OVERDUE' | 'BOOKED'; rebook: Rebook | null }[];
}

export function HomeServicesScreen({ initialBooking }: { initialBooking: string | null }) {
  const categories = useApi<{ category: ServiceCategory; providers: number }[]>('/home-services/categories');
  const bookings = useApi<Booking[]>('/home-services/bookings');
  const [booking, setBooking] = useState<Bookable | null>(null);
  const logbook = useApi<Logbook>('/home-services/logbook');
  const [openId, setOpenId] = useState<string | null>(initialBooking);

  const reload = () => {
    void bookings.mutate();
    void logbook.mutate();
  };

  return (
    <>
      <PageHeader title="SimeTown Home" description="Book a township service company. You see who is coming before they arrive, and you agree the price with them in person before any work starts." />
      <div className="space-y-6">
        <SimulatedNote><Text>The companies, workers and reviews here are demo data. SimeTown takes no payment: you pay the company directly.</Text></SimulatedNote>

        {bookings.data && bookings.data.length > 0 && (
          <Card>
            <CardHeader title="My bookings" description="Open bookings first. Tap one to see who is coming and what happens next." />
            <ul className="divide-y divide-ink-100">
              {bookings.data.map((b) => {
                const Icon = SERVICE_ICONS[b.category];
                return (
                  <li key={b.id}>
                    <button type="button" onClick={() => setOpenId(b.id)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-ink-25">
                      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700"><Icon className="size-5" aria-hidden /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-ink-900">{b.merchantName}</span>
                        <span className="block truncate text-sm text-ink-500">
                          <Text>{SERVICE_CATEGORY_LABELS[b.category]}</Text>
                          {' · '}
                          {b.scheduledAt ? <Text>{formatDateTime(b.scheduledAt)}</Text> : <><Text>{formatDate(b.preferredDate)}</Text>, <Text>{SLOT_SHORT[b.preferredSlot]}</Text></>}
                          {b.worker && <> · {b.worker.name}</>}
                        </span>
                      </span>
                      <BookingStatusBadge status={b.status} />
                      <ChevronRight className="size-4 shrink-0 text-ink-400" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        {logbook.data && <HomeLogbook data={logbook.data} onBook={(r) => setBooking(toBookable(r))} />}

        <Card>
          <CardHeader title="Book a home service" description="Choose what you need, compare the companies serving the township, and send your request." />
          {/* Each category opens its own page with every company serving the township and their reviews. */}
          <div className="stagger-in grid grid-cols-2 gap-3 p-5 sm:grid-cols-3">
            {categories.isLoading && <SkeletonList rows={2} className="col-span-full" />}
            {categories.data?.map((c) => {
              const Icon = SERVICE_ICONS[c.category];
              return (
                <Link key={c.category} href={serviceCategoryHref(c.category)} className="category-tile group relative overflow-hidden rounded-xl border border-ink-200 bg-white text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
                  <span className="relative block h-32 overflow-hidden sm:h-40">
                    <Image src={SERVICE_CATEGORY_PAGE[c.category].card} alt="" fill sizes="(min-width: 640px) 33vw, 50vw" className="category-tile-img object-cover" style={{ objectPosition: SERVICE_CATEGORY_PAGE[c.category].focus }} />
                    <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-brand-950/55 to-transparent" />
                    <span className="absolute bottom-2 left-3 grid size-8 place-items-center rounded-lg bg-white/95 text-brand-700 shadow-sm"><Icon className="size-4" aria-hidden /></span>
                  </span>
                  <span className="flex items-center justify-between gap-2 p-3.5">
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-semibold text-ink-900"><Text>{SERVICE_CATEGORY_LABELS[c.category]}</Text></span>
                      <span className="block text-sm text-ink-500"><Text>{c.providers === 0 ? 'No companies yet' : c.providers === 1 ? '1 company' : `${c.providers} companies`}</Text></span>
                    </span>
                    <ArrowRight className="category-tile-arrow size-4 shrink-0 text-ink-400" aria-hidden />
                  </span>
                </Link>
              );
            })}
          </div>
          <div className="border-t border-ink-100 px-5 py-3">
            <Button href="/app/tamu" variant="ghost" size="sm"><DoorOpen className="size-4" aria-hidden /><Text>Send a contractor pass now in Tamu</Text></Button>
          </div>
        </Card>

        <div>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-lg font-semibold text-ink-900"><Text>Coming later</Text></h2>
            <PreviewBadge><Text>Coming soon</Text></PreviewBadge>
          </div>
          <div className="home-service-grid grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Resale and rental inside the township" description="Listings from residents, seen by residents first." />
              <ul className="divide-y divide-ink-100">
                {[
                  { title: 'Terrace house, 4 bedrooms (sample listing)', text: 'Elmina Valley 2 · for rent', icon: House },
                  { title: 'Pangsapuri Harmoni Elmina, 3 bedrooms (sample listing)', text: 'Block A, mid floor · for sale', icon: Building },
                ].map((l) => (
                  <li key={l.title} className="flex items-center gap-3 px-5 py-3.5">
                    <span className="grid size-10 shrink-0 place-items-center rounded-md bg-gold-50 text-gold-700"><l.icon className="size-5" aria-hidden /></span>
                    <span>
                      <span className="block text-[15px] font-semibold text-ink-900"><Text>{l.title}</Text></span>
                      <span className="block text-sm text-ink-500"><Text>{l.text}</Text></span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="border-t border-ink-100 px-5 py-3">
                <Button variant="ghost" size="sm" disabled><KeyRound className="size-4" aria-hidden /><Text>Registration opens soon</Text></Button>
              </div>
            </Card>
          </div>
        </div>
      </div>

      <BookForm
        provider={booking}
        onClose={() => setBooking(null)}
        onBooked={(id) => {
          setBooking(null);
          reload();
          setOpenId(id);
        }}
      />
      <BookingDetailModal id={openId} onClose={() => setOpenId(null)} onChanged={reload} />
    </>
  );
}

const REMINDER_BADGE = { OK: ['Up to date', 'success'], DUE_SOON: ['Due soon', 'gold'], OVERDUE: ['Overdue', 'danger'], BOOKED: ['Booked', 'brand'] } as const;

/** The home's record of confirmed jobs, with "book again" and reminders for services that come round again. */
function HomeLogbook({ data, onBook }: { data: Logbook; onBook: (r: Rebook) => void }) {
  const [showAll, setShowAll] = useState(false);
  const entries = showAll ? data.entries : data.entries.slice(0, 5);
  return (
    <Card>
      <CardHeader title="Home logbook" description="Every job confirmed at this home, and when a service is due again. Shared with everyone registered at this home." />
      {data.reminders.length > 0 && (
        <ul className="space-y-2 border-b border-ink-100 p-5">
          {data.reminders.map((r) => {
            const Icon = SERVICE_ICONS[r.category];
            const [label, tone] = REMINDER_BADGE[r.state];
            const urgent = r.state === 'DUE_SOON' || r.state === 'OVERDUE';
            return (
              <li key={r.category} className={cn('flex flex-wrap items-center gap-3 rounded-lg border p-3', urgent ? 'border-gold-300 bg-gold-50' : 'border-ink-200')}>
                <span className="grid size-10 shrink-0 place-items-center rounded-md bg-white text-brand-700">{urgent ? <BellRing className="size-5" aria-hidden /> : <Icon className="size-5" aria-hidden />}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink-900"><Text>{SERVICE_CATEGORY_LABELS[r.category]}</Text><Badge tone={tone}><Text>{label}</Text></Badge></span>
                  <span className="block text-sm text-ink-600">
                    <Text>Last done </Text><Text>{formatDate(r.lastAt)}</Text>
                    {' · '}
                    <Text>{r.state === 'BOOKED' ? 'Already booked' : r.daysLeft < 0 ? 'Was due ' : 'Next due '}</Text>
                    {r.state !== 'BOOKED' && <Text>{formatDate(r.dueAt)}</Text>}
                  </span>
                </span>
                {r.rebook && r.state !== 'BOOKED' && <Button size="sm" variant={urgent ? 'primary' : 'secondary'} onClick={() => onBook(r.rebook!)}><Text>Book again</Text></Button>}
              </li>
            );
          })}
        </ul>
      )}
      {data.entries.length === 0 ? (
        <div className="p-5">
          <EmptyState icon={ClipboardList} title="Nothing recorded yet"><Text>When you confirm a job is done, it is added here with the company, the worker and what was done.</Text></EmptyState>
        </div>
      ) : (
        <ul className="divide-y divide-ink-100">
          {entries.map((e) => {
            const Icon = SERVICE_ICONS[e.category];
            return (
              <li key={e.id} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
                <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700"><Icon className="size-5" aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-ink-900"><Text>{SERVICE_CATEGORY_LABELS[e.category]}</Text>{e.problem && <span className="font-normal text-ink-600">: {e.problem}</span>}</span>
                  <span className="block text-sm text-ink-500">
                    {e.merchantName}{e.workerName && <> · {e.workerName}</>} · <Text>{formatDate(e.completedAt)}</Text>
                    {!e.mine && <> · <Text>booked by someone else at this home</Text></>}
                  </span>
                  {e.providerNote && <span className="block text-sm text-ink-700">{e.providerNote}</span>}
                  {e.rating !== null && <Stars rating={e.rating} />}
                </span>
                {e.rebook && <Button size="sm" variant="ghost" onClick={() => onBook(e.rebook!)}><Text>Book again</Text></Button>}
              </li>
            );
          })}
        </ul>
      )}
      {data.entries.length > 5 && (
        <div className="border-t border-ink-100 px-5 py-3">
          <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}><Text>{showAll ? 'Show fewer' : 'Show all'}</Text></Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 px-5 py-3 text-sm text-ink-500">
        <ShieldCheck className="size-4" aria-hidden /><Text>Warranty and defect records from Sime Darby Property</Text> <PreviewBadge><Text>Coming soon</Text></PreviewBadge>
      </div>
    </Card>
  );
}

export function ProviderProfile({ merchantId, onClose }: { merchantId: string | null; onClose: () => void }) {
  const profile = useApi<Profile>(merchantId ? `/home-services/providers/${merchantId}` : null);
  const p = profile.data;
  return (
    <Modal open={merchantId !== null} onClose={onClose} title={p?.name ?? 'Company'} description={p?.address ?? undefined}>
      <Async state={profile}>
        {(data) => (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <Rating rating={data.rating} reviews={data.reviews.length} />
              <Badge tone="success"><ShieldCheck className="size-3.5" aria-hidden /><Text>Approved by the township office</Text></Badge>
            </div>
            {data.about && <p className="whitespace-pre-line text-[15px] text-ink-700">{data.about}</p>}
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-500"><Text>Services</Text></h3>
              <ul className="mt-2 space-y-2">
                {data.listings.map((l) => (
                  <li key={l.id} className="rounded-md border border-ink-200 p-3">
                    <p className="font-semibold text-ink-900"><Text>{SERVICE_CATEGORY_LABELS[l.category]}</Text></p>
                    <p className="text-sm text-ink-700">{l.description}</p>
                    <PriceLine pricing={l.pricing} calloutFeeSen={l.callout_fee_sen} priceNote={l.price_note} />
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-500"><Text>Reviews from completed bookings</Text></h3>
              {data.reviews.length === 0 ? (
                <p className="mt-2 text-sm text-ink-500"><Text>No reviews yet.</Text></p>
              ) : (
                <ul className="mt-2 space-y-3">
                  {data.reviews.map((r, i) => (
                    <li key={i} className="rounded-md bg-ink-25 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Stars rating={r.rating} />
                        <span className="text-sm text-ink-600">{r.reviewer} · <Text>{SERVICE_CATEGORY_LABELS[r.category]}</Text> · <Text>{formatDate(r.created_at)}</Text></span>
                      </div>
                      {r.comment && <p className="mt-1 text-[15px] text-ink-700">{r.comment}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Async>
    </Modal>
  );
}

export function BookForm({ provider, onClose, onBooked }: { provider: Bookable | null; onClose: () => void; onBooked: (id: string) => void }) {
  const [photoName, setPhotoName] = useState<string | null>(null);
  const pickPhoto = usePhotoPick();
  const create = useAction(
    async (data: FormData) => {
      const photo = data.get('photo');
      if (photo instanceof File && photo.size > 0) data.set('photo', await shrinkPhoto(photo), 'photo.jpg');
      else data.delete('photo');
      return api.post<{ id: string }>('/home-services/bookings', data);
    },
    {
      success: 'Request sent. The company will accept it or suggest another time.',
      onSuccess: (r) => {
        setPhotoName(null);
        onBooked(r.id);
      },
    },
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.set('listingId', provider!.listing_id);
    void create.run(data);
  };
  const f = create.fields;
  return (
    <Modal
      open={provider !== null}
      onClose={onClose}
      title="Book a visit"
      description={provider ? <>{provider.name} · <Text>{SERVICE_CATEGORY_LABELS[provider.category]}</Text></> : undefined}
      footer={<><Button variant="secondary" onClick={onClose}><Text>Cancel</Text></Button><Button type="submit" form="book-service" pending={create.pending}><Text>Send request</Text></Button></>}
    >
      {provider && (
        <form id="book-service" method="post" onSubmit={submit} className="space-y-4" noValidate>
          <div className="rounded-lg bg-brand-50 p-4 text-[15px] text-brand-900">
            <p className="font-semibold"><Text>Before you book</Text></p>
            <div className="mt-1"><PriceLine pricing={provider.pricing} calloutFeeSen={provider.callout_fee_sen} priceNote={provider.price_note} /></div>
            <p className="mt-2 text-sm"><Text>The worker inspects the problem and agrees the price with you before starting. Only charges shown here or agreed with you may apply. SimeTown takes no payment.</Text></p>
          </div>
          <Textarea label="What is the problem?" name="problem" maxLength={1000} placeholder="e.g. The pipe under the kitchen sink is leaking" required error={f.problem} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Preferred date" name="preferredDate" type="date" min={today()} defaultValue={today()} required error={f.preferredDate} />
            <Select label="Preferred time" name="preferredSlot" defaultValue="MORNING" error={f.preferredSlot}>
              {SERVICE_SLOTS.map((s) => <option key={s} value={s}><Text>{SERVICE_SLOT_LABELS[s]}</Text></option>)}
            </Select>
          </div>
          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-dashed border-ink-300 px-4 py-3 text-[15px] text-ink-700 transition-colors duration-200 hover:border-brand-500 hover:bg-brand-50/40 focus-within:border-brand-500">
            <Camera className="size-5 shrink-0 text-ink-500" aria-hidden /><span className="min-w-0 flex-1"><span className="block truncate"><Text>{photoName ?? 'Add a photo of the problem (optional)'}</Text></span><span className="block text-xs text-ink-500"><Text>{PHOTO_HINT}</Text></span></span>
            <LocalizedInput type="file" name="photo" accept={PHOTO_ACCEPT} capture="environment" className="sr-only" onChange={(event) => setPhotoName(pickPhoto(event.target)?.name ?? null)} />
          </label>
          <p className="text-sm text-ink-500"><Text>The company sees your first name and the problem. Your address and phone number are shared only once it accepts.</Text></p>
        </form>
      )}
    </Modal>
  );
}

function BookingDetailModal({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const detail = useApi<BookingDetail>(id ? `/home-services/bookings/${id}` : null, { refreshInterval: 30_000 });
  const t = useT();
  const toast = useToast();
  const [askCancel, setAskCancel] = useState(false);
  const [rating, setRating] = useState(5);
  const [issued, setIssued] = useState<IssuedPass | null>(null);
  const [showReport, setShowReport] = useState(false);
  const refresh = () => {
    void detail.mutate();
    onChanged();
  };
  const cancel = useAction(() => api.post(`/home-services/bookings/${id}/cancel`, {}), { success: 'Booking cancelled.', onSuccess: () => { setAskCancel(false); refresh(); } });
  const confirm = useAction(() => api.post(`/home-services/bookings/${id}/confirm`), { success: 'Thank you. The job is marked as done.', onSuccess: refresh });
  const review = useAction((comment: string) => api.post(`/home-services/bookings/${id}/review`, { rating, comment: comment.trim() || undefined }), { success: 'Thank you for your review.', onSuccess: refresh });
  const report = useAction((category: string, description: string) => api.post(`/home-services/bookings/${id}/reports`, { category, description }), {
    success: 'Report sent privately to the township team. The company does not see it.',
    onSuccess: () => { setShowReport(false); refresh(); },
  });
  const pass = useAction(() => api.post<IssuedPass>(`/home-services/bookings/${id}/pass`), { onSuccess: (p) => { setIssued(p); refresh(); } });

  const d = detail.data;
  const link = issued ? `${typeof window === 'undefined' ? '' : window.location.origin}/pass/${issued.token}` : '';

  return (
    <>
      <Modal open={id !== null && issued === null} onClose={onClose} title={d ? d.merchantName : 'Booking'} description={d ? SERVICE_CATEGORY_LABELS[d.category] : undefined}>
        <Async state={detail}>
          {(b) => (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <BookingStatusBadge status={b.status} />
                <span className="text-sm text-ink-600">
                  {b.scheduledAt ? <><Text>Visit: </Text><Text>{formatDateTime(b.scheduledAt)}</Text></> : <><Text>You asked for </Text><Text>{formatDate(b.preferredDate)}</Text>, <Text>{SLOT_SHORT[b.preferredSlot]}</Text></>}
                </span>
              </div>

              {b.worker && ['SCHEDULED', 'IN_PROGRESS', 'WORK_DONE'].includes(b.status) && (
                <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand-600"><Text>Who is coming</Text></p>
                  <div className="mt-2 flex items-center gap-3">
                    <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-brand-700"><UserRound className="size-5" aria-hidden /></span>
                    <div className="min-w-0">
                      <p className="text-[16px] font-semibold text-ink-900">{b.worker.name}</p>
                      <p className="text-sm text-ink-600"><Text>Registered worker at </Text>{b.merchantName}</p>
                    </div>
                  </div>
                  {b.companyPhone && (
                    <Button href={`tel:${b.companyPhone}`} variant="secondary" size="sm" className="mt-3"><Phone className="size-4" aria-hidden /><Text>Call the company</Text> {formatPhone(b.companyPhone)}</Button>
                  )}
                  {b.pass ? (
                    <div className="mt-3 text-sm text-ink-700">
                      <p className="flex items-center gap-2"><DoorOpen className="size-4" aria-hidden /><Text>Gate pass </Text><strong>{b.pass.code}</strong><Text> until </Text><Text>{formatDateTime(b.pass.validUntil)}</Text></p>
                      <p className="mt-0.5 text-ink-500"><Text>Made automatically. The company has the code, and the worker shows it at the main gate. Nothing for you to do.</Text></p>
                    </div>
                  ) : b.can.sendPass ? (
                    <Button size="sm" className="mt-3" onClick={() => void pass.run()} pending={pass.pending}><DoorOpen className="size-4" aria-hidden /><Text>Make a new gate pass</Text></Button>
                  ) : null}
                </div>
              )}
              {b.status === 'ACCEPTED' && b.companyPhone && (
                <Button href={`tel:${b.companyPhone}`} variant="secondary" size="sm"><Phone className="size-4" aria-hidden /><Text>Call the company</Text> {formatPhone(b.companyPhone)}</Button>
              )}
              {b.status === 'ACCEPTED' && <p className="text-sm text-ink-600"><Text>The company will tell you which worker is coming before the visit.</Text></p>}

              {b.providerNote && (
                <div className="rounded-lg bg-ink-25 p-3 text-[15px] text-ink-700">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>From the company</Text></p>
                  <p className="mt-1">{b.providerNote}</p>
                </div>
              )}
              {b.closedReason && <p className="text-[15px] text-ink-700"><Text>Reason: </Text>{b.closedReason}</p>}

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Your request</Text></p>
                <p className="mt-1 whitespace-pre-line text-[15px] text-ink-700">{b.problem}</p>
                {b.hasPhoto && <div className="mt-2"><BookingPhoto bookingId={b.id} /></div>}
                <div className="mt-2"><PriceLine pricing={b.pricing} calloutFeeSen={b.calloutFeeSen} priceNote={b.priceNote} /></div>
              </div>

              {b.status === 'WORK_DONE' && <p className="rounded-lg bg-brand-50 px-3 py-2 text-[15px] text-brand-900"><Text>The company says the work is finished. Confirm only if you are satisfied; otherwise report the problem below.</Text></p>}
              {(b.can.confirm || b.can.cancel) && (
                <div className="flex flex-wrap gap-2">
                  {b.can.confirm && <Button variant="success" onClick={() => void confirm.run()} pending={confirm.pending}><Text>The job is done</Text></Button>}
                  {b.can.cancel && <Button variant="secondary" onClick={() => setAskCancel(true)}><Text>Cancel booking</Text></Button>}
                </div>
              )}

              {b.can.review && (
                <form
                  method="post"
                  className="space-y-3 rounded-lg border border-ink-200 p-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void review.run(String(new FormData(event.currentTarget).get('comment') ?? ''));
                  }}
                >
                  <p className="font-semibold text-ink-900"><Text>How did it go?</Text></p>
                  <fieldset>
                    <legend className="mb-1 text-sm font-semibold text-ink-900"><Text>Rating</Text></legend>
                    <div className="flex gap-1" role="radiogroup">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          role="radio"
                          aria-checked={rating === n}
                          aria-label={t(`${n} out of 5`)}
                          onClick={() => setRating(n)}
                          className="grid size-11 place-items-center rounded-md transition-colors hover:bg-gold-50"
                        >
                          <Star className={cn('size-7', n <= rating ? 'fill-gold-400 text-gold-500' : 'text-ink-300')} aria-hidden />
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <Textarea label="Comment (optional)" name="comment" maxLength={500} placeholder="Other residents will see this, with your first name." error={review.fields.comment} />
                  <Button type="submit" size="sm" pending={review.pending}><Text>Post review</Text></Button>
                </form>
              )}
              {b.review && (
                <div className="rounded-lg bg-ink-25 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Your review</Text></p>
                  <Stars rating={b.review.rating} />
                  {b.review.comment && <p className="mt-1 text-[15px] text-ink-700">{b.review.comment}</p>}
                </div>
              )}

              {b.reports.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Your private reports</Text></p>
                  <ul className="mt-1 space-y-1">
                    {b.reports.map((r) => (
                      <li key={r.id} className="flex items-center gap-2 text-sm text-ink-700">
                        <Badge tone={REPORT_STATUS_TONES[r.status]}><Text>{REPORT_STATUS_LABELS[r.status]}</Text></Badge>
                        <Text>{SERVICE_REPORT_CATEGORY_LABELS[r.category as keyof typeof SERVICE_REPORT_CATEGORY_LABELS] ?? r.category}</Text> · <Text>{formatDate(r.created_at)}</Text>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {b.can.report && !showReport && (
                <Button variant="ghost" size="sm" onClick={() => setShowReport(true)}><ShieldCheck className="size-4" aria-hidden /><Text>Report a problem privately</Text></Button>
              )}
              {showReport && (
                <form
                  method="post"
                  className="space-y-3 rounded-lg border border-accent-200 bg-accent-50/40 p-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    void report.run(String(data.get('category')), String(data.get('description') ?? ''));
                  }}
                >
                  <p className="font-semibold text-ink-900"><Text>Report a problem</Text></p>
                  <p className="text-sm text-ink-600"><Text>Only the township team sees this. It is linked to this booking and the worker assigned. If you are in danger, call 999 first.</Text></p>
                  <Select label="What happened?" name="category" defaultValue="MISCONDUCT" error={report.fields.category}>
                    {SERVICE_REPORT_CATEGORIES.map((c) => <option key={c} value={c}><Text>{SERVICE_REPORT_CATEGORY_LABELS[c]}</Text></option>)}
                  </Select>
                  <Textarea label="Tell us more" name="description" maxLength={1000} required error={report.fields.description} />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" variant="danger" pending={report.pending}><Text>Send report</Text></Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setShowReport(false)}><Text>Cancel</Text></Button>
                  </div>
                </form>
              )}

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>History</Text></p>
                <BookingTimeline events={b.history} />
              </div>
            </div>
          )}
        </Async>
      </Modal>

      <ConfirmDialog open={askCancel} onClose={() => setAskCancel(false)} onConfirm={() => void cancel.run()} title="Cancel this booking?" confirmLabel="Cancel booking" destructive pending={cancel.pending}>
        <p><Text>The company is told at once. Any gate pass for the visit stops working.</Text></p>
      </ConfirmDialog>

      <Modal open={issued !== null} onClose={() => setIssued(null)} title="Gate pass for the worker" description="The company sees this pass in its bookings. The worker shows the QR code, or tells the guard the code, at the main gate.">
        {issued && (
          <div className="flex flex-col items-center gap-4">
            <QrCode value={`KITAPASS:${issued.code}`} label={`Visitor pass ${issued.code}`} />
            <p className="font-display text-2xl font-bold tracking-[0.18em] text-ink-900"><Text>{issued.code}</Text></p>
            <p className="text-sm text-ink-600"><Text>Valid until </Text><Text>{formatDateTime(issued.validUntil)}</Text><Text>. The company can also see the code in its bookings.</Text></p>
            <div className="grid w-full gap-2">
              <CopyButton
                variant="secondary"
                text={link}
                onCopied={() => toast.show('Link copied.', 'success')}
                onError={() => toast.show('Could not copy. Press and hold the link to copy it.', 'error')}
              />
            </div>
            <p className="w-full break-all rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-600"><Text>{link}</Text></p>
            <p className="text-xs text-ink-500"><Text>If the company changes the worker, this pass stops working and you can send a new one.</Text></p>
          </div>
        )}
      </Modal>
    </>
  );
}
