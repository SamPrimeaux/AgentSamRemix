import React, { useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { MonthlyPlRow } from '../types';
import { fmt } from '../constants';

/** Recharts SVG fills ignore bare CSS vars; resolve from :root at runtime. */
function usePlChartColors() {
  const [colors, setColors] = useState({ income: 'green', expenses: 'red', net: 'cyan' });

  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    const pick = (...names: string[]) => {
      for (const n of names) {
        const v = cs.getPropertyValue(n).trim();
        if (v) return v;
      }
      return '';
    };
    setColors({
      income: pick('--color-success-strong', '--solar-green', '--accent-green') || 'green',
      expenses: pick('--color-danger-strong', '--solar-red', '--accent-danger') || 'red',
      net: pick('--accent-secondary', '--solar-cyan') || 'cyan',
    });
  }, []);

  return colors;
}

interface Props {
  rows: MonthlyPlRow[];
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

export function MonthlyPlChart({ rows }: Props) {
  const plColors = usePlChartColors();

  const data = useMemo(() => {
    const list = Array.isArray(rows) ? rows : [];
    return list.map((r) => ({
      label: monthLabel(r.year, r.month),
      income: Number(r.total_income) || 0,
      expenses: Number(r.total_expenses) || 0,
      net: Number(r.net_cashflow) || 0,
    }));
  }, [rows]);

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--dashboard-border)] bg-[color:var(--dashboard-panel)] px-4 py-10 text-center text-sm text-[color:var(--dashboard-muted)]">
        No monthly summaries yet.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[color:var(--dashboard-border)] bg-[color:var(--dashboard-panel)] p-4">
      <h3 className="text-sm font-semibold text-[color:var(--dashboard-text)]">Monthly P&amp;L</h3>
      <p className="text-xs text-[color:var(--dashboard-muted)] mt-0.5 mb-4">financial_monthly_summaries (last 6 months)</p>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="color-mix(in srgb, var(--dashboard-border) 55%, transparent)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: 'var(--dashboard-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: 'var(--dashboard-muted)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmt.usd(Number(v), true)} width={52} />
          <Tooltip
            formatter={(v: number, name: string) => [fmt.usd(Number(v)), name]}
            contentStyle={{
              background: 'var(--dashboard-panel)',
              border: '1px solid var(--dashboard-border)',
              fontSize: 11,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: 'var(--dashboard-muted)' }} />
          <Bar dataKey="income" name="Income" fill={plColors.income} radius={[3, 3, 0, 0]} />
          <Bar dataKey="expenses" name="Expenses" fill={plColors.expenses} radius={[3, 3, 0, 0]} />
          <Line type="monotone" dataKey="net" name="Net" stroke={plColors.net} strokeWidth={2} dot={{ r: 3, fill: plColors.net }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
