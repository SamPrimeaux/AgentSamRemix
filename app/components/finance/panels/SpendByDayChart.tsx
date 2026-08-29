import React, { useEffect, useMemo, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { SpendByDayData } from '../types';
import { fmt } from '../constants';
import type { SpendRange } from '../constants';
import { isBlockedProviderKey, lookupProviderColor, normalizeProviderKey } from '../../../lib/providerColors';

interface Props {
  data: SpendByDayData;
  colorMap: Record<string, string>;
  range: SpendRange;
  onRangeChange: (r: SpendRange) => void;
}

const RANGE_OPTIONS: { id: SpendRange; label: string }[] = [
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: 'mtd', label: 'MTD' },
];

const TOTAL_SERIES_KEY = '_total';

function daysForRange(range: SpendRange): number {
  if (range === '7d') return 7;
  if (range === 'mtd') return new Date().getDate();
  return 30;
}

function mergeColorMaps(a: Record<string, string>, b: Record<string, string>): Record<string, string> {
  return { ...a, ...b };
}

function useAccentColor(): string {
  const [color, setColor] = useState('cyan');
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = cs.getPropertyValue('--accent-secondary').trim() || cs.getPropertyValue('--solar-cyan').trim();
    if (v) setColor(v);
  }, []);
  return color;
}

const CustomTooltip = ({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  const items = Array.isArray(payload) ? payload : [];
  const total = items.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="rounded-xl border border-[color:var(--dashboard-border)] bg-[color:var(--dashboard-panel)] px-4 py-3 text-xs shadow-lg min-w-[160px]">
      <div className="text-[color:var(--dashboard-muted)] mb-2 font-medium">{fmt.date(String(label ?? ''))}</div>
      {[...items].reverse().map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 py-0.5">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
            <span className="text-[color:var(--dashboard-text)] capitalize">
              {p.dataKey === TOTAL_SERIES_KEY ? 'Total' : p.dataKey}
            </span>
          </div>
          <span className="font-semibold text-[color:var(--dashboard-text)]">{fmt.usd(p.value)}</span>
        </div>
      ))}
      <div className="border-t border-[color:var(--dashboard-border)] mt-2 pt-2 flex justify-between">
        <span className="text-[color:var(--dashboard-muted)]">Total</span>
        <span className="font-bold text-[color:var(--dashboard-text)]">{fmt.usd(total)}</span>
      </div>
    </div>
  );
};

export function SpendByDayChart({ data, colorMap, range, onRangeChange }: Props) {
  const accent = useAccentColor();
  const effectiveColors = useMemo(
    () => mergeColorMaps(colorMap, data?.provider_colors ?? {}),
    [colorMap, data?.provider_colors],
  );

  const { chartData, providers, mode } = useMemo(() => {
    const dateMap: Record<string, Record<string, number>> = {};
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const providerSet = new Set<string>();

    rows.forEach((r) => {
      const slug = normalizeProviderKey(String(r.provider_slug ?? ''));
      if (!slug || isBlockedProviderKey(slug)) return;
      const color = lookupProviderColor(effectiveColors, slug);
      if (!color) return;
      providerSet.add(slug);
      if (!dateMap[r.date]) dateMap[r.date] = {};
      dateMap[r.date][slug] = (dateMap[r.date][slug] ?? 0) + r.total_usd;
    });

    const providerList = [...providerSet];
    const dayCount = daysForRange(range);
    const chartData: Array<Record<string, unknown>> = [];

    if (providerList.length > 0) {
      for (let i = dayCount - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const row: Record<string, unknown> = { date: key };
        providerList.forEach((p) => { row[p] = dateMap[key]?.[p] ?? 0; });
        chartData.push(row);
      }
      return { chartData, providers: providerList, mode: 'providers' as const };
    }

    const totals = Array.isArray(data?.daily_totals) ? data.daily_totals : [];
    const totalsByDate: Record<string, number> = {};
    totals.forEach((t) => {
      if (t.date) totalsByDate[t.date] = Number(t.total_usd) || 0;
    });

    for (let i = dayCount - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      chartData.push({
        date: key,
        [TOTAL_SERIES_KEY]: totalsByDate[key] ?? 0,
      });
    }

    const hasTotal = chartData.some((row) => Number(row[TOTAL_SERIES_KEY]) > 0);
    return {
      chartData,
      providers: hasTotal ? [TOTAL_SERIES_KEY] : [],
      mode: 'total' as const,
    };
  }, [data, effectiveColors, range]);

  const colorForSeries = (key: string) => {
    if (key === TOTAL_SERIES_KEY) return accent;
    return lookupProviderColor(effectiveColors, key) ?? accent;
  };

  return (
    <div className="rounded-xl border border-[color:var(--dashboard-border)] bg-[color:var(--dashboard-panel)] p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-[color:var(--dashboard-text)]">AI Spend Over Time</h3>
          <p className="text-xs text-[color:var(--dashboard-muted)] mt-0.5">
            agentsam_usage_rollups_daily by provider
            {mode === 'total' ? ' (daily total; provider breakdown repairing)' : ''}
          </p>
        </div>
        <div className="flex rounded-lg overflow-hidden border border-[color:var(--dashboard-border)]">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onRangeChange(opt.id)}
              className={
                range === opt.id
                  ? 'px-3 py-1.5 text-xs font-semibold bg-[color:var(--accent-secondary)] text-[color:var(--dashboard-canvas)]'
                  : 'px-3 py-1.5 text-xs font-medium text-[color:var(--dashboard-muted)] hover:text-[color:var(--dashboard-text)]'
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {providers.length === 0 ? (
        <p className="text-sm text-[color:var(--dashboard-muted)] py-16 text-center">No spend data for this range.</p>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              {providers.map((p) => {
                const c = colorForSeries(p);
                return (
                  <linearGradient key={p} id={`grad-${p}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={c} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={c} stopOpacity={0.03} />
                  </linearGradient>
                );
              })}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="color-mix(in srgb, var(--dashboard-border) 55%, transparent)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(v: string) => v.slice(5)}
              tick={{ fill: 'var(--dashboard-muted)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={(v: number) => fmt.usd(v, true)}
              tick={{ fill: 'var(--dashboard-muted)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: '11px', color: 'var(--dashboard-muted)', paddingTop: '12px' }}
              formatter={(v: string) => (v === TOTAL_SERIES_KEY ? 'Total' : v.charAt(0).toUpperCase() + v.slice(1))}
            />
            {providers.map((p) => {
              const stroke = colorForSeries(p);
              return (
                <Area
                  key={p}
                  type="monotone"
                  dataKey={p}
                  stackId={mode === 'providers' ? '1' : undefined}
                  stroke={stroke}
                  fill={`url(#grad-${p})`}
                  strokeWidth={1.5}
                  dot={false}
                />
              );
            })}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
