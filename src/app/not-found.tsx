
import { Text } from '@/components/ui/localized-text';
import { Compass } from 'lucide-react';
import { Logo } from '@/components/shell/logo';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-white px-6">
      <div className="max-w-md text-center">
        <Logo className="justify-center" />
        <span className="mx-auto mt-10 grid size-14 place-items-center rounded-full bg-brand-50 text-brand-700">
          <Compass className="size-7" aria-hidden />
        </span>
        <h1 className="mt-6 text-2xl font-bold"><Text>We could not find that page</Text></h1>
        <p className="mt-2 text-ink-500"><Text>The link may be old, or the page may have moved.</Text></p>
        <Button href="/" className="mt-8"><Text>Back to KITA+</Text></Button>
      </div>
    </main>
  );
}
