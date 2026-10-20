import { notFound } from 'next/navigation';
import { categoryFromSlug } from '@/components/features/home-service-categories';
import { ServiceCategoryScreen } from './screen';

/** One home service category: every company serving the township, with reviews. Unknown categories are a 404. */
export default async function Page({ params }: { params: Promise<{ category: string }> }) {
  const { category: slug } = await params;
  const category = categoryFromSlug(slug);
  if (!category) notFound();
  return <ServiceCategoryScreen category={category} />;
}
