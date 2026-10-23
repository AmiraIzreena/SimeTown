import { redirect } from 'next/navigation';

/** Parcels moved to the guardhouse counter; old links and bookmarks land there. Guards no longer see it. */
export default function GuardParcelsPage() {
  redirect('/guardhouse');
}
