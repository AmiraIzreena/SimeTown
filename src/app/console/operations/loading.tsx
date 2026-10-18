import { PageHeader } from '@/components/ui/card';
import { Skeleton, SkeletonList } from '@/components/ui/feedback';

export default function Loading() {
  return <div className="min-w-0">
    <PageHeader title="Parcels" description="Manage guardhouse parcels, smart lockers and parcel-related cases." />
    <div aria-hidden className="mb-5 flex gap-3 overflow-hidden border-b border-ink-200 px-3.5 py-2">
      <Skeleton className="h-8 w-20" /><Skeleton className="h-8 w-36" /><Skeleton className="h-8 w-28" />
    </div>
    <SkeletonList rows={4} />
  </div>;
}
