'use client';

import { Text } from '@/components/ui/localized-text';

import { CheckCircle2, Cpu, Loader2, XCircle } from 'lucide-react';
import { Badge, Card, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { formatKg, rewardMessage } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { ActionRewardView } from '@/lib/types';
import { MATERIAL_INFO, type Material } from '@/shared/domain';

export interface MachineSession {
  id: string;
  machine: string;
  status: 'OPEN' | 'DONE' | 'EXPIRED';
  acceptedCount: number;
  rejectedCount: number;
  acceptedG: number;
  reward: (ActionRewardView & { skipped?: string }) | null;
  items: { seq: number; material: Material; weight_g: number; accepted: boolean; reason: string | null }[];
}

/**
 * The resident's own view of a session at the smart machine, item by item, as
 * the machine sends its signed records. Refreshes every two seconds while open.
 */
export function LiveMachineSession({ onDone }: { onDone?: () => void }) {
  const session = useApi<MachineSession | null>('/kitar/machine/session', {
    refreshInterval: (latest) => (latest?.status === 'OPEN' ? 2_000 : 0),
    onSuccess: (latest) => latest?.status === 'DONE' && onDone?.(),
  });
  const s = session.data;
  if (!s) return null;
  return (
    <Card className={cn('animate-rise', s.status === 'OPEN' ? 'border-brand-300' : s.status === 'DONE' ? 'border-success-600/30' : '')}>
      <CardHeader
        title={s.status === 'OPEN' ? `Recycling at ${s.machine}` : s.status === 'DONE' ? `Recorded at ${s.machine}` : 'Session closed'}
        description={s.status === 'OPEN' ? 'Drop items in one by one. The machine checks each with its camera, barcode reader and scale.' : 'Every item came from a record the machine signed.'}
        action={
          <Badge tone={s.status === 'OPEN' ? 'brand' : s.status === 'DONE' ? 'success' : 'neutral'}>
            {s.status === 'OPEN' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Cpu className="size-3.5" aria-hidden />}
            <Text>{s.status === 'OPEN' ? 'Live' : s.status === 'DONE' ? 'Signed and saved' : 'Expired'}</Text>
          </Badge>
        }
      />
      <div className="grid grid-cols-3 gap-3 border-b border-ink-100 p-5 text-center">
        <div>
          <p className="text-xs font-medium text-ink-500"><Text>Accepted</Text></p>
          <p className="font-display text-2xl font-bold tabular-nums text-ink-900"><Text>{s.acceptedCount}</Text></p>
        </div>
        <div>
          <p className="text-xs font-medium text-ink-500"><Text>Not counted</Text></p>
          <p className="font-display text-2xl font-bold tabular-nums text-ink-900"><Text>{s.rejectedCount}</Text></p>
        </div>
        <div>
          <p className="text-xs font-medium text-ink-500"><Text>Weight</Text></p>
          <p className="font-display text-2xl font-bold tabular-nums text-ink-900"><Text>{formatKg(s.acceptedG)}</Text></p>
        </div>
      </div>
      {s.items.length > 0 && (
        <ol className="max-h-64 divide-y divide-ink-100 overflow-y-auto">
          {s.items.map((item) => (
            <li key={item.seq} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                {item.accepted ? <CheckCircle2 className="size-4 shrink-0 text-success-700" aria-hidden /> : <XCircle className="size-4 shrink-0 text-accent-600" aria-hidden />}
                <span className="min-w-0">
                  <span className="font-medium text-ink-900"><Text>{MATERIAL_INFO[item.material].label}</Text></span>
                  {item.reason && <span className="block text-xs text-ink-500">{item.reason}</span>}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-ink-600"><Text>{item.weight_g}</Text><Text> g</Text></span>
            </li>
          ))}
        </ol>
      )}
      {s.status === 'DONE' && (
        <p className="border-t border-ink-100 bg-success-50 px-5 py-3 text-sm font-medium text-success-700">
          <Text>{s.reward?.skipped ? 'Recorded. You have reached today’s recycling limit for rewards.' : rewardMessage(s.reward, 'Recorded. Thank you for recycling.')}</Text>
        </p>
      )}
    </Card>
  );
}
