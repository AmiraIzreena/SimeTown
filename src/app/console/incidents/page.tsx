import { redirect } from 'next/navigation';

export default async function LegacyPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry));
    else if (value !== undefined) params.set(key, value);
  }
  // Every case is worked in Lapor: parcel, locker and courier cases on their own tab.
  const area = typeof search.area === 'string' ? search.area : '';
  params.set('tab', /PARCELS|LOCKERS|COURIERS/.test(area) || !area ? 'parcels' : 'cases');
  params.delete('area');
  params.delete('view');
  redirect(`/console/reports?${params.toString()}`);
}
