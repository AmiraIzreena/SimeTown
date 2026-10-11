
import { Text } from '@/components/ui/localized-text';
import { LocalizedTd } from '@/components/ui/localized-elements';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Card } from './card';

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'right';
  /** Leaves the column out on phones, where each row becomes a small card. */
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
            <tr className="border-b border-ink-200 bg-ink-25 text-xs font-semibold uppercase tracking-wide text-ink-500">
              {columns.map((column) => (
                <th key={column.header} scope="col" className={cn('px-4 py-3', column.align === 'right' && 'text-right')}>
                  <Text>{column.header}</Text>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={keyOf(row)} className="border-b border-ink-100 transition-colors duration-200 last:border-0 hover:bg-ink-25">
                {columns.map((column) => (
                  <LocalizedTd key={column.header} data-label={column.header} className={cn('px-4 py-3 align-middle text-ink-800', column.align === 'right' && 'text-right tabular-nums', column.desktopOnly && 'max-md:hidden')}>
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
