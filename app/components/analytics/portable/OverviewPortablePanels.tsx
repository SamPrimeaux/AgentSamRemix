import React, { useMemo } from 'react';
import { ActivityLineChart } from './charts/ActivityLineChart';
import { KpiCard } from './kpi/KpiCard';
import { KpiGrid } from './kpi/KpiGrid';
import { SimpleTable } from './tables/SimpleTable';
import {
  pulseToActivityChart,
  pulseToLeaderboardRows,
  pulseToPortableKpis,
} from './adapters/pulseToPortable';
import { fmtNumber, fmtUsd } from './format';
import type { PulsePortableInput } from './types';

type Props = {
  pulse: PulsePortableInput;
  /** When false, section is omitted (keeps OverviewTab lean when API failed). */
  show?: boolean;
};

/**
 * Additive panels using the cms-editor portable contract.
 * Does not replace AnalyticsShell KPI grid — mirrors sandbox layout for parity testing.
 */
export function OverviewPortablePanels({ pulse, show = true }: Props) {
  const kpis = useMemo(() => pulseToPortableKpis(pulse), [pulse]);
  const chartData = useMemo(() => pulseToActivityChart(pulse), [pulse]);
  const leaderboard = useMemo(() => pulseToLeaderboardRows(pulse), [pulse]);

  if (!show || !pulse.ok) return null;

  return (
    <section
      className="space-y-3 rounded-lg border border-dashed border-[var(--border-subtle)] bg-[var(--bg-canvas)]/40 p-3"
      aria-label="Portable analytics panels"
    >
      <div>
        <div className="text-[12px] font-semibold text-[var(--text)]">Portable contract panels</div>
        <div className="text-[10px] text-muted mt-0.5">
          Shared with agentsam-cms-editor — range {pulse.range || '—'}
        </div>
      </div>

      <KpiGrid>
        {kpis.map((k) => (
          <KpiCard key={k.label} label={k.label} value={k.value} hint={k.hint} />
        ))}
      </KpiGrid>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
          <div className="text-[11px] uppercase text-muted mb-2">Runs (portable chart)</div>
          <ActivityLineChart data={chartData} dataKey="runs" stroke="#38bdf8" />
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
          <div className="text-[11px] uppercase text-muted mb-2">Model leaderboard (portable table)</div>
          <SimpleTable
            columns={[
              { key: 'model', header: 'Model', render: (r) => String(r.model ?? '—') },
              { key: 'runs', header: 'Runs', render: (r) => fmtNumber(r.runs, 0) },
              {
                key: 'cost',
                header: 'Cost',
                render: (r) => fmtUsd(r.cost_usd ?? r.total_cost_usd),
              },
              {
                key: 'lat',
                header: 'Avg ms',
                render: (r) => fmtNumber(r.avg_latency_ms, 0),
              },
            ]}
            rows={leaderboard}
            empty="No model leaderboard rows"
          />
        </div>
      </div>
    </section>
  );
}
