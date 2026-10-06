import type { Metadata } from 'next';
import { PostsBoard } from '@/components/features/posts-board';

export const metadata: Metadata = { title: 'Kongsi' };

export default function KongsiPage() {
  return (
    <PostsBoard
      title="Kongsi"
      description="Keep useful things in use. Give them away or lend them to a neighbour, and earn Impact XP when the handover is confirmed."
      kinds={[
        { type: 'GIVE', tab: 'Give away', create: 'Give an item', respond: 'I’d like this', responded: 'You asked for this', confirm: 'Confirm handed over', empty: 'Nothing to give away right now. Clearing out a cupboard?', xpNote: 'You earn Impact XP when you confirm the item was collected.' },
        { type: 'LEND', tab: 'Lend', create: 'Lend an item', respond: 'I’d like to borrow this', responded: 'You asked to borrow this', confirm: 'Confirm lent', empty: 'Nothing to borrow right now. Have a ladder or a drill to lend?', xpNote: 'You earn Impact XP each time you confirm a loan.' },
      ]}
    />
  );
}
