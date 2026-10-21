'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { SkeletonList } from '@/components/ui/feedback';

/**
 * My reports now lives in Lapor → Parcel & gate reports. Old links (notifications, bookmarks) land there with
 * their filters and their #INC-… reference. This runs in the browser because the server never sees the #part.
 */
export default function MyReportsRedirect() {
  const router = useRouter();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Gate reports have their own tab; everything else is a parcel report. Lapor moves a linked report to its tab.
    params.set('tab', params.get('type') === 'gate' ? 'gate' : 'cases');
    router.replace(`/app/lapor?${params.toString()}${window.location.hash}`);
  }, [router]);
  return <SkeletonList rows={3} />;
}
