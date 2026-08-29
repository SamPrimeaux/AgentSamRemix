import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { AnalyticsHeader } from '../components/analytics/AnalyticsHeader';
import type { AnalyticsLayoutResponse } from '../components/analytics/types';

type Range = '24h' | '7d' | '30d' | 'all';

type HealthTone = 'healthy' | 'degraded' | 'critical' | 'neutral';

type KpiTile = {
  label: string;
  value: string;
  tone: HealthTone;
  hint?: string;
};

type RoutingArmRow = Record<string, unknown>;

const PROVIDER_COLORS: Record<string, string> = {
  openai: '#10a37f',
  anthropic: '#d97757',
  google: '#4285f4',
  workers_ai: '#f38020',
  cloudflare: '#f38020',
};

const INSIGHT_PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#E8713D',
  openai: '#8B5CF6',
  google: '#10B981',
  workers_ai: '#F59E0B',
};

const WIN_COLOR = '#10B981';
const LOSS_COLOR = '#EF4444';
const WARN_COLOR = '#F59E0B';

const colorFor = (p: unknown) => INSIGHT_PROVIDER_COLORS[String(p || '').toLowerCase()] ?? '#6B7280';

type InsightSection = { ok: boolean; rows: Record<string, unknown>[]; error?: string };

type InsightsPayload = {
  routing_eto?: InsightSection;
  model_quality?: InsightSection;
  tool_stats?: InsightSection;
  model_evals?: InsightSection;
  deploy_health?: InsightSection;
  model_drift?: InsightSection;
};

const RANGE_DEFAULT: Range = '7d';

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function fmtPct(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${Math.round(v * 10) / 10}%`;
}

/** D1 rates may be 0–1 or 0–100. */
function rateToPercent(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  if (v > 0 && v <= 1) return v * 100;
  return v;
}

function fmtMs(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v < 1000) return `${Math.round(v)} ms`;
  return `${Math.round((v / 1000) * 100) / 100}s`;
}

function fmtCount(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return String(Math.round(v));
}

function toneClass(tone: HealthTone): string {
  if (tone === 'healthy') return 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10';
  if (tone === 'degraded') return 'text-amber-400 border-amber-500/40 bg-amber-500/10';
  if (tone === 'critical') return 'text-rose-400 border-rose-500/40 bg-rose-500/10';
  return 'text-muted border-[var(--border-subtle)] bg-[var(--bg-panel)]';
}

function toolSuccessTone(rate: number | null): HealthTone {
  if (rate == null) return 'neutral';
  if (rate >= 90) return 'healthy';
  if (rate >= 70) return 'degraded';
  return 'critical';
}

function latencyTone(p95: number | null): HealthTone {
  if (p95 == null) return 'neutral';
  if (p95 <= 2000) return 'healthy';
  if (p95 <= 5000) return 'degraded';
  return 'critical';
}

function openErrorsTone(count: number | null): HealthTone {
  if (count == null) return 'neutral';
  if (count === 0) return 'healthy';
  if (count <= 5) return 'degraded';
  return 'critical';
}

function activeArmsTone(count: number | null): HealthTone {
  if (count == null) return 'neutral';
  if (count > 0) return 'healthy';
  return 'degraded';
}

function okRateTone(rate: number | null): HealthTone {
  return toolSuccessTone(rate);
}

function providerColor(provider: string): string {
  const key = String(provider || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
  return PROVIDER_COLORS[key] || '#64748b';
}

function statusBadgeColor(statusOrSeverity: string): string {
  const s = String(statusOrSeverity || '').toLowerCase();
  if (['success', 'ok', 'healthy', 'passed'].some((k) => s.includes(k))) return WIN_COLOR;
  if (['failure', 'error', 'regression', 'breaking', 'failed'].some((k) => s.includes(k))) return LOSS_COLOR;
  return WARN_COLOR;
}

function toolRateBarColor(ratePct: number): string {
  if (ratePct >= 90) return WIN_COLOR;
  if (ratePct >= 70) return WARN_COLOR;
  return LOSS_COLOR;
}

function fmtReward(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return String(Math.round(v * 100) / 100);
}

function sectionHasData(section: InsightSection | undefined): boolean {
  return Boolean(section?.ok && (section.rows?.length ?? 0) > 0);
}

function InsightCardShell({
  cardClass,
  label,
  hero,
  children,
  loading,
  empty,
}: {
  cardClass: string;
  label: string;
  hero: React.ReactNode;
  children: React.ReactNode;
  loading: boolean;
  empty: boolean;
}) {
  return (
    <article
      className={`relative flex min-h-[160px] min-w-0 flex-col rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 ${cardClass}`}
    >
      <div className="absolute right-3 top-3 rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[9px] uppercase tracking-wide text-muted">
        Last 7d
      </div>
      {loading ? (
        <div className="flex flex-1 flex-col gap-3 animate-pulse">
          <div className="h-3 w-24 rounded bg-[var(--border-subtle)]" />
          <div className="card-hero-number h-10 w-32 rounded bg-[var(--border-subtle)]" />
          <div className="card-chart mt-auto flex-1 rounded bg-[var(--border-subtle)]" />
        </div>
      ) : (
        <>
          <p className="text-[10px] font-medium uppercase tracking-widest text-muted">{label}</p>
          <div className="card-hero-number mt-1 tabular-nums text-[var(--text)]">{hero}</div>
          <div className="card-chart mt-3 min-h-0 overflow-hidden">{empty ? <InsightEmpty /> : children}</div>
        </>
      )}
    </article>
  );
}

function InsightEmpty() {
  return (
    <div className="flex h-full min-h-[80px] flex-col items-center justify-center gap-1 text-center">
      <span className="card-hero-number text-muted">—</span>
      <span className="text-[11px] text-muted">No data yet</span>
    </div>
  );
}

const ANALYTICS_BENTO_CSS = `
.analytics-bento {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  padding: 12px;
  width: 100%;
  min-width: 0;
  overflow-x: hidden;
  box-sizing: border-box;
}
@media (min-width: 768px) {
  .analytics-bento {
    grid-template-columns: repeat(6, 1fr);
    gap: 16px;
  }
  .analytics-bento .card-routing { grid-column: span 4; grid-row: span 2; }
  .analytics-bento .card-quality { grid-column: span 2; grid-row: span 2; }
  .analytics-bento .card-tools { grid-column: span 2; }
  .analytics-bento .card-evals { grid-column: span 2; }
  .analytics-bento .card-deploy { grid-column: span 2; }
  .analytics-bento .card-drift { grid-column: span 6; }
}
@media (min-width: 1024px) {
  .analytics-bento {
    grid-template-columns: repeat(12, 1fr);
    gap: 20px;
  }
  .analytics-bento .card-routing { grid-column: span 5; grid-row: span 2; }
  .analytics-bento .card-quality { grid-column: span 4; grid-row: span 2; }
  .analytics-bento .card-tools { grid-column: span 3; grid-row: span 2; }
  .analytics-bento .card-evals { grid-column: span 4; }
  .analytics-bento .card-deploy { grid-column: span 4; }
  .analytics-bento .card-drift { grid-column: span 4; }
}
.analytics-bento .card-hero-number {
  font-size: clamp(1.25rem, 3vw, 2.25rem);
  font-weight: 700;
  line-height: 1;
}
.analytics-bento .card-chart {
  height: clamp(80px, 15vw, 180px);
}
.analytics-bento .card-list-item:nth-child(n+4) { display: none; }
@media (min-width: 768px) {
  .analytics-bento .card-list-item:nth-child(n+4) { display: flex; }
}
`;

function SectionShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] overflow-hidden">
      <header className="border-b border-[var(--border-subtle)] px-3 py-2">
        <h2 className="text-[13px] font-semibold text-[var(--text)]">{title}</h2>
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function KpiStrip({ tiles }: { tiles: KpiTile[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className={`rounded-lg border p-3 ${toneClass(tile.tone)}`}
        >
          <div className="text-[10px] uppercase tracking-wide opacity-80">{tile.label}</div>
          <div className="mt-1 text-[22px] font-semibold tabular-nums">{tile.value}</div>
          {tile.hint ? <div className="mt-1 text-[10px] opacity-70">{tile.hint}</div> : null}
        </div>
      ))}
    </div>
  );
}

export const AnalyticsPage: React.FC = () => {
  const params = useParams<{ tab?: string }>();
  const legacyTab = String(params.tab || '').trim().toLowerCase();

  const [range] = useState<Range>(RANGE_DEFAULT);
  const [layout, setLayout] = useState<AnalyticsLayoutResponse | null>(null);
  const [layoutLoadedAt, setLayoutLoadedAt] = useState(0);
  const [overview, setOverview] = useState<Record<string, unknown> | null>(null);
  const [leaderboard, setLeaderboard] = useState<Record<string, unknown> | null>(null);
  const [mcpTools, setMcpTools] = useState<Record<string, unknown> | null>(null);
  const [routingArms, setRoutingArms] = useState<Record<string, unknown> | null>(null);
  const [insights, setInsights] = useState<InsightsPayload | null>(null);
  const [insightsLoaded, setInsightsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const data = await getJson<InsightsPayload>('/api/analytics/insights');
      if (cancelled) return;
      setInsights(data);
      setInsightsLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    const q = `range=${range}`;
    const [layoutRes, overviewRes, lbRes, mcpRes, armsRes] = await Promise.all([
      getJson<AnalyticsLayoutResponse>(`/api/analytics/layout?route=${encodeURIComponent('/dashboard/analytics')}`),
      getJson<Record<string, unknown>>(`/api/analytics/overview?${q}`),
      getJson<Record<string, unknown>>(`/api/analytics/models/leaderboard?${q}`),
      getJson<Record<string, unknown>>(`/api/analytics/mcp/tools?${q}`),
      getJson<Record<string, unknown>>(`/api/analytics/models/routing-arms?${q}`),
    ]);
    setLayout(layoutRes);
    setLayoutLoadedAt(Date.now());
    setOverview(overviewRes);
    setLeaderboard(lbRes);
    setMcpTools(mcpRes);
    setRoutingArms(armsRes);
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const kpiTiles = useMemo((): KpiTile[] => {
    const kpis = (overview?.kpis as Record<string, { value?: Record<string, unknown> }>) || {};
    const toolVal = kpis.toolSuccess?.value || {};
    const latVal = kpis.avgLatency?.value || {};
    const errVal = kpis.openErrors?.value || {};

    const toolRate =
      toolVal.success_rate_percent != null
        ? Number(toolVal.success_rate_percent)
        : overview?.summary && typeof overview.summary === 'object'
          ? Number((overview.summary as Record<string, unknown>).tool_success_rate)
          : null;
    const p95 = latVal.p95_ms != null ? Number(latVal.p95_ms) : null;
    const openErr =
      errVal.count != null
        ? Number(errVal.count)
        : overview?.summary && typeof overview.summary === 'object'
          ? Number((overview.summary as Record<string, unknown>).open_error_count)
          : null;

    const armRows = (routingArms?.rows as RoutingArmRow[]) || [];
    const activeArms = armRows.filter(
      (r) => Number(r.is_active ?? 0) === 1 && Number(r.is_eligible ?? 0) === 1,
    ).length;

    return [
      {
        label: 'Tool success rate',
        value: toolRate != null && Number.isFinite(toolRate) ? fmtPct(toolRate) : '—',
        tone: toolSuccessTone(Number.isFinite(toolRate) ? toolRate : null),
        hint: toolVal.source_table ? String(toolVal.source_table) : 'agentsam_execution_steps',
      },
      {
        label: 'Avg latency p95',
        value: fmtMs(p95),
        tone: latencyTone(Number.isFinite(p95) ? p95 : null),
        hint: 'agentsam_execution_performance_metrics',
      },
      {
        label: 'Active routing arms',
        value: routingArms ? fmtCount(activeArms) : '—',
        tone: activeArmsTone(routingArms ? activeArms : null),
        hint: 'agentsam_routing_arms · is_active=1 · is_eligible=1',
      },
      {
        label: 'Open errors',
        value: openErr != null && Number.isFinite(openErr) ? fmtCount(openErr) : '—',
        tone: openErrorsTone(Number.isFinite(openErr) ? openErr : null),
        hint: errVal.source_table ? String(errVal.source_table) : 'agentsam_error_log',
      },
    ];
  }, [overview, routingArms]);

  const modelBarData = useMemo(() => {
    const rows = (leaderboard?.modelLeaderboard as Record<string, unknown>[]) || [];
    return rows.slice(0, 12).map((r) => ({
      name: String(r.model_key || r.model || '(unknown)'),
      runs: Number(r.executions) || 0,
      provider: String(r.provider || ''),
      fill: providerColor(String(r.provider || '')),
    }));
  }, [leaderboard]);

  const scatterData = useMemo(() => {
    const rows = (leaderboard?.costLatencyScatter as Record<string, unknown>[]) || [];
    return rows
      .filter((r) => Number(r.avg_latency_ms) > 0 || Number(r.avg_cost_usd) > 0)
      .map((r) => ({
        name: `${String(r.model_key)} · ${String(r.provider || '')}`,
        x: Number(r.avg_latency_ms) || 0,
        y: Number(r.avg_cost_usd) || 0,
        z: Math.max(Number(r.executions) || 1, 1),
        provider: String(r.provider || ''),
      }));
  }, [leaderboard]);

  const toolRows = useMemo(() => {
    const rows = (mcpTools?.rows as Record<string, unknown>[]) || [];
    return rows.slice(0, 15).map((r) => {
      const calls = Number(r.calls) || 0;
      const ok = Number(r.successes) || 0;
      const rate = calls > 0 ? Math.round((ok / calls) * 1000) / 10 : null;
      return {
        tool_name: String(r.tool_name || '(unknown)'),
        okRate: rate,
        calls,
        tone: okRateTone(rate),
      };
    });
  }, [mcpTools]);

  const chainBreakSummary = useMemo(() => {
    const breaks = (mcpTools?.breakdowns as { rows?: Record<string, unknown>[] }[])?.[0]?.rows || [];
    const byTool = new Map<string, { count: number; lastSeen: number | null; lastError: string }>();
    for (const row of breaks) {
      const name = String(row.tool_name || '(unknown)');
      const seen = row.started_at != null ? Number(row.started_at) : row.completed_at != null ? Number(row.completed_at) : null;
      const prev = byTool.get(name) || { count: 0, lastSeen: null, lastError: '' };
      prev.count += 1;
      if (seen != null && (prev.lastSeen == null || seen > prev.lastSeen)) {
        prev.lastSeen = seen;
        prev.lastError = String(row.error_message || '');
      }
      byTool.set(name, prev);
    }
    return [...byTool.entries()]
      .map(([tool_name, v]) => ({ tool_name, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
  }, [mcpTools]);

  const routingHeroReward = useMemo(() => {
    const rows = insights?.routing_eto?.rows || [];
    const scores = rows.map((r) => Number(r.reward_score)).filter((v) => Number.isFinite(v));
    if (!scores.length) return null;
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return Math.round(avg * 100) / 100;
  }, [insights]);

  const routingActivityByModel = useMemo(() => {
    const rows = insights?.routing_eto?.rows || [];
    const byModel = new Map<string, { success: number; failure: number }>();
    for (const row of rows) {
      const key = String(row.model_key || '(unknown)');
      const prev = byModel.get(key) || { success: 0, failure: 0 };
      prev.success += Number(row.success) || 0;
      prev.failure += Number(row.failure) || 0;
      byModel.set(key, prev);
    }
    return [...byModel.entries()]
      .map(([model_key, v]) => ({
        model_key,
        success: v.success,
        failure: v.failure,
        total: v.success + v.failure,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [insights]);

  const modelQualityBars = useMemo(() => {
    const rows = insights?.model_quality?.rows || [];
    return rows.slice(0, 8).map((row) => ({
      model_key: String(row.model_key || '(unknown)'),
      provider: String(row.provider || ''),
      success: rateToPercent(row.success_rate),
      toolSuccess: rateToPercent(row.tool_success_rate ?? row.code_pass_rate),
    }));
  }, [insights]);

  const modelQualityHero = useMemo(() => {
    const rows = insights?.model_quality?.rows || [];
    if (!rows.length) return null;
    const best = [...rows].sort(
      (a, b) => rateToPercent(b.success_rate) - rateToPercent(a.success_rate),
    )[0];
    return best ? String(best.model_key || '(unknown)') : null;
  }, [insights]);

  const toolStatsBars = useMemo(() => {
    const rows = insights?.tool_stats?.rows || [];
    return rows.slice(0, 12).map((row) => ({
      tool_name: String(row.tool_name || '(unknown)'),
      rate: rateToPercent(row.success_rate),
      calls: Number(row.total_calls) || 0,
    }));
  }, [insights]);

  const toolStatsHeroRate = useMemo(() => {
    const rows = insights?.tool_stats?.rows || [];
    if (!rows.length) return null;
    const rates = rows.map((r) => rateToPercent(r.success_rate)).filter((v) => Number.isFinite(v));
    if (!rates.length) return null;
    return Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10;
  }, [insights]);

  const evalPassFailByModel = useMemo(() => {
    const rows = insights?.model_evals?.rows || [];
    const byModel = new Map<string, { passed: number; failed: number }>();
    for (const row of rows) {
      const key = String(row.model_key || '(unknown)');
      const prev = byModel.get(key) || { passed: 0, failed: 0 };
      if (Number(row.passed) === 1) prev.passed += 1;
      else prev.failed += 1;
      byModel.set(key, prev);
    }
    return [...byModel.entries()]
      .map(([model_key, v]) => ({
        model_key,
        passed: v.passed,
        failed: v.failed,
        total: v.passed + v.failed,
        rate: v.passed + v.failed > 0 ? Math.round((v.passed / (v.passed + v.failed)) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [insights]);

  const evalHeroPassRate = useMemo(() => {
    const rows = insights?.model_evals?.rows || [];
    if (!rows.length) return null;
    const passed = rows.filter((r) => Number(r.passed) === 1).length;
    return Math.round((passed / rows.length) * 1000) / 10;
  }, [insights]);

  const deployRows = useMemo(() => {
    const rows = insights?.deploy_health?.rows || [];
    return rows.slice(0, 12).map((r, idx) => {
      const status = String(r.status ?? 'unknown');
      const tsRaw = r.checked_at ?? r.last_checked_at;
      let ts: number | null = null;
      if (typeof tsRaw === 'number') ts = tsRaw > 1e12 ? tsRaw : tsRaw * 1000;
      else if (tsRaw != null) {
        const parsed = Date.parse(String(tsRaw));
        ts = Number.isFinite(parsed) ? parsed : null;
      }
      return {
        id: String(r.id || `${r.worker_name}-${idx}`),
        worker_name: String(r.worker_name || '(worker)'),
        status,
        response_ms: Number(r.response_time_ms),
        ts,
        badgeColor: statusBadgeColor(status),
      };
    });
  }, [insights]);

  const deployHeroStatus = useMemo(() => {
    const rows = insights?.deploy_health?.rows || [];
    if (!rows.length) return null;
    return String(rows[0]?.status ?? '—');
  }, [insights]);

  const driftRows = useMemo(() => {
    const rows = insights?.model_drift?.rows || [];
    return rows.slice(0, 12).map((r, idx) => {
      const detected = r.detected_at;
      let ts: number | null = null;
      if (typeof detected === 'number') ts = detected > 1e12 ? detected : detected * 1000;
      return {
        id: String(r.model_key || idx),
        model_key: String(r.model_key || '(unknown)'),
        severity: String(r.severity || 'info'),
        delta_pct: Number(r.delta_pct),
        ts,
        badgeColor: statusBadgeColor(String(r.severity || '')),
      };
    });
  }, [insights]);

  const driftHeroCount = useMemo(() => {
    const rows = insights?.model_drift?.rows || [];
    return rows.length;
  }, [insights]);

  const routingArmBars = useMemo(() => {
    const rows = (routingArms?.rows as RoutingArmRow[]) || [];
    return rows
      .map((r) => {
        const alpha = Number(r.success_alpha ?? 1);
        const beta = Number(r.success_beta ?? 1);
        const denom = alpha + beta;
        const confidence = denom > 0 ? alpha / denom : null;
        return {
          id: String(r.id || r.arm_key || `${r.model_key}-${r.task_type}`),
          model_key: String(r.model_key || r.model || '(unknown)'),
          task_type: String(r.task_type || '—'),
          decayed_score: Number(r.decayed_score ?? 0),
          total_executions: Number(r.total_executions ?? 0),
          confidence,
        };
      })
      .sort((a, b) => b.decayed_score - a.decayed_score)
      .slice(0, 24);
  }, [routingArms]);

  const failureBreakdownRows = useMemo(() => {
    const rows = (routingArms?.failure_breakdown as Record<string, unknown>[]) || [];
    return rows
      .map((r) => ({
        model_key: String(r.model_key || '(unknown)'),
        failure_category: String(r.failure_category || '—'),
        event_count: Number(r.event_count ?? 0),
        bandit_skipped_count: Number(r.bandit_skipped_count ?? 0),
      }))
      .filter((r) => r.event_count > 0)
      .slice(0, 40);
  }, [routingArms]);

  if (legacyTab) {
    return <Navigate to="/dashboard/analytics" replace />;
  }

  return (
    <div className="ov-wrap flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden w-full">
      <AnalyticsHeader layout={layout} layoutLoadedAt={layoutLoadedAt} />
      <div className="flex-1 min-h-0 overflow-auto p-3 space-y-4">
        <div className="analytics-bento">
          <style>{ANALYTICS_BENTO_CSS}</style>

          <InsightCardShell
            cardClass="card-routing"
            label="Routing activity"
            hero={
              routingHeroReward != null && sectionHasData(insights?.routing_eto)
                ? fmtReward(routingHeroReward)
                : '—'
            }
            loading={!insightsLoaded}
            empty={!sectionHasData(insights?.routing_eto)}
          >
            <div className="flex h-full flex-col gap-2 overflow-auto pr-1">
              {routingActivityByModel.map((m) => {
                const denom = Math.max(m.total, 1);
                const successPct = (m.success / denom) * 100;
                const failurePct = (m.failure / denom) * 100;
                return (
                  <div key={m.model_key} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="truncate font-mono text-[var(--text)]">{m.model_key}</span>
                      <span className="tabular-nums text-muted">
                        {m.success}↑ {m.failure}↓
                      </span>
                    </div>
                    <div className="flex h-2 overflow-hidden rounded-full bg-[var(--border-subtle)]">
                      <div className="h-full" style={{ width: `${successPct}%`, backgroundColor: WIN_COLOR }} />
                      <div className="h-full" style={{ width: `${failurePct}%`, backgroundColor: LOSS_COLOR }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </InsightCardShell>

          <InsightCardShell
            cardClass="card-quality"
            label="Model quality"
            hero={
              modelQualityHero && sectionHasData(insights?.model_quality) ? modelQualityHero : '—'
            }
            loading={!insightsLoaded}
            empty={!sectionHasData(insights?.model_quality)}
          >
            <div className="flex h-full flex-col gap-2.5 overflow-auto pr-1">
              {modelQualityBars.map((m) => (
                <div key={m.model_key} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="truncate font-mono text-[var(--text)]">{m.model_key}</span>
                    <span style={{ color: colorFor(m.provider) }} className="shrink-0 text-[9px] uppercase">
                      {m.provider || '—'}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex h-1.5 overflow-hidden rounded-full bg-[var(--border-subtle)]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(Math.max(m.success, 0), 100)}%`,
                          backgroundColor: colorFor(m.provider),
                        }}
                      />
                    </div>
                    <div className="flex h-1.5 overflow-hidden rounded-full bg-[var(--border-subtle)]">
                      <div
                        className="h-full rounded-full opacity-70"
                        style={{
                          width: `${Math.min(Math.max(m.toolSuccess, 0), 100)}%`,
                          backgroundColor: colorFor(m.provider),
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex justify-between text-[9px] text-muted tabular-nums">
                    <span>success {fmtPct(m.success)}</span>
                    <span>tools {fmtPct(m.toolSuccess)}</span>
                  </div>
                </div>
              ))}
            </div>
          </InsightCardShell>

          <InsightCardShell
            cardClass="card-tools"
            label="Tool reliability"
            hero={
              toolStatsHeroRate != null && sectionHasData(insights?.tool_stats)
                ? `${toolStatsHeroRate}%`
                : '—'
            }
            loading={!insightsLoaded}
            empty={!sectionHasData(insights?.tool_stats)}
          >
            <div className="flex h-full flex-col gap-2 overflow-auto pr-1">
              {toolStatsBars.map((t) => (
                <div key={t.tool_name} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="truncate font-mono text-[var(--text)]">{t.tool_name}</span>
                    <span className="tabular-nums" style={{ color: toolRateBarColor(t.rate) }}>
                      {fmtPct(t.rate)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--border-subtle)]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(Math.max(t.rate, 0), 100)}%`,
                        backgroundColor: toolRateBarColor(t.rate),
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </InsightCardShell>

          <InsightCardShell
            cardClass="card-evals"
            label="Eval results"
            hero={
              evalHeroPassRate != null && sectionHasData(insights?.model_evals) ? `${evalHeroPassRate}%` : '—'
            }
            loading={!insightsLoaded}
            empty={!sectionHasData(insights?.model_evals)}
          >
            <div className="flex h-full flex-col gap-2 overflow-auto pr-1">
              {evalPassFailByModel.map((m) => {
                const denom = Math.max(m.total, 1);
                const passPct = (m.passed / denom) * 100;
                const failPct = (m.failed / denom) * 100;
                return (
                  <div key={m.model_key} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="truncate font-mono text-[var(--text)]">{m.model_key}</span>
                      <span className="tabular-nums text-muted">{m.rate}%</span>
                    </div>
                    <div className="flex h-2 overflow-hidden rounded-full bg-[var(--border-subtle)]">
                      <div className="h-full" style={{ width: `${passPct}%`, backgroundColor: WIN_COLOR }} />
                      <div className="h-full" style={{ width: `${failPct}%`, backgroundColor: LOSS_COLOR }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </InsightCardShell>

          <InsightCardShell
            cardClass="card-deploy"
            label="Worker health"
            hero={
              deployHeroStatus && sectionHasData(insights?.deploy_health) ? deployHeroStatus : '—'
            }
            loading={!insightsLoaded}
            empty={!sectionHasData(insights?.deploy_health)}
          >
            <ul className="flex h-full flex-col gap-1.5 overflow-auto pr-1">
              {deployRows.map((d) => (
                <li
                  key={d.id}
                  className="card-list-item flex-col gap-0.5 rounded border border-[var(--border-subtle)] px-2 py-1.5 text-[10px]"
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="truncate font-mono text-[var(--text)]">{d.worker_name}</span>
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase"
                      style={{ color: d.badgeColor, backgroundColor: `${d.badgeColor}22` }}
                    >
                      {d.status}
                    </span>
                  </div>
                  <div className="flex w-full items-center justify-between gap-2 text-[9px] text-muted tabular-nums">
                    <span>{Number.isFinite(d.response_ms) ? `${Math.round(d.response_ms)} ms` : '—'}</span>
                    <span>{d.ts != null ? new Date(d.ts).toLocaleString() : '—'}</span>
                  </div>
                </li>
              ))}
            </ul>
          </InsightCardShell>

          <InsightCardShell
            cardClass="card-drift"
            label="Model drift"
            hero={
              sectionHasData(insights?.model_drift) ? fmtCount(driftHeroCount) : '—'
            }
            loading={!insightsLoaded}
            empty={!sectionHasData(insights?.model_drift)}
          >
            <ul className="flex h-full flex-col gap-1.5 overflow-auto pr-1">
              {driftRows.map((d) => (
                <li
                  key={d.id}
                  className="card-list-item flex w-full items-center justify-between gap-2 rounded border border-[var(--border-subtle)] px-2 py-1.5 text-[10px]"
                >
                  <span className="truncate font-mono text-[var(--text)]">{d.model_key}</span>
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase"
                    style={{ color: d.badgeColor, backgroundColor: `${d.badgeColor}22` }}
                  >
                    {d.severity}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted">
                    {Number.isFinite(d.delta_pct) ? `${Math.round(d.delta_pct * 10) / 10}%` : '—'}
                  </span>
                  <span className="shrink-0 text-[9px] text-muted tabular-nums">
                    {d.ts != null ? new Date(d.ts).toLocaleString() : '—'}
                  </span>
                </li>
              ))}
            </ul>
          </InsightCardShell>
        </div>

        <SectionShell title="Platform pulse">
          <KpiStrip tiles={kpiTiles} />
        </SectionShell>

        <SectionShell title="Model intelligence">
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-[11px] text-muted">Models by run count (by provider)</div>
              {modelBarData.length ? (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={modelBarData} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" horizontal={false} />
                      <XAxis type="number" stroke="#64748b" tick={{ fontSize: 10 }} />
                      <YAxis type="category" dataKey="name" width={120} stroke="#64748b" tick={{ fontSize: 9 }} />
                      <Tooltip
                        formatter={(value: number, _name, item) => [
                          `${value} runs · ${String(item?.payload?.provider || '')}`,
                          'executions',
                        ]}
                      />
                      <Bar dataKey="runs" radius={[0, 3, 3, 0]}>
                        {modelBarData.map((entry) => (
                          <Cell key={entry.name} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="text-sm text-muted">—</div>
              )}
            </div>
            <div>
              <div className="mb-2 text-[11px] text-muted">Cost vs latency (dot size = executions)</div>
              {scatterData.length ? (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                      <XAxis type="number" dataKey="x" name="avg ms" stroke="#64748b" tick={{ fontSize: 10 }} />
                      <YAxis type="number" dataKey="y" name="avg cost" stroke="#64748b" tick={{ fontSize: 10 }} />
                      <ZAxis type="number" dataKey="z" range={[40, 400]} name="executions" />
                      <Tooltip
                        cursor={{ strokeDasharray: '3 3' }}
                        formatter={(value: number, name: string) => [value, name]}
                        labelFormatter={(_l, payload) => String(payload?.[0]?.payload?.name || '')}
                      />
                      <Scatter data={scatterData} fill="#22d3ee" />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="text-sm text-muted">—</div>
              )}
            </div>
          </div>
        </SectionShell>

        <SectionShell title="Tool reliability">
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-[11px] text-muted">Tool ok% (agentsam_tool_call_log / MCP exec)</div>
              <div className="space-y-2">
                {toolRows.length ? (
                  toolRows.map((t) => (
                    <div key={t.tool_name} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="truncate font-mono text-[var(--text)]">{t.tool_name}</span>
                        <span className={`tabular-nums ${toneClass(t.tone).split(' ')[0]}`}>
                          {t.okRate == null ? '—' : `${t.okRate}%`}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-[var(--border-subtle)] overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            t.tone === 'healthy'
                              ? 'bg-emerald-500'
                              : t.tone === 'degraded'
                                ? 'bg-amber-500'
                                : t.tone === 'critical'
                                  ? 'bg-rose-500'
                                  : 'bg-slate-500'
                          }`}
                          style={{ width: `${Math.min(Math.max(t.okRate ?? 0, 0), 100)}%` }}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted">—</div>
                )}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[11px] text-muted">
                Chain breaks · agentsam_tool_chain · failed / timeout / cancelled
              </div>
              <div className="max-h-72 overflow-auto space-y-2">
                {chainBreakSummary.length ? (
                  chainBreakSummary.map((row) => (
                    <div
                      key={row.tool_name}
                      className="rounded border border-[var(--border-subtle)] px-2 py-1.5 text-[11px]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[var(--text)] truncate">{row.tool_name}</span>
                        <span className="text-rose-400 tabular-nums shrink-0">{row.count} errors</span>
                      </div>
                      <div className="text-[10px] text-muted truncate">
                        Last seen:{' '}
                        {row.lastSeen != null
                          ? new Date(row.lastSeen > 1e12 ? row.lastSeen : row.lastSeen * 1000).toLocaleString()
                          : '—'}
                      </div>
                      {row.lastError ? (
                        <div className="text-[10px] text-muted truncate">{row.lastError}</div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted">—</div>
                )}
              </div>
            </div>
          </div>
        </SectionShell>

        <SectionShell title="Routing intelligence">
          <div className="mb-2 text-[11px] text-muted">
            Thompson sampling confidence · success_alpha / (success_alpha + success_beta) · sorted by decayed_score
          </div>
          <div className="space-y-2">
            {routingArmBars.length ? (
              routingArmBars.map((arm) => (
                <div key={arm.id} className="rounded border border-[var(--border-subtle)] px-2 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px]">
                    <div className="font-mono text-[var(--text)]">{arm.model_key}</div>
                    <div className="text-muted">
                      {arm.task_type} · score {arm.decayed_score.toFixed(3)} · {arm.total_executions} exec
                    </div>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-[var(--border-subtle)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-cyan-500/80"
                      style={{
                        width: `${Math.min(Math.max((arm.confidence ?? 0) * 100, 0), 100)}%`,
                      }}
                    />
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted tabular-nums">
                    confidence {arm.confidence == null ? '—' : fmtPct(arm.confidence * 100)}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-muted">—</div>
            )}
          </div>
          <div className="mt-4 mb-2 text-[11px] text-muted">
            Failure categories · agentsam_reward_events (auto_error) · platform_request_error logs without moving α/β
          </div>
          <div className="max-h-[220px] overflow-auto">
            {failureBreakdownRows.length ? (
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="pb-1 pr-2">model</th>
                    <th className="pb-1 pr-2">category</th>
                    <th className="pb-1 pr-2">events</th>
                    <th className="pb-1">β skipped</th>
                  </tr>
                </thead>
                <tbody>
                  {failureBreakdownRows.map((r) => (
                    <tr
                      key={`${r.model_key}-${r.failure_category}`}
                      className="border-t border-[var(--border-subtle)]"
                    >
                      <td className="py-1 pr-2 font-mono text-[var(--text)]">{r.model_key}</td>
                      <td className="py-1 pr-2 text-muted">{r.failure_category}</td>
                      <td className="py-1 pr-2 tabular-nums">{r.event_count}</td>
                      <td className="py-1 tabular-nums text-muted">{r.bandit_skipped_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-sm text-muted">No categorized auto_error events in range.</div>
            )}
          </div>
        </SectionShell>
      </div>
    </div>
  );
};
