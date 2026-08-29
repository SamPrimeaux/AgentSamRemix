// KPI strip only (4 cards)

import React from 'react';
import {
  LineChart, Line, ResponsiveContainer, Tooltip,
} from 'recharts';
import { cn } from '../../../lib/utils';
import { FinanceSummary } from '../types';
import { fmt } from '../constants';

interface Props {
  summary: FinanceSummary;
  alertCount: number;
}

function Sparkline({ data }: { data: number[] }) {
  const points = data.map((v, i) => ({ i, v }));
  if (points.length < 2) return null;
  return (
    <ResponsiveContainer width="100%" height={36}>
      <LineChart data={points}>
        <Line
          type="monotone"
          dataKey="v"
          stroke="var(--accent-secondary, var(--solar-cyan))"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
        <Tooltip contentStyle={{ display: 'none' }} cursor={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  subColor?: string;
  sparkData?: number[];
  badge?: number;
}

function StatCard({ label, value, sub, subColor, sparkData, badge }: StatCardProps) {
  return (
    <div className="rounded-xl border border-[color:var(--dashboard-border)] bg-[color:var(--dashboard-panel)] p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[color:var(--dashboard-muted)]">{label}</span>
        {badge !== undefined && badge > 0 && (
          <span className="text-[10px] font-bold rounded-full px-2 py-0.5 border border-[color:var(--color-warning-strong)] text-[color:var(--color-warning-strong)]">
            {badge}
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold text-[color:var(--dashboard-text)] tracking-tight leading-none">{value}</div>
          {sub && (
            <div className={cn('text-xs mt-1 font-medium', subColor ?? 'text-[color:var(--dashboard-muted)]')}>{sub}</div>
          )}
        </div>
        {sparkData && sparkData.length > 1 && (
          <div className="w-24 shrink-0">
            <Sparkline data={sparkData} />
          </div>
        )}
      </div>
    </div>
  );
}

function plLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function SpendOverview({ summary, alertCount }: Props) {
  const aiSpark = Array.isArray(summary.daily_spend_sparkline)
    ? summary.daily_spend_sparkline.map((d) => d.cost_usd)
    : [];
  const plPeriod = summary.last_pl_period
    ? plLabel(summary.last_pl_period.year, summary.last_pl_period.month)
    : 'last closed month';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      <StatCard
        label="AI Spend MTD"
        value={fmt.usd(summary.ai_spend_mtd)}
        sub="agentsam_usage_rollups_daily"
        sparkData={aiSpark}
      />
      <StatCard
        label="Total Tokens MTD"
        value={fmt.num(summary.tokens_mtd)}
        sub="tokens_in + tokens_out"
        sparkData={aiSpark}
      />
      <StatCard
        label="MRR"
        value={fmt.usd(summary.mrr)}
        sub="client_revenue (current)"
      />
      <StatCard
        label="Net Cashflow"
        value={fmt.usd(summary.net_cashflow_last_month)}
        sub={plPeriod}
        subColor={
          summary.net_cashflow_last_month >= 0
            ? 'text-[color:var(--color-success-strong)]'
            : 'text-[color:var(--color-danger-strong)]'
        }
        badge={alertCount}
      />
    </div>
  );
}
