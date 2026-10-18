import type { Metadata } from 'next';
import { BookingsScreen } from './screen';

export const metadata: Metadata = { title: 'Bookings' };

/** A notification opens this page with a booking id in the address; anything else in that slot is ignored. */
export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ booking?: string }> }) {
  const { booking } = await searchParams;
  const id = typeof booking === 'string' && /^[0-9a-f-]{36}$/i.test(booking) ? booking : null;
  return <BookingsScreen initialBooking={id} />;
}
