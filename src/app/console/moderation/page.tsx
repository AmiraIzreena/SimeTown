import { redirect } from 'next/navigation';

/** Moderation now lives in the Komuniti console page; old links land on its reports. */
export default function ModerationPage() {
  redirect('/console/komuniti');
}
