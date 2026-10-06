import { SkeletonList, SkeletonStats } from '@/components/ui/feedback';

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <SkeletonStats />
      <SkeletonList rows={3} />
    </div>
  );
}
