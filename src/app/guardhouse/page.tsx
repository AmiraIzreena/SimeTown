import type { Metadata } from 'next';
import { ParcelDesk } from './desk';

export const metadata: Metadata = { title: 'Parcels' };

/** The guardhouse parcel counter: parcels kept on the shelf and smart locker parcels too big for a door. */
export default function GuardhousePage() {
  return <ParcelDesk />;
}
