
import { Text } from '@/components/ui/localized-text';
import { LocalizedTd } from '@/components/ui/localized-elements';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Card } from './card';

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'right';
  /** Secondary detail: on phones, where each row becomes a small card, it shows as a quieter line instead of being left out. */
  desktopOnly?: boolean;
}

/** A real table on larger screens; a list of labelled cards on phones (see .rtable in globals.css). */
export function DataTable<T>({ columns, rows, keyOf, caption }: { columns: Column<T>[]; rows: T[]; keyOf: (row: T) => string | number; caption: string }) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="rtable w-full text-left text-sm">
          <caption className="sr-only"><Text>{caption}</Text></caption>
          <thead>
            <tr className="border-b border-ink-100/80 bg-ink-25/70 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              {columns.map((column) => (
                <th key={column.header} scope="col" className={cn('px-5 py-2.5', column.align === 'right' && 'text-right')}>
                  <Text>{column.header}</Text>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={keyOf(row)} style={{ '--i': Math.min(index, 12) } as CSSProperties} className="data-row border-b border-ink-100/80 transition-colors duration-200 last:border-0 hover:bg-[rgb(255_247_240/0.7)]">
                {columns.map((column) => (
                  <LocalizedTd key={column.header} data-label={column.header} className={cn('px-5 py-3.5 align-middle text-ink-800', column.align === 'right' && 'text-right tabular-nums', column.desktopOnly && 'max-md:text-[13px] max-md:text-ink-500')}>
                    <Text>{column.cell(row)}</Text>
                  </LocalizedTd>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
