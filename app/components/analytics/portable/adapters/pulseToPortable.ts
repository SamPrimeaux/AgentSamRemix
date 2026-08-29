import { formatCost } from '@/lib/formatCost';
import type {
  ActivityChartPoint,
  PortableKpiItem,
  PulsePortableInput,
} from '../types';
import { fmtNumber, fmtPct } from '../format';

function wfValue(pulse: PulsePortableInput): Record<string, unknown> | undefined {
  const raw = pulse.kpis?.workflowRuns?.value;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
}

export function pulseToPortableKpis(pulse: PulsePortableInput): PortableKpiItem[] {
  const wf = wfValue(pulse);
  const wfTotal = Number(wf?.total ?? pulse.summary?.workflow_run_count ?? 0) || 0;
  const tokenKpi = pulse.kpis?.tokenUsage?.value as Record<string, unknown> | undefined;
  const costKpi = pulse.kpis?.aiCost?.value as Record<string, unknown> | undefined;
  const openErr = pulse.kpis?.openErrors?.value as { count?: number } | undefined;
  const evalKpi = pulse.kpis?.evalPassRate?.value as { pass_rate_percent?: number } | undefined;

  return [
    {
      label: 'Workflow runs',
      value: fmtNumber(wfTotal, 0),
      hint: wf
        ? `done ${fmtNumber(wf.completed, 0)} / fail ${fmtNumber(wf.failed, 0)}`
        : undefined,
    },
    {
      label: 'Token usage',
      value: fmtNumber(tokenKpi?.total, 0),
      hint: tokenKpi
        ? `in ${fmtNumber(tokenKpi.input, 0)} / out ${fmtNumber(tokenKpi.output, 0)}`
        : undefined,
    },
    {
      label: 'AI cost',
      value: formatCost(costKpi?.period_usd),
      hint: costKpi?.monthly_30d_usd != null ? `30d ${formatCost(costKpi.monthly_30d_usd)}` : undefined,
    },
    {
      label: 'Open errors',
      value: fmtNumber(openErr?.count ?? pulse.summary?.open_error_count, 0),
    },
    {
      label: 'Eval pass rate',
      value:
        evalKpi?.pass_rate_percent != null ? fmtPct(evalKpi.pass_rate_percent, 1) : pulse.kpis?.evalPassRate?.isLive === false ? 'BLOCKED' : '—',
    },
  ];
}

/** Aggregate workflowRunsOverTime status rows into daily run totals. */
export function pulseToActivityChart(pulse: PulsePortableInput): ActivityChartPoint[] {
  const rows = pulse.workflowRunsOverTime || [];
  const dayMap: Record<string, number> = {};
  for (const r of rows) {
    const day = String(r.day || '');
    if (!day) continue;
    dayMap[day] = (dayMap[day] || 0) + (Number(r.c ?? 0) || 0);
  }
  return Object.keys(dayMap)
    .sort()
    .map((day) => ({ day, runs: dayMap[day] }));
}

export function pulseToLeaderboardRows(
  pulse: PulsePortableInput,
): Array<Record<string, unknown>> {
  return (pulse.modelLeaderboard || []).slice(0, 8);
}
