import React from 'react';

interface DataGridProps {
  data: any[];
  onRowClick?: (row: any) => void;
  /** Optional trailing column (e.g. edit/delete). */
  rowActions?: (row: any, idx: number) => React.ReactNode;
}

export const DataGrid: React.FC<DataGridProps> = ({ data, onRowClick, rowActions }) => {
  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-muted text-[11px] font-mono">
        No rows found or empty table.
      </div>
    );
  }

  const columns = Object.keys(data[0]);

  return (
    <div className="w-full overflow-auto border border-[var(--border-subtle)] rounded-lg">
      <table className="w-full text-left border-collapse min-w-max">
        <thead>
          <tr className="bg-[var(--bg-app)] border-b border-[var(--border-subtle)]">
            {columns.map((col) => (
              <th key={col} className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-muted border-r border-[var(--border-subtle)] last:border-r-0">
                {col}
              </th>
            ))}
            {rowActions && (
              <th className="px-2 py-2 text-[10px] font-black uppercase tracking-widest text-muted w-20 text-right">
                Actions
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr 
              key={i} 
              onClick={() => onRowClick?.(row)}
              className="border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--bg-hover)] transition-colors cursor-pointer group"
            >
              {columns.map((col) => (
                <td key={col} className="px-3 py-1.5 text-[11px] font-mono text-main border-r border-[var(--border-subtle)] last:border-r-0 truncate max-w-[200px]">
                  {row[col] === null ? (
                    <span className="italic opacity-30">null</span>
                  ) : typeof row[col] === 'object' ? (
                    JSON.stringify(row[col])
                  ) : (
                    String(row[col])
                  )}
                </td>
              ))}
              {rowActions && (
                <td
                  className="px-2 py-1 border-r border-[var(--border-subtle)] last:border-r-0 text-right"
                  onClick={(e) => e.stopPropagation()}
                >
                  {rowActions(row, i)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
