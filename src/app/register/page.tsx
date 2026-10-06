import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthFrame, RegisterForm } from '@/components/features/auth';

export const metadata: Metadata = { title: 'Create a resident account' };

export default function RegisterPage() {
  return (
    <AuthFrame
      title="Create your KITA ID"
      intro="One verified account per resident, linked to your home."
      footer={
        <p>
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-brand-700 hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <RegisterForm />
    </AuthFrame>
  );
}
