import type { Metadata } from 'next';
import { PostsBoard } from '@/components/features/posts-board';

export const metadata: Metadata = { title: 'Jiran' };

export default function JiranPage() {
  return (
    <PostsBoard
      title="Jiran"
      description="Meet your neighbours and help each other. You earn Impact XP when an event organiser or the person you helped confirms it."
      kinds={[
        { type: 'EVENT', tab: 'Events', create: 'New event', respond: 'I’m coming', responded: 'You’re going', confirm: 'Confirm attended', empty: 'No events yet. Start one: a clean-up, a game, a street potluck.', xpNote: 'Guests earn Impact XP when you confirm they attended.' },
        { type: 'HELP', tab: 'Help board', create: 'Ask for help', respond: 'I can help', responded: 'You offered to help', confirm: 'Confirm they helped', empty: 'Nobody needs a hand right now. Need one yourself?', xpNote: 'Your helper earns Impact XP when you confirm the favour was done.' },
      ]}
    />
  );
}
