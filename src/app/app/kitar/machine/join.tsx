'use client';

import { Text } from '@/components/ui/localized-text';

import { Recycle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LiveMachineSession } from '@/components/features/machine-session';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { api, ApiError } from '@/lib/api';

/** Scanning the machine's screen lands here: the session starts at once, then follows live. */
export function JoinMachine({ machineId, code }: { machineId: string | null; code: string | null }) {
  const [state, setState] = useState<{ status: 'joining' | 'joined' | 'failed'; message?: string; machine?: string }>({ status: machineId && code ? 'joining' : 'failed', message: 'This link is not complete. Scan the machine’s screen again.' });
  const started = useRef(false);

  useEffect(() => {
    if (!machineId || !code || started.current) return;
    started.current = true;
    api
      .post<{ machine: string }>('/kitar/machine/join', { machineId, code })
      .then((r) => setState({ status: 'joined', machine: r.machine }))
      .catch((error: unknown) => setState({ status: 'failed', message: error instanceof ApiError ? error.message : 'Please scan the machine again.' }));
  }, [machineId, code]);

  return (
    <>
      <PageHeader title="Kitar · smart machine" description="The machine recognises, counts and weighs each item. Nothing to type." />
      {state.status === 'failed' ? (
        <EmptyState icon={Recycle} title="Could not start at the machine" action={<Button href="/app/kitar"><Text>Back to Kitar</Text></Button>}>
          <Text>{state.message}</Text>
        </EmptyState>
      ) : state.status === 'joining' ? (
        <Card className="p-8 text-center text-[15px] text-ink-600"><Text>Connecting to the machine…</Text></Card>
      ) : (
        <div className="space-y-4">
          <Card className="border-success-600/30 bg-success-50 p-5 text-[15px] text-success-700">
            <strong><Text>You are connected to </Text><Text>{state.machine}</Text>.</strong><Text> Drop your items in one by one; they appear below as the machine checks them.</Text></Card>
          <LiveMachineSession />
        </div>
      )}
    </>
  );
}
