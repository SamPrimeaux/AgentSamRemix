/**
 * Claude-style D1 result table — column headers + grid cells, no JSON fence.
 */
import React, { useMemo } from 'react';
import { TOOL_TRACE_RESULT_META_KEYS } from '../../../lib/toolTracePreview';

function formatCell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export type ToolTraceSqlTableProps = {
  rows: Record<string, unknown>[];
  maxRows?: number;
};

export const ToolTraceSqlTable: React.FC<ToolTraceSqlTableProps> = ({ rows, maxRows = 25 }) => {
  const display = useMemo(() => rows.slice(0, maxRows), [rows, maxRows]);
  const columns = useMemo(() => {
    const keys = new Set<string>();
    for (const row of display) {
      for (const key of Object.keys(row)) keys.add(key);
    }
    return Array.from(keys).filter((k) => !TOOL_TRACE_RESULT_META_KEYS.has(k));
  }, [display]);

  if (!display.length || !columns.length) {
    return <span className="tool-trace-meta">No rows returned.</span>;
  }

  return (
    <div className="tool-trace-sql-result">
      <div className="tool-trace-sql-result__meta">
        {display.length} row{display.length === 1 ? '' : 's'}
      </div>
      <div className="tool-trace-sql-result__scroll">
        <table className="tool-trace-sql-result__table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col}>{col.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {display.map((row, idx) => (
              <tr key={idx}>
                {columns.map((col) => (
                  <td key={col}>{formatCell(row[col])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
