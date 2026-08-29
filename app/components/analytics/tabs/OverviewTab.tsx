import React, { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import type { AnalyticsLayoutResponse } from '../types';
import { OverviewPortablePanels } from '../portable/OverviewPortablePanels';
import { formatCost } from '@/lib/formatCost';

type Props = { layout: AnalyticsLayoutResponse | null };

type RangeKey = '7d' | '24h' | '30d';

type SourceStatus = {
  live: string[];
  empty: string[];
  blocked: string[];
  errors: string[];
};

type KpiMetric = {
  value: Record<string, unknown> | number | string | null;
  sourceTables: string[];
  timeWindow: string;
  isLive: boolean;
  warning?: string | null;
  sparkline?: number[] | null;
};

type PulseResponse = {
  ok: boolean;
  backend: string;
  range: string;
  generated_at: number;
  summary: Record<string, unknown>;
  warnings: Array<{ code: string; message: string; severity?: string }>;
  kpis?: Record<string, KpiMetric>;
  workflowRunsOverTime?: Array<{ day?: string; status?: string; c?: number }>;
  latestExecutionWaterfall?: {
    workflow_run_id?: string | null;
    run_group_id?: string | null;
    steps?: Array<{
      node_key?: string;
      status?: string;
      latency_ms?: number;
      bar?: number;
      tokens_in?: number;
      tokens_out?: number;
      cost_usd?: number;
    }>;
    state?: string;
    reason?: string;
  };
  errorInbox?: Array<{
    time?: string;
    source?: string;
    message?: string;
    severity?: string;
    run_group_id?: string | null;
    resolved?: boolean;
  }>;
  modelLeaderboard?: Array<Record<string, unknown>>;
  costLatencyScatter?: Array<Record<string, unknown>>;
  tokensOverTime?: Array<{ day?: string; tin?: number; tout?: number }>;
  codebaseOverview?: Record<string, unknown>;
  ragHealth?: Record<string, unknown>;
  deployments?: Record<string, unknown>;
  sourceStatus?: SourceStatus;
  meta?: { generatedAt?: string; timeRange?: string; workspaceId?: string | null; tenantId?: string | null };
};

function fmtNumber(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1_000_000) return `${Math.round(v / 10_000) / 100}M`;
  if (v >= 10_000) return `${Math.round(v / 100) / 10}K`;
  return String(Math.round(v));
}

function fmtMs(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v < 1000) return `${Math.round(v)} ms`;
  return `${Math.round((v / 1000) * 1000) / 1000}s`;
}

function isStubPayload(w: { warnings?: Array<{ code?: string }> } | null): boolean {
  return !!(w?.warnings || []).some((x) => x?.code === 'ANALYTICS_ENDPOINT_NOT_IMPLEMENTED');
}

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (!data.length) return <div className="h-8 text-[10px] text-muted">No trend</div>;
  const chartData = data.map((v, i) => ({ i, v }));
  return (
    <div className="h-8 w-full mt-1">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function BlockedCallout({
  title,
  endpoint,
  tables,
  nextStep,
}: {
  title: string;
  endpoint?: string;
  tables?: string[];
  nextStep?: string;
}) {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-[12px] text-[var(--text)]">
      <div className="font-semibold text-amber-200/90">{title}</div>
      {endpoint ? (
        <div className="mt-1 font-mono text-[11px] text-muted">{endpoint}</div>
      ) : null}
      {tables?.length ? (
        <div className="mt-1 text-muted">Intended tables: {tables.join(', ')}</div>
      ) : null}
      {nextStep ? <div className="mt-1 text-muted">Next: {nextStep}</div> : null}
    </div>
  );
}

const SCATTER_COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#94a3b8'];

export default function OverviewTab(_props: Props) {
  const [pulse, setPulse] = useState<PulseResponse | null>(null);
  const [health, setHealth] = useState<{ rows?: Array<Record<string, unknown>>; warnings?: unknown[] } | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [range, setRange] = useState<RangeKey>('7d');
  const [loading, setLoading] = useState(true);
  const [overviewHttpError, setOverviewHttpError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setOverviewHttpError(null);
      try {
        const q = new URLSearchParams({ range });
        const [resP, resH] = await Promise.all([
          fetch(`/api/analytics/overview?${q.toString()}`, { credentials: 'include' }),
          fetch('/api/analytics/source-health?range=30d', { credentials: 'include' }),
        ]);
        if (!alive) return;
        if (!resP.ok) {
          setPulse(null);
          setOverviewHttpError(`GET /api/analytics/overview → HTTP ${resP.status}`);
          setHealth(resH.ok ? ((await resH.json()) as { rows?: Array<Record<string, unknown>> }) : null);
          setLoadedAt(Date.now());
          return;
        }
        const p = (await resP.json()) as PulseResponse;
        const h = resH.ok ? ((await resH.json()) as { rows?: Array<Record<string, unknown>> }) : null;
        if (!alive) return;
        setPulse(p);
        setHealth(h);
        setLoadedAt(Date.now());
      } catch (e) {
        if (!alive) return;
        setPulse(null);
        setOverviewHttpError(e instanceof Error ? e.message : String(e));
        setLoadedAt(Date.now());
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [range]);

  const wfChart = useMemo(() => {
    const rows = pulse?.workflowRunsOverTime || [];
    const dayMap: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      const day = String(r.day || '');
      const st = String(r.status || 'unknown');
      const c = Number(r.c ?? 0) || 0;
      if (!dayMap[day]) dayMap[day] = {};
      dayMap[day][st] = (dayMap[day][st] || 0) + c;
    }
    const days = Object.keys(dayMap).sort();
    return days.map((day) => ({
      day,
      completed: dayMap[day].completed || 0,
      failed: dayMap[day].failed || 0,
      running: dayMap[day].running || 0,
      other: Object.entries(dayMap[day])
        .filter(([k]) => !['completed', 'failed', 'running'].includes(k))
        .reduce((s, [, v]) => s + v, 0),
    }));
  }, [pulse?.workflowRunsOverTime]);

  const tokenChart = useMemo(() => {
    return (pulse?.tokensOverTime || []).map((r) => ({
      day: String(r.day || ''),
      in: Number(r.tin ?? 0) || 0,
      out: Number(r.tout ?? 0) || 0,
    }));
  }, [pulse?.tokensOverTime]);

  const scatterData = useMemo(() => {
    return (pulse?.costLatencyScatter || []).map((r) => ({
      model: String(r.model || ''),
      provider: String(r.provider || 'unknown'),
      x: Number(r.latency_ms ?? 0) || 0,
      y: Number(r.cost_usd ?? 0) || 0,
      z: Math.max(8, Number(r.total_tokens ?? 0) || 0),
    }));
  }, [pulse?.costLatencyScatter]);

  const scatterProviders = useMemo(() => [...new Set(scatterData.map((d) => d.provider))], [scatterData]);

  /** Top models by run count — horizontal bar chart. */
  const leaderBarData = useMemo(() => {
    const rows = pulse?.modelLeaderboard || [];
    return rows
      .slice(0, 10)
      .map((r) => ({
        label: String(r.model || 'unknown').replace(/\s+/g, ' ').trim().slice(0, 32),
        runs: Number(r.runs ?? 0) || 0,
        ms: Math.round(Number(r.avg_latency_ms ?? 0) || 0),
      }))
      .filter((r) => r.runs > 0);
  }, [pulse?.modelLeaderboard]);

  const latencyBarData = useMemo(
    () => leaderBarData.filter((r) => r.ms > 0).slice(0, 8),
    [leaderBarData],
  );

  const kpis = pulse?.kpis;
  const wf = kpis?.workflowRuns?.value as Record<string, unknown> | undefined;
  const wfTotal = Number(wf?.total ?? pulse?.summary?.workflow_run_count ?? 0) || 0;

  const tokenKpi = kpis?.tokenUsage?.value as Record<string, unknown> | undefined;
  const costKpi = kpis?.aiCost?.value as Record<string, unknown> | undefined;
  const latencyKpi = kpis?.avgLatency?.value as Record<string, unknown> | undefined;

  const waterfall = pulse?.latestExecutionWaterfall;
  const wfSteps = waterfall?.steps || [];

  const codebase = pulse?.codebaseOverview;
  const rag = pulse?.ragHealth;
  const codebaseStub = codebase && isStubPayload(codebase as { warnings?: Array<{ code?: string }> });
  const ragStub = rag && isStubPayload(rag as { warnings?: Array<{ code?: string }> });

  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-8 text-center text-sm text-muted">
        Loading analytics overview…
      </div>
    );
  }

  if (overviewHttpError != null || pulse == null) {
    return (
      <div className="space-y-3">
        <BlockedCallout
          title={overviewHttpError ?? 'Could not load overview'}
          endpoint="/api/analytics/overview"
          tables={['agentsam_workflow_runs', 'agentsam_usage_events', 'agentsam_execution_steps']}
          nextStep="Sign in at /auth/login, then reload. If this persists, check the network response for /api/analytics/overview (session cookies must be sent)."
        />
      </div>
    );
  }

  if (!pulse.ok) {
    return (
      <div className="space-y-3">
        <BlockedCallout
          title="Overview response unsuccessful"
          endpoint="/api/analytics/overview"
          nextStep="Inspect the JSON body for error fields or Worker logs."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 text-[var(--text)]">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border-subtle)] pb-3">
        <div>
          <div className="text-[14px] font-semibold tracking-tight">Performance overview</div>
          <div className="text-[11px] text-muted mt-0.5">
            Workflow runs, token volume, and model mix — filtered by your tenant and workspace when the API resolves
            them.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted">Range</span>
          <div className="inline-flex rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5">
            {(['24h', '7d', '30d'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
                  range === r
                    ? 'bg-emerald-600/30 text-emerald-100 font-medium'
                    : 'text-muted hover:text-[var(--text)]'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-2 text-[11px] text-muted">
        <div>
          System pulse
          {pulse.meta?.tenantId ? (
            <span className="ml-2 font-mono text-[10px]">tenant:{String(pulse.meta.tenantId).slice(0, 24)}</span>
          ) : null}
          {pulse.meta?.workspaceId ? (
            <span className="ml-2 font-mono text-[10px]">ws:{String(pulse.meta.workspaceId).slice(0, 24)}</span>
          ) : null}
        </div>
        <div className="text-right">
          <div>API range: {pulse.range}</div>
          <div>Refreshed: {loadedAt ? new Date(loadedAt).toLocaleString() : '—'}</div>
          {pulse.meta?.generatedAt ? <div className="font-mono text-[10px]">API: {pulse.meta.generatedAt}</div> : null}
        </div>
      </div>

      {(pulse.warnings || []).length ? (
        <div className="rounded-lg border border-amber-500/30 bg-[var(--bg-panel)] p-2 space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-muted">Warnings</div>
          {(pulse.warnings || []).map((w, i) => (
            <div key={i} className="text-[12px] text-amber-100/90">
              [{w.code}] {w.message}
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 shadow-[0_0_0_1px_rgba(148,163,184,0.04)]">
          <div className="text-[10px] uppercase tracking-wide text-muted">Workflow runs</div>
          <div className="mt-1 text-[20px] font-semibold">{fmtNumber(wfTotal)}</div>
          <div className="text-[10px] text-muted mt-1">
            done {fmtNumber(wf?.completed)} / fail {fmtNumber(wf?.failed)} / run {fmtNumber(wf?.running)}
          </div>
          <div className="text-[10px] text-muted">{kpis?.workflowRuns?.sourceTables?.join(', ')}</div>
          <MiniSparkline data={(kpis?.workflowRuns?.sparkline || []) as number[]} color="#38bdf8" />
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted">Eval pass rate</div>
          <div className="mt-1 text-[20px] font-semibold">
            {kpis?.evalPassRate?.isLive ? (
              <>
                {fmtNumber((kpis.evalPassRate.value as { pass_rate_percent?: number })?.pass_rate_percent)}
                <span className="text-[14px] font-normal text-muted">%</span>
              </>
            ) : (
              <span className="text-muted">BLOCKED</span>
            )}
          </div>
          <div className="text-[10px] text-muted mt-1">
            passed {(kpis?.evalPassRate?.value as { passed?: number })?.passed ?? '—'} / total{' '}
            {(kpis?.evalPassRate?.value as { total?: number })?.total ?? '—'}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted">Tool / execution success</div>
          <div className="mt-1 text-[20px] font-semibold">
            {(kpis?.toolSuccess?.value as { success_rate_percent?: number })?.success_rate_percent != null
              ? `${fmtNumber((kpis?.toolSuccess?.value as { success_rate_percent?: number }).success_rate_percent)}%`
              : wfSteps.length
                ? '—'
                : 'EMPTY'}
          </div>
          <div className="text-[10px] text-muted mt-1">
            calls {fmtNumber((kpis?.toolSuccess?.value as { calls?: number })?.calls)}
          </div>
          <div className="text-[10px] font-mono text-muted">
            {(kpis?.toolSuccess?.value as { source_table?: string })?.source_table}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted">Open errors</div>
          <div className="mt-1 text-[20px] font-semibold">
            {fmtNumber((kpis?.openErrors?.value as { count?: number })?.count)}
          </div>
          <div className="text-[10px] text-muted mt-1">
            {(kpis?.openErrors?.value as { source_table?: string })?.source_table}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted">Token usage</div>
          <div className="mt-1 text-[20px] font-semibold">{fmtNumber(tokenKpi?.total)}</div>
          <div className="text-[10px] text-muted mt-1">
            in {fmtNumber(tokenKpi?.input)} / out {fmtNumber(tokenKpi?.output)}
          </div>
          {kpis?.tokenUsage?.warning ? (
            <div className="text-[10px] text-amber-200/80 mt-1">{kpis.tokenUsage.warning}</div>
          ) : null}
          <MiniSparkline data={(kpis?.tokenUsage?.sparkline || []) as number[]} color="#a78bfa" />
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted">AI cost</div>
          <div className="mt-1 text-[20px] font-semibold tabular-nums">{formatCost(costKpi?.period_usd)}</div>
          <div className="text-[10px] text-muted mt-1">
            30d rollup {formatCost(costKpi?.monthly_30d_usd)}
            {costKpi?.routing_decisions_usd != null && Number(costKpi.routing_decisions_usd) > 0 ? (
              <span className="ml-2">routing Σ {formatCost(costKpi.routing_decisions_usd)}</span>
            ) : null}
          </div>
          {kpis?.aiCost?.warning ? (
            <div className="text-[10px] text-amber-200/80 mt-1">{kpis.aiCost.warning}</div>
          ) : null}
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted">Avg latency</div>
          <div className="mt-1 text-[20px] font-semibold">{fmtMs(latencyKpi?.avg_ms)}</div>
          <div className="text-[10px] text-muted mt-1">
            p95 {fmtMs(latencyKpi?.p95_ms)} · latest model {String(latencyKpi?.latest_model || '—')}
          </div>
          {latencyKpi?.latest_model_latency_ms != null ? (
            <div className="text-[10px] text-muted">last call {fmtMs(latencyKpi.latest_model_latency_ms)}</div>
          ) : null}
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted">Data health</div>
          <div className="mt-1 text-[20px] font-semibold">
            {String((kpis?.dataHealth?.value as { score?: string })?.score || '—')}
          </div>
          <div className="text-[10px] text-muted mt-1">
            live {fmtNumber((kpis?.dataHealth?.value as { live_sources?: number })?.live_sources)} · empty{' '}
            {fmtNumber((kpis?.dataHealth?.value as { empty_sources?: number })?.empty_sources)} · blocked{' '}
            {fmtNumber((kpis?.dataHealth?.value as { blocked_sources?: number })?.blocked_sources)}
          </div>
        </div>
      </div>

      <OverviewPortablePanels pulse={pulse} />

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase text-muted">Workflow runs over time</div>
              <div className="text-[12px] text-muted">agentsam_workflow_runs · by status</div>
            </div>
            {pulse.summary?.waterfall_run_id ? (
              <div className="text-[10px] font-mono text-muted">
                highlight {String(pulse.summary.waterfall_run_id).slice(0, 28)}
              </div>
            ) : null}
          </div>
          <div className="h-56 mt-2">
            {wfChart.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={wfChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', fontSize: 11 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="completed" stackId="a" fill="#34d399" name="completed" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="failed" stackId="a" fill="#f87171" name="failed" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="running" stackId="a" fill="#38bdf8" name="running" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="other" stackId="a" fill="#64748b" name="other" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-[12px] text-muted p-4">EMPTY · no workflow rows in window</div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
          <div className="text-[11px] uppercase text-muted">Tokens by day</div>
          <div className="text-[12px] text-muted mb-2">Input vs output (stacked bars)</div>
          <div className="h-56">
            {tokenChart.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tokenChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', fontSize: 11 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="in" name="Input tokens" fill="#38bdf8" stackId="tok" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="out" name="Output tokens" fill="#c084fc" stackId="tok" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-[12px] text-muted p-4">No usage rows in this window.</div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
          <div className="text-[11px] uppercase text-muted">Model usage (runs)</div>
          <div className="text-[12px] text-muted mb-2">Top models by call volume</div>
          <div className="h-64">
            {leaderBarData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={leaderBarData} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={118}
                    tick={{ fill: 'var(--text-muted)', fontSize: 9 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', fontSize: 11 }}
                  />
                  <Bar dataKey="runs" name="Runs" fill="#34d399" radius={[0, 6, 6, 0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-[12px] text-muted p-4">No model leaderboard rows in window.</div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
          <div className="text-[11px] uppercase text-muted">Model latency (avg ms)</div>
          <div className="text-[12px] text-muted mb-2">From usage leaderboard — same models as left</div>
          <div className="h-64">
            {latencyBarData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={latencyBarData} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickLine={false} unit=" ms" />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={118}
                    tick={{ fill: 'var(--text-muted)', fontSize: 9 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', fontSize: 11 }}
                    formatter={(v: number) => [`${fmtNumber(v)} ms`, 'Avg latency']}
                  />
                  <Bar dataKey="ms" name="Avg ms" fill="#fbbf24" radius={[0, 6, 6, 0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-[12px] text-muted p-4">No latency samples for models in window.</div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[11px] uppercase text-muted">Execution waterfall</div>
            <div className="text-[12px] text-muted">
              agentsam_execution_steps · run {waterfall?.workflow_run_id || '—'}
            </div>
          </div>
          <div className="text-[10px] font-mono text-muted">group {waterfall?.run_group_id || '—'}</div>
        </div>
        {waterfall?.state === 'BLOCKED' ? (
          <div className="mt-2 text-[12px] text-muted">{waterfall.reason}</div>
        ) : wfSteps.length ? (
          <div className="mt-3 space-y-2">
            {wfSteps.map((s, idx) => (
              <div key={`${s.node_key}-${idx}`} className="flex items-center gap-2 text-[11px]">
                <div className="w-40 shrink-0 font-mono truncate" title={s.node_key}>
                  {s.node_key}
                </div>
                <div className="flex-1 h-2 rounded bg-[var(--bg-canvas)] border border-[var(--border-subtle)] overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-sky-500/80 to-violet-500/80"
                    style={{ width: `${Math.round((s.bar || 0) * 100)}%` }}
                  />
                </div>
                <div className="w-24 text-right text-muted">{fmtMs(s.latency_ms)}</div>
                {String(s.node_key || '').includes('call_openai_model') ||
                String(s.node_key || '').includes('openai') ||
                String(s.node_key || '').includes('model') ? (
                  <div className="w-44 text-right font-mono text-[10px] text-muted">
                    tok {fmtNumber((s.tokens_in || 0) + (s.tokens_out || 0))} · {formatCost(s.cost_usd)}
                  </div>
                ) : (
                  <div className="w-44" />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 text-[12px] text-muted">EMPTY · no steps for selected workflow run</div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 overflow-auto">
          <div className="text-[11px] uppercase text-muted mb-2">Error inbox</div>
          <table className="w-full text-left text-[11px]">
            <thead className="text-muted uppercase">
              <tr>
                <th className="p-1">Time</th>
                <th className="p-1">Src</th>
                <th className="p-1">Message</th>
                <th className="p-1">Run group</th>
              </tr>
            </thead>
            <tbody>
              {(pulse.errorInbox || []).slice(0, 25).map((r, i) => (
                <tr key={i} className="border-t border-[var(--border-subtle)]">
                  <td className="p-1 whitespace-nowrap">{r.time ? String(r.time).slice(0, 19) : '—'}</td>
                  <td className="p-1">{r.source}</td>
                  <td className="p-1 max-w-[220px] truncate" title={r.message}>
                    {r.message}
                  </td>
                  <td className="p-1 font-mono text-[10px]">{r.run_group_id || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!(pulse.errorInbox || []).length ? (
            <div className="text-[12px] text-muted mt-2">
              EMPTY · Supabase agentsam_error_events (no rows returned)
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 overflow-auto">
          <div className="text-[11px] uppercase text-muted mb-2">Model leaderboard</div>
          <table className="w-full text-left text-[11px]">
            <thead className="text-muted uppercase">
              <tr>
                <th className="p-1">Model</th>
                <th className="p-1">Prov</th>
                <th className="p-1">Runs</th>
                <th className="p-1">OK%</th>
                <th className="p-1">Lat</th>
                <th className="p-1">Cost</th>
                <th className="p-1">Priced</th>
              </tr>
            </thead>
            <tbody>
              {(pulse.modelLeaderboard || []).map((r, i) => (
                <tr key={i} className="border-t border-[var(--border-subtle)]">
                  <td className="p-1 font-mono">{String(r.model)}</td>
                  <td className="p-1">{String(r.provider)}</td>
                  <td className="p-1">{fmtNumber(r.runs)}</td>
                  <td className="p-1">{r.success_rate != null ? `${fmtNumber(r.success_rate)}%` : '—'}</td>
                  <td className="p-1">{fmtMs(r.avg_latency_ms)}</td>
                  <td className="p-1 font-mono">{formatCost(r.avg_cost)}</td>
                  <td className="p-1">{r.priced ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!(pulse.modelLeaderboard || []).length ? (
            <div className="text-[12px] text-muted mt-2">EMPTY · no usage_events in window</div>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
        <div className="text-[11px] uppercase text-muted mb-1">Cost vs latency</div>
        <div className="text-[12px] text-muted mb-2">
          agentsam_usage_events · y=cost · x=latency · size=tokens
        </div>
        <div className="h-64">
          {scatterData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="latency_ms"
                  tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                  label={{ value: 'ms', position: 'insideBottom', offset: -4, fill: 'var(--text-muted)', fontSize: 10 }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="cost_usd"
                  tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                  tickFormatter={(v) => formatCost(v)}
                />
                <ZAxis type="number" dataKey="z" range={[40, 400]} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  formatter={(v: number, name: string) => (name === 'cost_usd' ? formatCost(v) : v)}
                  contentStyle={{ background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', fontSize: 11 }}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {scatterProviders.map((prov, idx) => (
                  <Scatter
                    key={prov}
                    name={prov}
                    data={scatterData.filter((d) => d.provider === prov)}
                    fill={SCATTER_COLORS[idx % SCATTER_COLORS.length]}
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-[12px] text-muted p-4">EMPTY · no usage points with cost/latency</div>
          )}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
          <div className="text-[11px] uppercase text-muted">Codebase overview</div>
          {codebaseStub ? (
            <BlockedCallout
              title="Stub or not implemented"
              endpoint="/api/analytics/codebase"
              tables={['codebase_files', 'codebase_chunks', 'codebase_symbols']}
              nextStep="Implement handler or fix Hyperdrive"
            />
          ) : codebase?.ok ? (
            <div className="mt-2 text-[12px] space-y-1">
              <div>Files {fmtNumber((codebase.summary as { file_count?: number })?.file_count)}</div>
              <div>Chunks {fmtNumber((codebase.summary as { chunk_count?: number })?.chunk_count)}</div>
              <div>Symbols {fmtNumber((codebase.summary as { symbol_count?: number })?.symbol_count)}</div>
            </div>
          ) : (
            <BlockedCallout
              title="Codebase panel blocked"
              endpoint="/api/analytics/codebase"
              nextStep={String((codebase as { reason?: string })?.reason || 'Fix Supabase / Hyperdrive')}
            />
          )}
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
          <div className="text-[11px] uppercase text-muted">RAG / document health</div>
          {ragStub ? (
            <BlockedCallout title="Stub" endpoint="/api/analytics/rag" tables={['documents', 'semantic_search_log']} />
          ) : rag?.ok ? (
            <div className="mt-2 text-[12px] space-y-1">
              <div>Documents {fmtNumber((rag.summary as { document_count?: number })?.document_count)}</div>
              <div>Embedded {fmtNumber((rag.summary as { embedded_document_count?: number | null })?.embedded_document_count)}</div>
              <div>Search logs {fmtNumber((rag.summary as { search_log_count?: number })?.search_log_count)}</div>
              {(rag.breakdowns as Array<{ rows?: Array<{ key?: string; count?: number }> }> | undefined)?.[0]?.rows
                ?.length ? (
                <div className="text-[10px] text-muted">Source breakdown available in breakdowns</div>
              ) : (
                <div className="text-[10px] text-amber-200/80">
                  Source breakdown unavailable — documents.source / metadata mapping not exposed in this rollup
                </div>
              )}
            </div>
          ) : (
            <BlockedCallout title="RAG panel blocked" endpoint="/api/analytics/rag" />
          )}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
        <div className="text-[11px] uppercase text-muted mb-2">Deployments</div>
        {pulse.deployments?.state === 'BLOCKED' ? (
          <BlockedCallout
            title="Deployments blocked"
            tables={['build_deploy_events', 'cicd_github_runs', 'deployments (D1)']}
            nextStep={String(pulse.deployments.nextStep || pulse.deployments.reason || '')}
          />
        ) : (
          <div className="text-[12px] font-mono space-y-1">
            {(pulse.deployments?.rows as Array<Record<string, unknown>> | undefined)?.slice(0, 12).map((r, i) => (
              <div key={i} className="flex justify-between gap-2 border-t border-[var(--border-subtle)] pt-1">
                <span className="truncate">{String(r.id || r.run_id || i)}</span>
                <span className="text-muted">{String(r.status || '—')}</span>
                <span className="text-muted whitespace-nowrap">
                  {r.created_at ? String(r.created_at).slice(0, 19) : r.timestamp ? String(r.timestamp).slice(0, 19) : '—'}
                </span>
              </div>
            ))}
            {!(pulse.deployments?.rows as unknown[])?.length ? (
              <div className="text-muted">EMPTY · no deploy rows</div>
            ) : null}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
        <div className="text-[11px] uppercase text-muted mb-2">Source status</div>
        <div className="grid gap-2 sm:grid-cols-2 text-[11px]">
          <div>
            <div className="text-muted">live</div>
            <ul className="list-disc pl-4">
              {(pulse.sourceStatus?.live || []).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-muted">empty</div>
            <ul className="list-disc pl-4">
              {(pulse.sourceStatus?.empty || []).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-muted">blocked</div>
            <ul className="list-disc pl-4">
              {(pulse.sourceStatus?.blocked || []).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-muted">errors</div>
            <ul className="list-disc pl-4">
              {(pulse.sourceStatus?.errors || []).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
        <div className="text-[11px] uppercase text-muted mb-2">D1 / Supabase freshness (source-health)</div>
        <div className="overflow-auto border border-[var(--border-subtle)] rounded max-h-56">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-[var(--bg-panel)] text-muted uppercase">
              <tr>
                <th className="p-2">Backend</th>
                <th className="p-2">Table</th>
                <th className="p-2">Rows</th>
                <th className="p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(health?.rows || []).slice(0, 24).map((r: Record<string, unknown>, idx: number) => (
                <tr key={idx} className="border-t border-[var(--border-subtle)]">
                  <td className="p-2">{String(r.backend)}</td>
                  <td className="p-2 font-mono">{String(r.table)}</td>
                  <td className="p-2">{fmtNumber(r.row_count)}</td>
                  <td className="p-2">{String(r.status || '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
