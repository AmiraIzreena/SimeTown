import type { Metadata } from 'next';
import { ParcelDesk } from './desk';

export const metadata: Metadata = { title: 'Parcels' };

export default function GuardParcelsPage() {
  return <ParcelDesk />;
}
