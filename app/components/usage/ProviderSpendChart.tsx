import React, { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCompactNumber } from '../settings/settingsUi';
import { providerSpendColor, providerSpendLabel } from './providerSpend';

type CostMetric = { tin: number; tout: number; cost_usd: number };
type CostBreakdown = CostMetric & { t: number; provider: string; model: string; n: number };
type CostResponse = {
  layer?: string;
  series?: Array<{ t: number; by_provider: Record<string, CostMetric> }>;
  breakdown?: CostBreakdown[];
};

function formatUsd(value: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}

function startOfMonthUnix() {
  const now = new Date();
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
}

function ChartTooltip({
  active,
  label,
  breakdown,
}: {
  active?: boolean;
  label?: number;
  breakdown: CostBreakdown[];
}) {
  if (!active || !label) return null;
  const rows = breakdown.filter((row) => Number(row.t) === Number(label));
  if (!rows.length) return null;
  return (
    <div className="max-w-[280px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-2 shadow-xl text-[11px]">
      <div className="mb-1.5 font-medium text-main">
        {new Date(Number(label) * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
      </div>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={`${row.provider}-${row.model}`} className="border-t border-[var(--border-subtle)] pt-1.5 first:border-0 first:pt-0">
            <div className="flex justify-between gap-3">
              <span className="text-main truncate">{row.model}</span>
              <span className="font-mono text-main shrink-0">{formatUsd(row.cost_usd)}</span>
            </div>
            <div className="text-muted">
              {providerSpendLabel(row.provider)} · {formatCompactNumber(row.tin)} in ·{' '}
              {formatCompactNumber(row.tout)} out
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProviderSpendChart() {
  const [data, setData] = useState<CostResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const query = new URLSearchParams({
          from: String(startOfMonthUnix()),
          to: String(Math.floor(Date.now() / 1000)),
          bucket: '1d',
        });
        const response = await fetch(`/api/analytics/costs?${query}`, {
          credentials: 'same-origin',
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Failed to load spend');
        setData(body);
      } catch (loadError) {
        if ((loadError as Error).name !== 'AbortError') {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load spend');
        }
      }
    };
    void load();
    return () => controller.abort();
  }, []);

  const { chartRows, providers, breakdown, total } = useMemo(() => {
    const series = Array.isArray(data?.series) ? data.series : [];
    const providerSet = new Set<string>();
    let totalCost = 0;
    const rows = series.map((point) => {
      const row: Record<string, number> = { t: Number(point.t) };
      for (const [provider, metric] of Object.entries(point.by_provider || {})) {
        providerSet.add(provider);
        const cost = Number(metric?.cost_usd || 0);
        row[provider] = cost;
        totalCost += cost;
      }
      return row;
    });
    return {
      chartRows: rows,
      providers: [...providerSet].sort(),
      breakdown: Array.isArray(data?.breakdown) ? data.breakdown : [],
      total: totalCost,
    };
  }, [data]);

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-medium text-main">Provider spend</div>
          <p className="mt-0.5 text-[10px] text-muted">Estimated usage this month</p>
        </div>
        <span className="font-mono text-[12px] text-main">{formatUsd(total)}</span>
      </div>

      {providers.length ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {providers.map((provider) => (
            <span key={provider} className="flex items-center gap-1.5 text-[10px] text-muted capitalize">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: providerSpendColor(provider) }} />
              {providerSpendLabel(provider)}
            </span>
          ))}
        </div>
      ) : null}

      {error ? <p className="text-[11px] text-[var(--color-danger)]">{error}</p> : null}
      {!error && !data ? <p className="text-[11px] text-muted">Loading provider spend…</p> : null}
      {data && !chartRows.length ? <p className="text-[11px] text-muted">No metered usage this month.</p> : null}
      {chartRows.length ? (
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartRows} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="t"
                tickFormatter={(value) => new Date(Number(value) * 1000).toLocaleDateString(undefined, { day: 'numeric' })}
                tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(value) => `$${Number(value).toFixed(0)}`}
                tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<ChartTooltip breakdown={breakdown} />} />
              {providers.map((provider, index) => (
                <Bar
                  key={provider}
                  dataKey={provider}
                  stackId="provider-spend"
                  fill={providerSpendColor(provider)}
                  radius={index === providers.length - 1 ? [2, 2, 0, 0] : undefined}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </section>
  );
}
