import { Text } from '@/components/ui/localized-text';
import type { Metadata } from 'next';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { AuthFrame, ForgotPasswordForm } from '@/components/features/auth';

export const metadata: Metadata = { title: 'Reset your password' };

export default function ForgotPasswordPage() {
  return (
    <AuthFrame
      title="Reset your password"
      intro="Enter the email you use for SimeTown. We will email you a link to choose a new password."
      footer={
        <p><Text>Remembered it?</Text><Text>{' '}</Text>
          <Link href="/login" className="font-semibold text-brand-700 hover:underline"><Text>Sign in</Text></Link>
        </p>
      }
    >
      <ForgotPasswordForm />
    </AuthFrame>
  );
}
