/**
 * Home AI spend card — large donut + 2×2 KPI grid (~500×300).
 * Data from /api/finance/spend-by-model (no separate KPI fetch).
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import './AISpendDonut.css';

type SpendSlice = {
  key: string;
  cost_usd: number;
  request_count: number;
  pct: number;
};

type SpendBreakdown = {
  period?: string;
  month_start?: string;
  total_usd: number;
  request_count: number;
  daily_avg: number;
  peak_day: { day: string; cost_usd: number } | null;
  models: SpendSlice[];
  providers: SpendSlice[];
  projects: SpendSlice[];
};

type TabId = 'providers' | 'models' | 'projects';

const GAP = 2;
const R = 78;
const STROKE = 18;
const CX = 100;
const CY = 100;
const VIEW = 200;

const PALETTE = [
  '#e8825a',
  '#5ab4e8',
  '#5ae8a0',
  '#c45ae8',
  '#e8d45a',
  '#5ae8d4',
  '#e87a9a',
  '#8aa4ff',
  '#888888',
];

function colorForKey(key: string, index: number): string {
  if (index < PALETTE.length - 1) return PALETTE[index];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 48% 58%)`;
}

function prettyLabel(key: string): string {
  const k = String(key || '').trim();
  if (!k) return 'Unknown';
  if (k.startsWith('@cf/')) {
    const parts = k.split('/');
    return parts[parts.length - 1] || k;
  }
  return k
    .replace(/^models\//, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function polarToXY(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function buildArcs(data: { pct: number; color: string; label: string; value: number; key: string }[]) {
  const totalPct = data.reduce((s, d) => s + Math.max(d.pct, 0.01), 0) || 1;
  const gaps = data.length * GAP;
  const available = 360 - gaps;
  let cursor = 0;
  return data.map((d) => {
    const sweep = (Math.max(d.pct, 0.01) / totalPct) * available;
    const start = cursor;
    cursor += sweep + GAP;
    return { ...d, start, sweep };
  });
}

function fmtUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);
}

function monthLabel(monthStart?: string): string {
  const d = monthStart ? new Date(`${monthStart}T12:00:00`) : new Date();
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function peakDaySub(peak: SpendBreakdown['peak_day']): string {
  if (!peak?.day) return '—';
  const d = new Date(`${peak.day}T12:00:00`);
  if (Number.isNaN(d.getTime())) return peak.day;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function AISpendDonut() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>('models');
  const [active, setActive] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SpendBreakdown | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 60);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/finance/spend-by-model', { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as SpendBreakdown;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load spend');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const source = useMemo(() => {
    if (!data) return [] as SpendSlice[];
    if (tab === 'providers') return data.providers || [];
    if (tab === 'projects') return data.projects || [];
    return data.models || [];
  }, [data, tab]);

  const chartRows = useMemo(() => {
    const sorted = [...source].sort((a, b) => b.cost_usd - a.cost_usd);
    const top = sorted.slice(0, 6);
    const rest = sorted.slice(6);
    const restSum = rest.reduce((s, r) => s + r.cost_usd, 0);
    const rows = [...top];
    if (restSum > 0) {
      rows.push({
        key: '__other__',
        cost_usd: restSum,
        request_count: rest.reduce((s, r) => s + r.request_count, 0),
        pct: 0,
      });
    }
    const sum = rows.reduce((s, r) => s + r.cost_usd, 0) || 1;
    return rows.map((r, i) => ({
      label: r.key === '__other__' ? 'Misc / Other' : prettyLabel(r.key),
      value: r.cost_usd,
      pct: Math.round((r.cost_usd / sum) * 1000) / 10,
      color: colorForKey(r.key, i),
      key: r.key,
    }));
  }, [source]);

  const arcs = useMemo(() => buildArcs(chartRows), [chartRows]);
  const hovered = active != null ? chartRows[active] : null;
  const total = data?.total_usd ?? chartRows.reduce((s, r) => s + r.value, 0);

  const kpis = [
    {
      id: 'mtd',
      label: 'MTD spend',
      value: fmtUsd(total),
      sub: monthLabel(data?.month_start),
      accent: '#e8825a',
    },
    {
      id: 'peak',
      label: 'Peak day',
      value: data?.peak_day ? fmtUsd(data.peak_day.cost_usd) : '—',
      sub: peakDaySub(data?.peak_day ?? null),
      accent: '#e87a9a',
    },
    {
      id: 'avg',
      label: 'Daily avg',
      value: fmtUsd(data?.daily_avg || 0),
      sub: 'per active day',
      accent: '#5ab4e8',
    },
    {
      id: 'requests',
      label: 'AI requests',
      value: (data?.request_count || 0).toLocaleString('en-US'),
      sub: 'this month',
      accent: '#5ae8a0',
    },
  ] as const;

  return (
    <section
      className={`iam-ai-spend${mounted ? ' is-mounted' : ''}`}
      aria-labelledby="iam-ai-spend-title"
    >
      <div className="iam-ai-spend__card">
        <header className="iam-ai-spend__head">
          <div>
            <p className="iam-ai-spend__eyebrow" id="iam-ai-spend-title">
              AI Spend
            </p>
            <h3 className="iam-ai-spend__title">{monthLabel(data?.month_start)}</h3>
          </div>
          <span className="iam-ai-spend__badge">MTD</span>
        </header>

        <div className="iam-ai-spend__tabs" role="tablist" aria-label="Spend breakdown">
          {(
            [
              ['providers', 'Providers'],
              ['models', 'Models'],
              ['projects', 'Projects'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`iam-ai-spend__tab${tab === id ? ' is-active' : ''}`}
              onClick={() => {
                setTab(id);
                setActive(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="iam-ai-spend__state">Loading spend…</div>
        ) : error ? (
          <div className="iam-ai-spend__state iam-ai-spend__state--error">{error}</div>
        ) : tab === 'projects' ? (
          <div className="iam-ai-spend__state">
            Project attribution lands with model attribution on the tool ledger. Use Models / Providers for accurate MTD now.
          </div>
        ) : chartRows.length === 0 || total <= 0 ? (
          <div className="iam-ai-spend__state">No billable AI spend this month yet.</div>
        ) : (
          <div className="iam-ai-spend__body">
            <div className="iam-ai-spend__chart">
              <svg
                className="iam-ai-spend__svg"
                viewBox={`0 0 ${VIEW} ${VIEW}`}
                role="img"
                aria-label={`Total AI spend ${fmtUsd(total)}`}
              >
                {arcs.map((arc, i) => {
                  const a1 = polarToXY(CX, CY, R, arc.start);
                  const a2 = polarToXY(CX, CY, R, arc.start + arc.sweep);
                  const large = arc.sweep > 180 ? 1 : 0;
                  const path = `M ${a1.x} ${a1.y} A ${R} ${R} 0 ${large} 1 ${a2.x} ${a2.y}`;
                  const isActive = active === i;
                  return (
                    <path
                      key={arc.key}
                      d={path}
                      fill="none"
                      stroke={arc.color}
                      strokeWidth={isActive ? STROKE + 5 : STROKE}
                      strokeLinecap="butt"
                      className={`iam-ai-spend__arc${isActive ? ' is-active' : ''}`}
                      style={{ '--arc-color': arc.color } as CSSProperties}
                      onMouseEnter={() => setActive(i)}
                      onMouseLeave={() => setActive(null)}
                      onFocus={() => setActive(i)}
                      onBlur={() => setActive(null)}
                      tabIndex={0}
                    />
                  );
                })}
                <text
                  x={CX}
                  y={CY - 6}
                  textAnchor="middle"
                  className="iam-ai-spend__center-main"
                  fill={hovered ? hovered.color : 'currentColor'}
                  fontSize={hovered ? 11 : 18}
                >
                  {hovered ? hovered.label.split(' ')[0] : fmtUsd(total)}
                </text>
                <text x={CX} y={CY + 14} textAnchor="middle" className="iam-ai-spend__center-sub">
                  {hovered ? `${fmtUsd(hovered.value)} · ${hovered.pct}%` : 'TOTAL'}
                </text>
              </svg>
            </div>

            <div className="iam-ai-spend__kpi-grid" aria-label="Spend KPIs">
              {kpis.map((k) => (
                <div
                  key={k.id}
                  className="iam-ai-spend__kpi"
                  style={{ '--kpi-accent': k.accent } as CSSProperties}
                >
                  <div className="iam-ai-spend__kpi-label">{k.label}</div>
                  <div className="iam-ai-spend__kpi-value">{k.value}</div>
                  <div className="iam-ai-spend__kpi-sub">{k.sub}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          className="iam-ai-spend__link"
          onClick={() => navigate('/dashboard/finance')}
        >
          Open finance
        </button>
      </div>
    </section>
  );
}
