
import { Text } from '@/components/ui/localized-text';
import { FlaskConical } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/card';

/**
 * Shown on anything simulated or not yet built, so a screenshot can never be
 * mistaken for the finished product (proposal section 16, "Shown honestly").
 */
export function PreviewBadge({ children = 'Prototype preview' }: { children?: ReactNode }) {
  return (
    <Badge tone="neutral" className="border border-dashed border-ink-300 bg-white">
      <FlaskConical className="size-3.5" aria-hidden />
      <Text>{children}</Text>
    </Badge>
  );
}

export function SimulatedNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-dashed border-ink-300 bg-ink-25 px-3.5 py-2.5 text-sm text-ink-600">
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-ink-500" aria-hidden />
      <span><Text>{children}</Text></span>
    </p>
  );
}
