
import { Text } from '@/components/ui/localized-text';
import type { Metadata } from 'next';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { redirect } from 'next/navigation';
import { AuthFrame, LoginForm } from '@/components/features/auth';
import { CourierSignIn } from '@/components/features/courier-sso';
import { currentActor } from '@/server/auth/guard';
import { ROLE_HOME } from '@/shared/domain';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; sso?: string; message?: string; reason?: string }> }) {
  const actor = await currentActor();
  if (actor) redirect(ROLE_HOME[actor.role]);
  const { next, sso, message, reason } = await searchParams;
  // Why the person was signed out, if a timeout ended their sign-in (shared/session.ts).
  const ended = reason === 'idle'
    ? 'You were signed out because you were away for a while. This keeps your account safe. Please sign in again.'
    : reason === 'expired'
      ? 'A sign-in lasts up to 12 hours. Please sign in again.'
      : reason === 'ended'
        ? 'Your sign-in has ended. Please sign in again.'
        : null;
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
      {ended && <p role="status" className="mb-5 rounded-lg border border-gold-300 bg-gold-50 px-4 py-3 text-sm text-gold-700"><Text>{ended}</Text></p>}
      <LoginForm next={next} />
      <CourierSignIn next={next} error={ssoError} />
    </AuthFrame>
  );
}
