/**
 * CostKpiTiles — expandable AI spend KPI tiles for Dashboard Home.
 * Fetches from /api/finance/spend-by-day and renders 4 tiles:
 *   MTD Spend · Peak Day · Daily Avg · Token Split
 * Clicking any tile expands inline to show token input/output breakdown.
 */
import { useCallback, useEffect, useState } from 'react';
import './CostKpiTiles.css';

type RollupRow = {
  date: string;
  total_usd: number;
};

type ProviderRow = {
  date: string;
  provider_slug: string;
  total_usd: number;
  request_count: number;
};

type SpendData = {
  rows: ProviderRow[];
  daily_totals: RollupRow[];
};

async function fetchSpendData(): Promise<SpendData | null> {
  try {
    const r = await fetch('/api/finance/spend-by-day?range=mtd', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

function fmt(n: number) {
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function fmtK(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#c98c5a',
  openai: '#10b981',
  deepseek: '#6366f1',
  google: '#3b82f6',
  cloudflare_workers_ai: '#f59e0b',
};

function providerColor(slug: string) {
  return PROVIDER_COLORS[slug] || '#64748b';
}

type TileId = 'mtd' | 'peak' | 'avg' | 'tokens';

type TileProps = {
  id: TileId;
  label: string;
  value: string;
  sub: string;
  accent: string;
  alert?: boolean;
  expanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
};

function KpiTile({ label, value, sub, accent, alert, expanded, onToggle, children }: TileProps) {
  return (
    <button
      type="button"
      className={`cost-kpi-tile${expanded ? ' cost-kpi-tile--expanded' : ''}${alert ? ' cost-kpi-tile--alert' : ''}`}
      style={{ '--kpi-accent': accent } as React.CSSProperties}
      onClick={onToggle}
      aria-expanded={expanded}
    >
      <div className="cost-kpi-tile__header">
        <span className="cost-kpi-tile__label">{label}</span>
        <span className="cost-kpi-tile__chevron">{expanded ? '−' : '+'}</span>
      </div>
      <div className="cost-kpi-tile__value">{value}</div>
      <div className="cost-kpi-tile__sub">{sub}</div>
      {expanded && children ? (
        <div className="cost-kpi-tile__detail" onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      ) : null}
    </button>
  );
}

function MiniBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="cost-kpi-minibar">
      <div className="cost-kpi-minibar__label">{label}</div>
      <div className="cost-kpi-minibar__track">
        <div className="cost-kpi-minibar__fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="cost-kpi-minibar__val">{fmt(value)}</div>
    </div>
  );
}

export function CostKpiTiles() {
  const [data, setData] = useState<SpendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<TileId | null>(null);

  useEffect(() => {
    fetchSpendData().then((d) => {
      setData(d);
      setLoading(false);
    });
  }, []);

  const toggle = useCallback((id: TileId) => {
    setExpanded((prev) => (prev === id ? null : id));
  }, []);

  if (loading) return <div className="cost-kpi-loading">Loading spend data…</div>;
  if (!data?.daily_totals?.length) return null;

  const totals = data.daily_totals;
  const mtd = totals.reduce((s, r) => s + r.total_usd, 0);
  const peak = totals.reduce((best, r) => (r.total_usd > best.total_usd ? r : best), totals[0]);
  const avg = mtd / totals.length;

  // Provider breakdown for expanded views
  const providerTotals: Record<string, number> = {};
  for (const row of data.rows || []) {
    providerTotals[row.provider_slug] = (providerTotals[row.provider_slug] || 0) + row.total_usd;
  }
  const providerEntries = Object.entries(providerTotals)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);
  const maxProvider = providerEntries[0]?.[1] || 1;

  // Token split: approximate from provider costs
  // Real token counts would come from agentsam_usage_rollups_daily
  const totalRequests = data.rows.reduce((s, r) => s + (r.request_count || 0), 0);

  // Daily sparkline for MTD tile
  const maxDay = Math.max(...totals.map((r) => r.total_usd), 0.001);

  return (
    <div className="cost-kpi-grid">
      {/* MTD Spend */}
      <KpiTile
        id="mtd"
        label="MTD Spend"
        value={fmt(mtd)}
        sub={`${totals.length} days tracked`}
        accent="#f97316"
        alert={mtd > 10}
        expanded={expanded === 'mtd'}
        onToggle={() => toggle('mtd')}
      >
        <p className="cost-kpi-tile__detail-head">Daily breakdown</p>
        <div className="cost-kpi-spark">
          {totals.map((r) => {
            const h = Math.max(3, (r.total_usd / maxDay) * 36);
            const isPeak = r.date === peak.date;
            return (
              <div key={r.date} className="cost-kpi-spark__col" title={`${r.date}: ${fmt(r.total_usd)}`}>
                <div
                  className="cost-kpi-spark__bar"
                  style={{
                    height: h,
                    background: isPeak ? '#f97316' : 'var(--kpi-accent)',
                    opacity: isPeak ? 1 : 0.65,
                  }}
                />
                <span className="cost-kpi-spark__label">
                  {new Date(r.date).getDate()}
                </span>
              </div>
            );
          })}
        </div>
        <div className="cost-kpi-tile__detail-row">
          <span>Total</span>
          <strong>{fmt(mtd)}</strong>
        </div>
        <div className="cost-kpi-tile__detail-row">
          <span>Requests</span>
          <strong>{totalRequests}</strong>
        </div>
      </KpiTile>

      {/* Peak Day */}
      <KpiTile
        id="peak"
        label="Peak Day"
        value={fmt(peak.total_usd)}
        sub={peak.date ? new Date(peak.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
        accent="#ec4899"
        alert
        expanded={expanded === 'peak'}
        onToggle={() => toggle('peak')}
      >
        <p className="cost-kpi-tile__detail-head">By provider on peak day</p>
        {data.rows
          .filter((r) => r.date === peak.date && r.total_usd > 0)
          .sort((a, b) => b.total_usd - a.total_usd)
          .map((r) => (
            <MiniBar
              key={r.provider_slug}
              label={r.provider_slug}
              value={r.total_usd}
              max={peak.total_usd}
              color={providerColor(r.provider_slug)}
            />
          ))}
        <div className="cost-kpi-tile__detail-row" style={{ marginTop: 8 }}>
          <span>Peak total</span>
          <strong style={{ color: '#ec4899' }}>{fmt(peak.total_usd)}</strong>
        </div>
      </KpiTile>

      {/* Daily Avg */}
      <KpiTile
        id="avg"
        label="Daily Avg"
        value={fmt(avg)}
        sub="per active day"
        accent="#3b82f6"
        expanded={expanded === 'avg'}
        onToggle={() => toggle('avg')}
      >
        <p className="cost-kpi-tile__detail-head">Provider split (MTD)</p>
        {providerEntries.map(([slug, val]) => (
          <MiniBar
            key={slug}
            label={slug}
            value={val}
            max={maxProvider}
            color={providerColor(slug)}
          />
        ))}
        <div className="cost-kpi-tile__detail-row" style={{ marginTop: 8 }}>
          <span>Projected 30d</span>
          <strong>{fmt(avg * 30)}</strong>
        </div>
      </KpiTile>

      {/* Token split */}
      <KpiTile
        id="tokens"
        label="AI Requests"
        value={String(totalRequests)}
        sub="this month"
        accent="#10b981"
        expanded={expanded === 'tokens'}
        onToggle={() => toggle('tokens')}
      >
        <p className="cost-kpi-tile__detail-head">Requests by provider</p>
        {(() => {
          const reqByProvider: Record<string, number> = {};
          for (const row of data.rows) {
            reqByProvider[row.provider_slug] = (reqByProvider[row.provider_slug] || 0) + (row.request_count || 0);
          }
          const entries = Object.entries(reqByProvider).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
          const maxReq = entries[0]?.[1] || 1;
          return entries.map(([slug, count]) => (
            <MiniBar key={slug} label={slug} value={count} max={maxReq} color={providerColor(slug)} />
          ));
        })()}
        <div className="cost-kpi-tile__detail-row" style={{ marginTop: 8 }}>
          <span>Cost/request avg</span>
          <strong>{totalRequests > 0 ? fmt(mtd / totalRequests) : '—'}</strong>
        </div>
      </KpiTile>
    </div>
  );
}

export default CostKpiTiles;
