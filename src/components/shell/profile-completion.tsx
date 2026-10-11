'use client';

import { Text } from '@/components/ui/localized-text';

import { UserRoundCheck } from 'lucide-react';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/field';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import type { Me, MissingDetail } from '@/lib/types';

const DETAILS: Record<Exclude<MissingDetail, 'terms'>, { label: string; why: string }> = {
  phone: { label: 'Your phone number', why: 'So the township office can reach you, and for urgent safety alerts.' },
  address: { label: 'Your home address', why: 'Choose your home so it can be confirmed against the property record.' },
  shopAddress: { label: 'Your shop’s address', why: 'Shown to residents in the shop directory, and needed for approval.' },
};
const PROMPTED = 'kita.profile.prompted';

function alreadyPrompted(): boolean {
  try {
    return typeof window !== 'undefined' && window.sessionStorage.getItem(PROMPTED) === '1';
  } catch {
    return false; // storage blocked: prompting again is harmless
  }
}

/**
 * Asks signed-in people for required details they have not given yet: a phone
 * number, their home or shop address, and acceptance of the current Terms and
 * Privacy Notice. A banner stays until everything is complete; a dialog also
 * opens once per browser session, but not on the account page itself.
 */
export function ProfileCompletion({ accountHref }: { accountHref: string }) {
  const me = useApi<Me>('/me');
  const pathname = usePathname();
  const router = useRouter();
  const [dismissed, setDismissed] = useState(alreadyPrompted);
  const [agreed, setAgreed] = useState(false);
  const accept = useAction(() => api.post('/me/terms', { version: me.data!.terms.current }), {
    success: 'Thank you. Your acceptance has been recorded.',
    onSuccess: () => void me.mutate(),
  });

  const missing = me.data?.missing ?? [];
  if (missing.length === 0) return null;
  const details = missing.filter((m): m is Exclude<MissingDetail, 'terms'> => m !== 'terms');
  const needsTerms = missing.includes('terms');
  const onAccountPage = pathname === accountHref;

  const close = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(PROMPTED, '1');
    } catch {
      // storage blocked: the dialog may open again next time, which is harmless
    }
  };

  return (
    <>
      <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning-600/30 bg-warning-50 px-4 py-3 text-[15px] text-warning-700">
        <p className="flex items-center gap-2">
          <UserRoundCheck className="size-5 shrink-0" aria-hidden />
          <span>
            <strong className="font-semibold"><Text>Please complete your account.</Text></strong><Text>{' '}</Text>
            <Text>{[...details.map((d) => DETAILS[d].label.toLowerCase()), ...(needsTerms ? ['the updated Terms'] : [])].join(', ').replace(/^./, (c) => c.toUpperCase())}</Text><Text>{' '}</Text>
            <Text>{details.length + (needsTerms ? 1 : 0) > 1 ? 'are' : 'is'}</Text><Text> still needed.</Text></span>
        </p>
        <Button size="sm" variant="secondary" onClick={() => setDismissed(false)} className={onAccountPage && !needsTerms ? 'hidden' : undefined}><Text>Complete now</Text></Button>
      </div>

      <Modal
        open={!dismissed && !(onAccountPage && !needsTerms)}
        onClose={close}
        title="Please complete your account"
        description="KITA+ needs these details before you can use every feature."
        footer={
          <>
            <Button variant="secondary" onClick={close}><Text>Later</Text></Button>
            {details.length > 0 && !onAccountPage && (
              <Button
                onClick={() => {
                  close();
                  router.push(accountHref);
                }}
              ><Text>Go to my account</Text></Button>
            )}
          </>
        }
      >
        <div className="space-y-5 text-[15px] text-ink-700">
          {details.length > 0 && (
            <ul className="space-y-3">
              {details.map((d) => (
                <li key={d}>
                  <p className="font-semibold text-ink-900"><Text>{DETAILS[d].label}</Text></p>
                  <p className="text-sm text-ink-600"><Text>{DETAILS[d].why}</Text></p>
                </li>
              ))}
            </ul>
          )}
          {needsTerms && (
            <div className="space-y-3 rounded-md border border-ink-200 p-4">
              <p className="font-semibold text-ink-900"><Text>Terms of Use and Privacy Notice</Text></p>
              <p className="text-sm text-ink-600">
                <Text>{me.data?.terms.version ? 'They have been updated since you last accepted them.' : 'You have not accepted them yet.'}</Text><Text> Please read them before you continue.</Text></p>
              <Checkbox
                checked={agreed}
                onChange={(event) => setAgreed(event.target.checked)}
                label={
                  <><Text>I have read and accept the</Text><Text>{' '}</Text>
                    <Link href="/terms" target="_blank" rel="noopener" className="font-semibold text-brand-700 underline underline-offset-2"><Text>Terms of Use</Text></Link><Text>{' '}</Text><Text>and the</Text><Text>{' '}</Text>
                    <Link href="/privacy" target="_blank" rel="noopener" className="font-semibold text-brand-700 underline underline-offset-2"><Text>Privacy Notice</Text></Link>
                    .
                  </>
                }
              />
              <Button size="sm" disabled={!agreed} pending={accept.pending} onClick={() => void accept.run()}><Text>Accept</Text></Button>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
