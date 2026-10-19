import { redirect } from 'next/navigation';

/** Kongsi now lives inside Komuniti; old links and bookmarks land on Give & Lend. */
export default function KongsiPage() {
  redirect('/app/komuniti?tab=share');
}
