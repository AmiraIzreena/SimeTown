import { SERVICE_CATEGORIES, type ServiceCategory } from '@/shared/domain';

/**
 * Address, photos and one-line summary for each home service category page. Two different photos:
 * `hero` is the wide setting behind the page title, `card` shows the work on each company card
 * (and on the category tile). Photos and credits: public/images/services/CREDITS.md.
 */
export const SERVICE_CATEGORY_PAGE: Record<ServiceCategory, { slug: string; hero: string; card: string; summary: string }> = {
  PLUMBING: { slug: 'plumbing', hero: '/images/services/plumbing-sink.jpg', card: '/images/services/plumbing-work.jpg', summary: 'Leaks, blocked drains, taps and water heaters.' },
  ELECTRICAL: { slug: 'electrical', hero: '/images/services/electrical-board.jpg', card: '/images/services/electrical.jpg', summary: 'Wiring, sockets, lights and tripping circuits.' },
  AIRCON: { slug: 'aircon', hero: '/images/services/aircon-thermostat.jpg', card: '/images/services/aircon-unit.jpg', summary: 'Servicing, repairs and installation of air-conditioners.' },
  CLEANING: { slug: 'cleaning', hero: '/images/services/cleaning-kitchen.jpg', card: '/images/services/cleaning.jpg', summary: 'Regular and deep cleaning for your home.' },
  REPAIRS: { slug: 'repairs', hero: '/images/services/repairs-tools.jpg', card: '/images/services/repairs.jpg', summary: 'Doors, cabinets, fittings and everyday fixes.' },
  RENOVATION: { slug: 'renovation', hero: '/images/services/renovation.jpg', card: '/images/services/renovation-plaster.jpg', summary: 'Painting, tiling and renovation works.' },
};

export const serviceCategoryHref = (category: ServiceCategory) => `/app/home-services/${SERVICE_CATEGORY_PAGE[category].slug}`;

/** The category a page address names, or null for anything else. */
export const categoryFromSlug = (slug: string): ServiceCategory | null =>
  SERVICE_CATEGORIES.find((c) => SERVICE_CATEGORY_PAGE[c].slug === slug) ?? null;
