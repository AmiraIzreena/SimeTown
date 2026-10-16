import type { Metadata } from 'next';
import { ResidentAccountPanel } from '@/components/features/account';

export const metadata: Metadata = { title: 'Account' };

export default function AccountPage() {
  return <ResidentAccountPanel />;
}
