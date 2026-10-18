import { Text } from '@/components/ui/localized-text';
import type { Metadata } from 'next';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { AuthFrame } from '@/components/features/auth';
import { CourierApplyForm } from './form';

export const metadata: Metadata = { title: 'Courier locker access' };

export default function CourierApplyPage() {
  return (
    <AuthFrame
      title="Locker access for couriers"
      intro="Deliver to SimeTown parcel lockers without calling residents. The township office checks every account and chooses the stations you may use."
      footer={
        <p><Text>Already have an account?</Text><Text>{' '}</Text>
          <Link href="/login" className="font-semibold text-brand-700 hover:underline"><Text>Sign in</Text></Link>
        </p>
      }
    >
      <CourierApplyForm />
    </AuthFrame>
  );
}
