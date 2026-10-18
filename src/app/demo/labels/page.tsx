'use client';

import { Text } from '@/components/ui/localized-text';

import { AlertTriangle, Printer } from 'lucide-react';
import { Logo } from '@/components/shell/logo';
import { Barcode } from '@/components/ui/barcode';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import { Async, SkeletonList } from '@/components/ui/feedback';
import { QrCode } from '@/components/ui/qr';
import { useApi } from '@/lib/hooks';

interface Label {
  tracking_no: string;
  status: string;
  locker_eligible: boolean;
  recipient_name: string;
  address_line: string;
  postcode: string | null;
  weight_g: number | null;
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  demo_case: string;
  company: string;
  company_code: string;
  carried_by: string | null;
  deposited: boolean | null;
}

/**
 * Fictional shipping labels for the simulated courier companies, to scan with
 * a phone camera or a USB scanner at the courier's Deliver screen. The barcode
 * holds only the tracking number; SimeTown asks the (simulated) company who it
 * is for, and never reads the recipient from the label.
 */
export default function DemoLabelsPage() {
  const labels = useApi<Label[]>('/demo/labels');
  return (
    <main className="min-h-dvh bg-ink-25 px-4 py-8 print:bg-white print:p-0">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
          <Logo />
          <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" aria-hidden /><Text>Print labels</Text></Button>
        </div>
        <div className="flex gap-3 rounded-xl border border-warning-600/30 bg-warning-50 p-4 text-[15px] text-ink-800" role="note">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning-700" aria-hidden />
          <div>
            <p className="font-semibold"><Text>Demo labels for simulated courier companies</Text></p>
            <p><Text>These shipments, tracking numbers and labels are fictional. They were not issued by J&T Express, Ninja Van, Shopee Express or any other courier company, and SimeTown is not connected to their systems. Each label shows what it is meant to demonstrate.</Text></p>
          </div>
        </div>
        <Async state={labels} skeleton={<SkeletonList rows={4} />}>
          {(rows) => (
            <ul className="grid gap-5 md:grid-cols-2 print:grid-cols-2 print:gap-3">
              {rows.map((l) => (
                <li key={`${l.company_code}-${l.tracking_no}`} className="break-inside-avoid rounded-xl border-2 border-dashed border-ink-300 bg-white p-5 print:rounded-none print:border-solid">
                  <div className="flex items-start justify-between gap-3 border-b border-ink-200 pb-3">
                    <div>
                      <p className="font-display text-lg font-bold text-ink-900">{l.company}</p>
                      <p className="text-xs font-semibold uppercase tracking-wide text-accent-700"><Text>Simulated company · not a real shipment</Text></p>
                    </div>
                    {l.deposited && <Badge tone="neutral"><Text>Already delivered</Text></Badge>}
                  </div>
                  <div className="flex items-center gap-4 py-4">
                    <div className="min-w-0 flex-1 space-y-1">
                      <Barcode value={l.tracking_no} label={`Barcode for tracking number ${l.tracking_no}`} />
                      <p className="text-center font-mono text-sm tracking-wider text-ink-900">{l.tracking_no}</p>
                    </div>
                    <QrCode value={l.tracking_no} size={84} label={`QR code for tracking number ${l.tracking_no}`} />
                  </div>
                  <div className="grid gap-3 border-t border-ink-200 pt-3 text-sm sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Deliver to</Text></p>
                      <p className="font-semibold text-ink-900">{l.recipient_name}</p>
                      <p className="text-ink-700">{l.address_line}</p>
                    </div>
                    <div className="text-ink-700">
                      {l.weight_g != null && <p><Text>{`Weight: ${(l.weight_g / 1000).toFixed(1)} kg`}</Text></p>}
                      {l.length_mm && l.width_mm && l.height_mm && <p><Text>{`Size: ${l.length_mm} × ${l.width_mm} × ${l.height_mm} mm`}</Text></p>}
                      {l.carried_by && <p><Text>{`Carried by: ${l.carried_by}`}</Text></p>}
                    </div>
                  </div>
                  <p className="mt-3 rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-800 print:bg-white print:px-0"><Text>{`Shows: ${l.demo_case}`}</Text></p>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </div>
    </main>
  );
}
