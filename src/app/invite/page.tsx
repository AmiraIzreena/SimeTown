import type { Metadata } from 'next';
import { AuthFrame, InviteFromLink } from '@/components/features/auth';

export const metadata: Metadata = { title: 'Set your password', referrer: 'no-referrer' };

/** Set-password links look like /invite#token: the token never reaches the server in the address. */
export default function InvitePage() {
  return (
    <AuthFrame title="Set your password" intro="This link works once and expires after 7 days.">
      <InviteFromLink />
    </AuthFrame>
  );
}
