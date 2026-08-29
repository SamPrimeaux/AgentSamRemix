// Finance dashboard -- route: /dashboard/finance

import React, { useState, useCallback } from 'react';
import { cn } from '../../lib/utils';
import { TabId } from './types';
import { TAB_LABELS, SpendRange } from './constants';
import {
  useFinanceSummary,
  useSpendByDay,
  useFinanceBudgets,
  useTransactions,
  useFinanceProviders,
  useOverviewBundleSlice,
} from './hooks/useFinanceData';
import { SpendOverview } from './panels/SpendOverview';
import { SpendByDayChart } from './panels/SpendByDayChart';
import { ClientRevenueChart } from './panels/ClientRevenueChart';
import { MonthlyPlChart } from './panels/MonthlyPlChart';
import { TransactionsTable } from './panels/TransactionsTable';
import { CsvImportZone } from './panels/CsvImportZone';
import { BudgetManager } from './panels/BudgetManager';
import { ModelIntelligenceCard } from '../overview/panels/ModelIntelligenceCard';

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-white/[0.06]', className)} />;
}

export default function FinanceDashboard() {
  const [activeTab, setActiveTab] = useState<TabId>('transactions');
  const [spendRange, setSpendRange] = useState<SpendRange>('30d');

  const summary = useFinanceSummary();
  const providersRes = useFinanceProviders();
  const byDay = useSpendByDay(spendRange);
  const budgetsRes = useFinanceBudgets();
  const txnsRes = useTransactions();
  const bundleRes = useOverviewBundleSlice();

  const colorMap =
    providersRes.status === 'ok' ? providersRes.data.colorMap : {};

  const handleTxnRefresh = useCallback(() => {
    if (txnsRes.status === 'ok' || txnsRes.status === 'error') {
      (txnsRes as { refetch?: () => void }).refetch?.();
    }
  }, [txnsRes]);

  const handleBudgetRefresh = useCallback(() => {
    (budgetsRes as { refetch?: () => void }).refetch?.();
  }, [budgetsRes]);

  const refreshAll = useCallback(() => {
    (summary as { refetch?: () => void }).refetch?.();
    (providersRes as { refetch?: () => void }).refetch?.();
    (byDay as { refetch?: () => void }).refetch?.();
    (bundleRes as { refetch?: () => void }).refetch?.();
  }, [summary, providersRes, byDay, bundleRes]);

  const isLoading = summary.status === 'loading' || summary.status === 'idle';
  const bundle =
    bundleRes.status === 'ok' ? bundleRes.data : null;

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const rangeLabel = `${monthStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  return (
    <div className="min-h-full w-full bg-[color:var(--dashboard-canvas)] text-[color:var(--dashboard-text)]">
      <div className="flex items-center justify-between px-6 py-5 border-b border-[color:var(--dashboard-border)]">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Finance</h1>
          <p className="text-xs text-[color:var(--dashboard-muted)] mt-0.5">
            Usage rollups, client revenue, finance_transactions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-[color:var(--dashboard-border)] bg-[color:var(--dashboard-card)] px-3 py-1.5 text-xs text-[color:var(--dashboard-muted)]">
            <span>{rangeLabel}</span>
          </div>
          <button
            type="button"
            onClick={refreshAll}
            className="p-1.5 rounded-lg text-[color:var(--dashboard-muted)] hover:text-[color:var(--dashboard-text)] hover:bg-[color:var(--dashboard-card)] transition-colors"
            title="Refresh"
            aria-label="Refresh"
          >
            <span className="text-sm font-semibold">Refresh</span>
          </button>
        </div>
      </div>

      <div className="px-6 py-6 pb-24 space-y-6 max-w-[1600px]">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}
          </div>
        ) : summary.status === 'error' ? (
          <div className="rounded-xl border border-[color:var(--color-danger-strong)] px-5 py-4 text-sm text-[color:var(--color-danger-strong)]">
            Failed to load summary: {summary.message}
          </div>
        ) : (
          <SpendOverview summary={summary.data} alertCount={0} />
        )}

        {byDay.status === 'loading' || byDay.status === 'idle' ? (
          <Skeleton className="h-96" />
        ) : byDay.status === 'error' ? (
          <div className="text-[color:var(--color-danger-strong)] text-sm">{byDay.message}</div>
        ) : (
          <SpendByDayChart
            data={byDay.data}
            colorMap={colorMap}
            range={spendRange}
            onRangeChange={setSpendRange}
          />
        )}

        {bundleRes.status === 'loading' || bundleRes.status === 'idle' ? (
          <Skeleton className="h-80" />
        ) : (
          <ModelIntelligenceCard
            perfRows={bundle?.model_leaderboard}
            costLatency={bundle?.cost_latency}
            arms={bundle?.routing_arms}
            routingTimeseries={bundle?.routing_timeseries}
            providerColorMap={colorMap}
          />
        )}

        {summary.status === 'ok' && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ClientRevenueChart rows={summary.data.client_revenue} />
            <MonthlyPlChart rows={summary.data.monthly_pl} />
          </div>
        )}

        <div className="flex items-center gap-0 border-b border-[color:var(--dashboard-border)]">
          {(['transactions', 'budgets'] as TabId[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={cn(
                'relative px-4 py-2.5 text-sm font-medium transition-colors',
                activeTab === tab
                  ? 'text-[color:var(--dashboard-text)]'
                  : 'text-[color:var(--dashboard-muted)] hover:text-[color:var(--dashboard-text)]',
              )}
            >
              {TAB_LABELS[tab]}
              {activeTab === tab && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[color:var(--accent-secondary)] rounded-t-full" />
              )}
            </button>
          ))}
        </div>

        {activeTab === 'transactions' && (
          <div className="space-y-4">
            <CsvImportZone onSuccess={handleTxnRefresh} />
            {txnsRes.status === 'loading' || txnsRes.status === 'idle' ? (
              <Skeleton className="h-80" />
            ) : txnsRes.status === 'error' ? (
              <div className="text-[color:var(--color-danger-strong)] text-sm">{txnsRes.message}</div>
            ) : (
              <TransactionsTable
                transactions={txnsRes.data.transactions}
                onRefresh={handleTxnRefresh}
              />
            )}
          </div>
        )}

        {activeTab === 'budgets' && (
          budgetsRes.status === 'loading' || budgetsRes.status === 'idle' ? (
            <Skeleton className="h-64" />
          ) : budgetsRes.status === 'error' ? (
            <div className="text-[color:var(--color-danger-strong)] text-sm">{budgetsRes.message}</div>
          ) : (
            <BudgetManager budgets={budgetsRes.data.budgets} onRefresh={handleBudgetRefresh} />
          )
        )}
      </div>
    </div>
  );
}
