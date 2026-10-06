'use client';

import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Catches anything a screen failed to handle. Details stay in the server logs, not on the screen. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid min-h-[70dvh] place-items-center px-6">
      <div role="alert" className="max-w-md text-center">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="mt-2 text-ink-500">Nothing was lost. Please try again; if it keeps happening, tell the township office.</p>
        {error.digest && <p className="mt-2 text-xs text-ink-500">Reference: {error.digest}</p>}
        <Button className="mt-8" onClick={reset}>
          <RotateCcw className="size-4" aria-hidden />
          Try again
        </Button>
      </div>
    </main>
  );
}
