/** Format USD for observability: preserve sub-cent precision when needed. */
export function formatCost(value: unknown): string {
  const v = Number(value);
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '$0';
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs < 0.01) {
    let s = abs.toFixed(8);
    s = s.replace(/0+$/, '');
    if (s.endsWith('.')) s = s.slice(0, -1);
    return `${sign}$${s}`;
  }
  return (
    sign +
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(abs)
  );
}
