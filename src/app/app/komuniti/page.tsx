import type { Metadata } from 'next';
import { KomunitiBoard, type KomunitiTab } from '@/components/features/posts-board';

export const metadata: Metadata = { title: 'Komuniti' };

const TABS: KomunitiTab[] = ['all', 'activities', 'help', 'share'];

export default async function KomunitiPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { tab } = await searchParams;
  return <KomunitiBoard initialTab={TABS.find((t) => t === tab) ?? 'all'} />;
}
