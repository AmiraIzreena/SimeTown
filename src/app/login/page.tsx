
import { Text } from '@/components/ui/localized-text';
import type { Metadata } from 'next';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { redirect } from 'next/navigation';
import { AuthFrame, LoginForm } from '@/components/features/auth';
import { CourierSignIn } from '@/components/features/courier-sso';
import { currentActor } from '@/server/auth/guard';
import { ROLE_HOME } from '@/shared/domain';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; sso?: string; message?: string }> }) {
  const actor = await currentActor();
  if (actor) redirect(ROLE_HOME[actor.role]);
  const { next, sso, message } = await searchParams;
  const ssoError = sso === 'failed' ? (message?.slice(0, 200) || 'The sign-in could not be completed.') : sso === 'cancelled' ? 'The sign-in was cancelled.' : null;
  return (
    <AuthFrame
      title="Welcome back"
      intro="One sign-in for residents, shops, sponsors and township staff."
      footer={
        <>
          <p><Text>New resident?</Text><Text>{' '}</Text>
            <Link href="/register" className="font-semibold text-brand-700 hover:underline"><Text>Create an account</Text></Link>
          </p>
          <p><Text>Run a township shop?</Text><Text>{' '}</Text>
            <Link href="/join" className="font-semibold text-brand-700 hover:underline"><Text>Apply to join</Text></Link>
          </p>
        </>
      }
    >
      <LoginForm next={next} />
      <CourierSignIn next={next} error={ssoError} />
    </AuthFrame>
  );
}
