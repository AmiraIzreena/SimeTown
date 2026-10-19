'use client';

import type { ReactNode } from 'react';
import { useMinLoading } from '@/lib/use-min-loading';

/**
 * Shows `skeleton` while `loading`, and `children` once it settles. The
 * skeleton waits a moment before it appears and, once it has, stays for the
 * minimum in useMinLoading, so content never flickers between the two.
 */
export function SkeletonGate({ loading, skeleton, children }: { loading: boolean; skeleton: ReactNode; children: ReactNode }) {
  const showSkeleton = useMinLoading('', loading);
  return <>{showSkeleton ? skeleton : children}</>;
}
