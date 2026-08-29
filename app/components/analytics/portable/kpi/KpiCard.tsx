type Props = {
  label: string;
  value: string;
  hint?: string;
};

/** Portable KPI tile — IAM tokens (see docs/ANALYTICS_PORTABLE_CONTRACT.md) */
export function KpiCard({ label, value, hint }: Props) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 shadow-[0_0_0_1px_rgba(148,163,184,0.04)]">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-[20px] font-semibold tabular-nums text-[var(--text)]">{value}</div>
      {hint ? <div className="text-[10px] text-muted mt-1">{hint}</div> : null}
    </div>
  );
}
