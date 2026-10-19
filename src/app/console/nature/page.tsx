import { redirect } from 'next/navigation';

/** Access places moved to /console/access. Old links still land there. */
export default function LegacyAccessPlacesPage() {
  redirect('/console/access');
}
