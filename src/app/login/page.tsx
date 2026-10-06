import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthFrame, LoginForm } from '@/components/features/auth';
import { currentActor } from '@/server/auth/guard';
import { ROLE_HOME } from '@/shared/domain';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const actor = await currentActor();
  if (actor) redirect(ROLE_HOME[actor.role]);
  const { next } = await searchParams;
  return (
    <AuthFrame
      title="Welcome back"
      intro="One sign-in for residents, shops, sponsors and township staff."
      footer={
        <>
          <p>
            New resident?{' '}
            <Link href="/register" className="font-semibold text-brand-700 hover:underline">
              Create an account
            </Link>
          </p>
          <p>
            Run a township shop?{' '}
            <Link href="/join" className="font-semibold text-brand-700 hover:underline">
              Apply to join
            </Link>
          </p>
        </>
      }
    >
      <LoginForm next={next} />
    </AuthFrame>
  );
}
