import type { Metadata } from 'next';
import { PartnersView } from './view';

export const metadata: Metadata = { title: 'Partners', description: 'The sponsors who support the township, by tier.' };

export default function PartnersPage() {
  return <PartnersView />;
}
