/** Shared formatters — contract with agentsam-cms-editor analytics-app/src/lib/format.ts */

export function fmtNumber(n: unknown, digits = 2): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function fmtUsd(n: unknown, digits = 4): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: digits })}`;
}

export function fmtPct(n: unknown, digits = 2): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}%`;
}
