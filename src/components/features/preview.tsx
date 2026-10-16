import { Text } from '@/components/ui/localized-text';
import { FlaskConical } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/card';
import { DEMO_MODE } from '@/lib/demo';

/** Marks a feature that is not yet open to residents. */
export function PreviewBadge({ children = 'Coming soon' }: { children?: ReactNode }) {
  return (
    <Badge tone="neutral" className="border border-dashed border-ink-300 bg-white">
      <FlaskConical className="size-3.5" aria-hidden />
      <Text>{children}</Text>
    </Badge>
  );
}

/** A note about a simulated part (test sensors, the machine's test controls). Shown only in the demo environment. */
export function SimulatedNote({ children }: { children: ReactNode }) {
  if (!DEMO_MODE) return null;
  return (
    <p className="flex items-start gap-2 rounded-md border border-dashed border-ink-300 bg-ink-25 px-3.5 py-2.5 text-sm text-ink-600">
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-ink-500" aria-hidden />
      <span><Text>{children}</Text></span>
    </p>
  );
}
