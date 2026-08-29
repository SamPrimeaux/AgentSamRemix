import type { ReactNode } from 'react';

type Col<T> = { key: string; header: string; render: (row: T) => ReactNode };

type Props<T> = {
  columns: Col<T>[];
  rows: T[];
  empty?: string;
};

export function SimpleTable<T extends Record<string, unknown>>({
  columns,
  rows,
  empty = 'No rows',
}: Props<T>) {
  if (!rows.length) {
    return <p className="text-[12px] text-muted">{empty}</p>;
  }
  return (
    <div className="overflow-auto border border-[var(--border-subtle)] rounded max-h-64">
      <table className="w-full text-left text-[11px]">
        <thead className="sticky top-0 bg-[var(--bg-panel)] text-muted uppercase">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className="p-2 font-medium">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-[var(--border-subtle)]">
              {columns.map((c) => (
                <td key={c.key} className="p-2 text-[var(--text)]">
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
