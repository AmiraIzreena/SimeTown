'use client';

import { DoorOpen, PackageCheck, ShieldCheck, Truck, Warehouse, Wrench, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/card';
import { Text } from '@/components/ui/localized-text';
import { formatDateTime } from '@/lib/format';
import { ROLE_LABELS, type Role } from '@/shared/domain';

/**
 * Door commands in plain words, the same on every screen that lists them: the command log, a parcel's record,
 * Lapor cases and the simulator.
 */
export interface DoorCommand {
  purpose: string;
  status: string;
  error?: string | null;
  created_at: string;
  compartment?: string | null;
  requested_by?: string | null;
  requester_role?: string | null;
  requester_company?: string | null;
}

export const COMMAND_PURPOSE: Record<string, { label: string; icon: LucideIcon }> = {
  DEPOSIT: { label: 'Courier delivery', icon: Truck },
  COLLECT: { label: 'Resident collection', icon: PackageCheck },
  RELOCATE: { label: 'Moved to the guardhouse', icon: Warehouse },
  MAINTENANCE: { label: 'Staff door access', icon: Wrench },
  EXCEPTION: { label: 'Approved exceptional opening', icon: ShieldCheck },
};
export const commandPurpose = (purpose: string) => COMMAND_PURPOSE[purpose] ?? { label: purpose, icon: DoorOpen };

export const COMMAND_STATUS: Record<string, { label: string; tone: 'success' | 'gold' | 'danger' }> = {
  ACKED: { label: 'Opened', tone: 'success' },
  PENDING: { label: 'Waiting', tone: 'gold' },
  SENT: { label: 'Sent to the station', tone: 'gold' },
  FAILED: { label: 'Did not open', tone: 'danger' },
  TIMED_OUT: { label: 'No answer from the station', tone: 'danger' },
};
export const commandStatus = (status: string) => COMMAND_STATUS[status] ?? { label: status, tone: 'gold' as const };
export const commandFailed = (c: DoorCommand) => c.status === 'FAILED' || c.status === 'TIMED_OUT';

/** Who asked for the door, and as what: a courier and their company, a resident, staff, or the keypad. */
export function commandRequester(c: DoorCommand): { name: string; role: string } {
  if (c.requested_by) {
    const role = c.requester_role === 'COURIER'
      ? `Courier${c.requester_company ? ` · ${c.requester_company}` : ''}`
      : c.requester_role === 'RESIDENT' ? 'Resident, in the app' : ROLE_LABELS[c.requester_role as Role] ?? 'SimeTown user';
    return { name: c.requested_by, role };
  }
  return c.purpose === 'COLLECT' ? { name: 'Resident', role: 'Pickup code on the locker keypad' } : { name: 'SimeTown', role: 'Automatic' };
}

/** A short list of door commands: what it was for, the door, who asked, when, and whether it opened. */
export function DoorCommandList({ commands }: { commands: DoorCommand[] }) {
  return (
    <ul className="divide-y divide-ink-100 overflow-hidden rounded-lg border border-ink-100 bg-white">
      {commands.map((c, i) => {
        const P = commandPurpose(c.purpose);
        const S = commandStatus(c.status);
        const who = commandRequester(c);
        return (
          <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-3.5 py-2.5 text-sm">
            <span className="flex min-w-0 items-center gap-1.5 font-medium text-ink-800">
              <P.icon className="size-3.5 shrink-0 text-ink-400" aria-hidden /><Text>{P.label}</Text>
              {c.compartment && <span className="font-mono text-xs font-semibold text-ink-600">· {c.compartment}</span>}
            </span>
            <Badge tone={S.tone} className="self-start"><Text>{S.label}</Text></Badge>
            <span className="col-span-2 text-ink-700">{who.name} <span className="text-xs text-ink-500">· <Text>{who.role}</Text></span></span>
            <span className="col-span-2 text-xs tabular-nums text-ink-500"><Text>{formatDateTime(c.created_at)}</Text></span>
            {c.error && <span className="col-span-2 text-xs text-accent-700"><Text>{c.error}</Text></span>}
          </li>
        );
      })}
    </ul>
  );
}
