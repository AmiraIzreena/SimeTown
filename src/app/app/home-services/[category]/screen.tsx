'use client';

import { Text } from '@/components/ui/localized-text';

import { Briefcase, MessageSquareQuote, ShieldCheck, Wrench } from 'lucide-react';
import Image from 'next/image';
import { BackLink } from '@/components/ui/back-link';
import { useRouter } from 'next/navigation';
import { useState, type CSSProperties } from 'react';
import { SERVICE_CATEGORY_PAGE } from '@/components/features/home-service-categories';
import { PriceLine, Rating, SERVICE_ICONS, Stars } from '@/components/features/home-services';
import { Button } from '@/components/ui/button';
import { Async, EmptyState, Skeleton } from '@/components/ui/feedback';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { SERVICE_CATEGORY_LABELS, type ServiceCategory } from '@/shared/domain';
import { BookForm, ProviderProfile, type Bookable, type Profile, type Provider } from '../screen';

/**
 * A home service category on its own page: a photo hero, then every company serving the township
 * as a card with its rating, price, what residents said and the two actions (book, full profile).
 * Booking uses the same form as before; afterwards the resident lands on the booking in SimeTown Home.
 */
export function ServiceCategoryScreen({ category }: { category: ServiceCategory }) {
  const router = useRouter();
  const page = SERVICE_CATEGORY_PAGE[category];
  const Icon = SERVICE_ICONS[category];
  const providers = useApi<Provider[]>(`/home-services/providers?category=${category}`);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [booking, setBooking] = useState<Bookable | null>(null);
  const count = providers.data?.length;

  return (
    <div className="space-y-6">
      <BackLink href="/app/home-services"><Text>Back to SimeTown Home</Text></BackLink>

      {/* Hero: the category photo under a SimeTown brown wash, with what the category covers. */}
      <header className="service-hero relative isolate overflow-hidden rounded-2xl text-white shadow-lg">
        <Image src={page.hero} alt="" fill priority sizes="(min-width: 1280px) 1200px, 100vw" className="service-hero-img -z-10 object-cover" />
        {/* A strong brown wash behind the text, fading out on the right, so white text reads on any photo. */}
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-brand-950/95 via-brand-950/75 to-brand-950/25" />
        <div className="max-w-2xl px-6 py-10 sm:px-10 sm:py-14">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-200">
            <Icon className="size-4" aria-hidden /><Text>SimeTown Home</Text>
          </p>
          <h1 className="mt-3 text-[34px] font-bold leading-tight tracking-tight text-white [text-shadow:0_2px_18px_rgb(45_20_7/0.55)] sm:text-[42px]"><Text>{SERVICE_CATEGORY_LABELS[category]}</Text></h1>
          <p className="mt-2 text-[15px] font-medium text-white/90 [text-shadow:0_1px_10px_rgb(45_20_7/0.6)]"><Text>{page.summary}</Text></p>
          {/* A div, not a p: the count's loading skeleton is a div, which a p cannot contain. */}
          <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 font-semibold ring-1 ring-white/25 backdrop-blur-sm">
              <Briefcase className="size-4" aria-hidden />
              {count === undefined ? <Skeleton className="h-4 w-16 bg-white/30" /> : <Text>{count === 1 ? '1 company' : `${count} companies`}</Text>}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 font-semibold ring-1 ring-white/25 backdrop-blur-sm">
              <ShieldCheck className="size-4" aria-hidden /><Text>Approved by the township office</Text>
            </span>
          </div>
        </div>
      </header>

      <section aria-labelledby="companies-title" className="space-y-4">
        <div>
          <h2 id="companies-title" className="font-display text-xl font-bold text-ink-900"><Text>Companies serving the township</Text></h2>
          <p className="mt-1 text-sm text-ink-500"><Text>Compare ratings, prices and what residents said, then send your request. You agree the price with the company in person before any work starts.</Text></p>
        </div>
        <Async
          state={providers}
          skeleton={<div className="grid gap-5 lg:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-[30rem] rounded-2xl" />)}</div>}
        >
          {(list) =>
            list.length === 0 ? (
              <EmptyState icon={Wrench} title="No companies offer this yet"><Text>The township office is inviting more companies. Try another service for now.</Text></EmptyState>
            ) : (
              <div className="stagger-in grid gap-5 lg:grid-cols-2">
                {list.map((p, i) => (
                  <CompanyCard key={p.listing_id} provider={p} image={page.card} index={i} onBook={() => setBooking(p)} onProfile={() => setProfileId(p.merchant_id)} />
                ))}
              </div>
            )
          }
        </Async>
      </section>

      <ProviderProfile merchantId={profileId} onClose={() => setProfileId(null)} />
      <BookForm
        provider={booking}
        onClose={() => setBooking(null)}
        onBooked={(id) => {
          setBooking(null);
          // The new booking opens in SimeTown Home, where all bookings live.
          router.push(`/app/home-services?booking=${id}`);
        }}
      />
    </div>
  );
}

/** One company: photo header with its badges, then rating, about, price, the latest reviews and the actions. */
function CompanyCard({ provider: p, image, index, onBook, onProfile }: { provider: Provider; image: string; index: number; onBook: () => void; onProfile: () => void }) {
  return (
    <article style={{ '--i': index } as CSSProperties} className="company-card glass-surface group flex flex-col overflow-hidden rounded-2xl border shadow-sm">
      <div className="relative h-44 overflow-hidden">
        <Image src={image} alt="" fill sizes="(min-width: 1024px) 50vw, 100vw" className="company-card-img object-cover" style={{ objectPosition: index % 2 ? '50% 70%' : '50% 35%' }} />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-brand-950/70 via-brand-950/10 to-transparent" />
        <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-success-700 shadow-sm">
          <ShieldCheck className="size-3.5" aria-hidden /><Text>Approved by the township office</Text>
        </span>
        {p.completed_jobs > 0 && (
          <span className="absolute bottom-3 left-4 text-[11px] font-bold uppercase tracking-[0.14em] text-white">
            <Text>{p.completed_jobs === 1 ? '1 job done in SimeTown' : `${p.completed_jobs} jobs done in SimeTown`}</Text>
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-xl font-semibold tracking-tight text-ink-900">{p.name}</h3>
        <div className="mt-1"><Rating rating={p.rating} reviews={p.reviews} /></div>
        <p className="mt-3 text-[15px] text-ink-700">{p.description}</p>
        <div className="mt-3 rounded-lg bg-brand-50/70 px-3.5 py-2.5"><PriceLine pricing={p.pricing} calloutFeeSen={p.callout_fee_sen} priceNote={p.price_note} /></div>
        <LatestReviews merchantId={p.merchant_id} total={p.reviews} onAll={onProfile} />
        <div className="mt-auto flex flex-wrap gap-2 pt-5">
          <Button onClick={onBook}><Text>Book</Text></Button>
          <Button variant="secondary" onClick={onProfile}><Text>Profile and reviews</Text></Button>
        </div>
      </div>
    </article>
  );
}

/** What residents said: the two latest reviews from completed bookings, and a way to read them all. */
function LatestReviews({ merchantId, total, onAll }: { merchantId: string; total: number; onAll: () => void }) {
  const profile = useApi<Profile>(`/home-services/providers/${merchantId}`);
  const reviews = profile.data?.reviews.slice(0, 2);
  return (
    <div className="mt-4 border-t border-ink-100/80 pt-4">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
        <MessageSquareQuote className="size-3.5" aria-hidden /><Text>What residents said</Text>
      </p>
      {!profile.data ? (
        <div className="mt-2 space-y-2"><Skeleton className="h-14 w-full rounded-lg" /><Skeleton className="h-14 w-full rounded-lg" /></div>
      ) : !reviews || reviews.length === 0 ? (
        <p className="mt-2 text-sm text-ink-500"><Text>No reviews yet.</Text></p>
      ) : (
        <ul className="mt-2 space-y-2">
          {reviews.map((r, i) => (
            <li key={i} style={{ '--i': i } as CSSProperties} className="value-line rounded-lg bg-ink-25 px-3.5 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Stars rating={r.rating} />
                <span className="text-xs text-ink-500">{r.reviewer} · <Text>{formatDate(r.created_at)}</Text></span>
              </div>
              {r.comment && <p className="mt-1 line-clamp-2 text-sm text-ink-700">“{r.comment}”</p>}
            </li>
          ))}
        </ul>
      )}
      {total > 2 && (
        <button type="button" onClick={onAll} className="mt-2 text-sm font-semibold text-brand-700 hover:text-brand-800 hover:underline focus-visible:outline-2 focus-visible:outline-brand-600">
          <Text>{`See all ${total} reviews`}</Text>
        </button>
      )}
    </div>
  );
}
