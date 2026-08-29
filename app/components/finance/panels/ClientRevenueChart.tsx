import React, { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import { ClientRevenueRow } from '../types';
import { fmt } from '../constants';

const BAR_FILL = 'var(--accent-secondary, var(--solar-cyan))';

interface Props {
  rows: ClientRevenueRow[];
}

export function ClientRevenueChart({ rows }: Props) {
  const data = useMemo(() => {
    const list = Array.isArray(rows) ? rows : [];
    return [...list]
      .filter((r) => Number(r.monthly_recurring_revenue) > 0)
      .sort((a, b) => b.monthly_recurring_revenue - a.monthly_recurring_revenue)
      .map((r) => ({
        name: r.client_name || 'Client',
        mrr: Number(r.monthly_recurring_revenue) || 0,
      }));
  }, [rows]);

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--dashboard-border)] bg-[color:var(--dashboard-panel)] px-4 py-10 text-center text-sm text-[color:var(--dashboard-muted)]">
        No client revenue rows.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[color:var(--dashboard-border)] bg-[color:var(--dashboard-panel)] p-4">
      <h3 className="text-sm font-semibold text-[color:var(--dashboard-text)]">Client Revenue</h3>
      <p className="text-xs text-[color:var(--dashboard-muted)] mt-0.5 mb-4">MRR by client (desc)</p>
      <ResponsiveContainer width="100%" height={Math.max(200, data.length * 36)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 80, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="color-mix(in srgb, var(--dashboard-border) 55%, transparent)" horizontal={false} />
          <XAxis type="number" tick={{ fill: 'var(--dashboard-muted)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmt.usd(Number(v), true)} />
          <YAxis type="category" dataKey="name" width={120} tick={{ fill: 'var(--dashboard-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(v: number) => [fmt.usd(Number(v)), 'MRR']}
            contentStyle={{
              background: 'var(--dashboard-panel)',
              border: '1px solid var(--dashboard-border)',
              fontSize: 11,
            }}
          />
          <Bar dataKey="mrr" radius={[0, 4, 4, 0]} barSize={18}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={BAR_FILL} />
            ))}
            <LabelList dataKey="mrr" position="right" formatter={(v: number) => fmt.usd(Number(v))} fill="var(--dashboard-text)" fontSize={10} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
