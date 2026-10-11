import type { Metadata } from 'next';
import { GuestView } from './view';

export const metadata: Metadata = { title: 'Visiting the township', description: 'For visitors and residents who have not joined yet: flood status, recycling as a guest and visitor passes.' };

export default function GuestPage() {
  return <GuestView />;
}
