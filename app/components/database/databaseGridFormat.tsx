import React from 'react';

/** Compact cell display for grid — full value opens in detail drawer. */
export function formatGridCellDisplay(value: unknown, columnName = ''): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="database-null-chip">NULL</span>;
  }
  if (typeof value === 'number') {
    const isLikelyEpoch = /(_at|time|date|timestamp)$/i.test(columnName) && value > 946684800 && value < 4102444800;
    if (isLikelyEpoch) {
      const d = new Date(value * 1000);
      return (
        <span className="tabular-nums" title={String(value)}>
          {d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </span>
      );
    }
    return <span className="font-mono tabular-nums">{value}</span>;
  }
  if (typeof value === 'boolean') {
    return (
      <span
        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
          value ? 'bg-[var(--database-success-text)]/15 text-[var(--database-success-text)]' : 'bg-[var(--database-row-hover-bg)] text-[var(--database-text-muted)]'
        }`}
      >
        {value ? 'true' : 'false'}
      </span>
    );
  }
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const trimmed = text.trim();
  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length > 1) {
    try {
      JSON.parse(trimmed);
      return <span className="text-[var(--database-accent)]">JSON</span>;
    } catch {
      /* fall through */
    }
  }
  const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text;
  return <span title={text.length > 80 ? text : undefined}>{preview}</span>;
}

export function cellValueAsCopyText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
