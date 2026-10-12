
import { Text } from '@/components/ui/localized-text';
import type { Metadata } from 'next';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { AuthFrame, MerchantApplyForm } from '@/components/features/auth';

export const metadata: Metadata = { title: 'Join as a shop' };

export default function JoinPage() {
  return (
    <AuthFrame
      title="Bring your shop into SimeTown"
      intro="Free to list and to accept points. You are paid 100% of every point you accept, every week."
      footer={
        <p><Text>Already applied?</Text><Text>{' '}</Text>
          <Link href="/login" className="font-semibold text-brand-700 hover:underline"><Text>Sign in</Text></Link>
        </p>
      }
    >
      <MerchantApplyForm />
    </AuthFrame>
  );
}
