import type { Metadata } from 'next';
import { AuthFrame, ResetPasswordFromLink } from '@/components/features/auth';

export const metadata: Metadata = { title: 'Choose a new password', referrer: 'no-referrer' };

/** Reset links look like /reset-password#token: the token never reaches the server in the address. */
export default function ResetPasswordPage() {
  return (
    <AuthFrame title="Choose a new password" intro="This link works once and expires 30 minutes after it was sent. Saving signs you out on every other device.">
      <ResetPasswordFromLink />
    </AuthFrame>
  );
}
