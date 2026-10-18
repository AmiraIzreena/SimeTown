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
  params.set('tab', search.area === 'PARCELS' ? 'guardhouse' : 'lockers');
  params.set('view', 'cases');
  params.delete('area');
  redirect(`/console/operations?${params.toString()}`);
}
