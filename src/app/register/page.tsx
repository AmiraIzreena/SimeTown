
import { Text } from '@/components/ui/localized-text';
import type { Metadata } from 'next';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { AuthFrame, RegisterForm } from '@/components/features/auth';

export const metadata: Metadata = { title: 'Create a resident account' };

export default function RegisterPage() {
  return (
    <AuthFrame
      title="Create your KITA ID"
      intro="One verified account per resident, linked to your home."
      footer={
        <p><Text>Already have an account?</Text><Text>{' '}</Text>
          <Link href="/login" className="font-semibold text-brand-700 hover:underline"><Text>Sign in</Text></Link>
        </p>
      }
    >
      <RegisterForm />
    </AuthFrame>
  );
}
