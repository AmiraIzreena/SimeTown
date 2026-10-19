import { redirect } from 'next/navigation';

/** Jiran now lives inside Komuniti; old links and bookmarks land on its activities. */
export default function JiranPage() {
  redirect('/app/komuniti?tab=activities');
}
