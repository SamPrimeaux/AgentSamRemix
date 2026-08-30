// app/components/finance/hooks/useFinanceData.ts

import { useState, useEffect, useCallback } from 'react';
import {
  FinanceSummary,
  SpendByDayData,
  FinanceBudget,
  SpendAlert,
  Transaction,
} from '../types';
import { API, SpendRange } from '../constants';
import { buildProviderColorMap, FinanceProviderRow } from '../../../lib/providerColors';
import type { DashboardBundle } from '../../overview/types';
import { dashboardBundleUrl } from '../../overview/constants';

type FetchState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: T }
  | { status: 'error'; message: string };

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function asNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeFinanceSummary(raw: unknown): FinanceSummary {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  return {
    ai_spend_mtd: asNumber(r.ai_spend_mtd),
    tokens_mtd: asNumber(r.tokens_mtd),
    mrr: asNumber(r.mrr),
    net_cashflow_last_month: asNumber(r.net_cashflow_last_month),
    last_pl_period:
      r.last_pl_period && typeof r.last_pl_period === 'object'
        ? {
            year: asNumber((r.last_pl_period as Record<string, unknown>).year),
            month: asNumber((r.last_pl_period as Record<string, unknown>).month),
          }
        : null,
    monthly_pl: asArray<Record<string, unknown>>(r.monthly_pl).map((row) => ({
      year: asNumber(row.year),
      month: asNumber(row.month),
      total_income: asNumber(row.total_income),
      total_expenses: asNumber(row.total_expenses),
      net_cashflow: asNumber(row.net_cashflow),
    })),
    client_revenue: asArray<Record<string, unknown>>(r.client_revenue).map((row) => ({
      client_name: String(row.client_name ?? ''),
      monthly_recurring_revenue: asNumber(row.monthly_recurring_revenue),
      payment_status: String(row.payment_status ?? ''),
      onboarding_status: String(row.onboarding_status ?? ''),
    })),
    daily_spend_sparkline: asArray<Record<string, unknown>>(r.daily_spend_sparkline).map((row) => ({
      day: String(row.day ?? ''),
      cost_usd: asNumber(row.cost_usd),
    })),
  };
}

function normalizeBudgets(raw: unknown): { budgets: FinanceBudget[] } {
  const rows = asArray<Record<string, unknown>>((raw as Record<string, unknown>)?.budgets);
  return {
    budgets: rows.map((b) => ({
      id: b.id as number | string,
      tenant_id: String(b.tenant_id ?? ''),
      workspace_id: null,
      budget_name: String(b.category_name ?? `Category ${b.category_id ?? ''}`),
      budget_type: 'monthly',
      target_usd: asNumber(b.budget_cents) / 100,
      actual_usd: asNumber(b.actual_usd),
      period: String(b.month ?? ''),
      model_filter: null,
      provider_filter: null,
      notes: null,
      created_at: String(b.created_at ?? ''),
      category_id: b.category_id != null ? String(b.category_id) : null,
      category_name: b.category_name != null ? String(b.category_name) : null,
      category_color: b.category_color != null ? String(b.category_color) : null,
    })),
  };
}

function normalizeTransactions(raw: unknown): { transactions: Transaction[] } {
  const r = raw as Record<string, unknown>;
  const rows = asArray<Record<string, unknown>>(r?.transactions);
  return {
    transactions: rows.map((t) => ({
      id: t.id as number | string,
      tenant_id: String(t.tenant_id ?? ''),
      workspace_id: null,
      account_id: t.account_id ?? null,
      category_id: t.category_id ?? null,
      amount: asNumber(t.amount, asNumber(t.amount_cents) / 100),
      direction: (t.direction === 'in' ? 'in' : 'out') as 'in' | 'out',
      description: String(t.description ?? ''),
      merchant: t.merchant != null ? String(t.merchant) : null,
      transaction_date: String(t.transaction_date ?? t.date ?? ''),
      source: String(t.source ?? t.source_type ?? 'unknown'),
      category_name: t.category_name != null ? String(t.category_name) : undefined,
      account_name: t.account_name != null ? String(t.account_name) : undefined,
      source_upload_id: t.source_upload_id != null ? String(t.source_upload_id) : null,
    })),
  };
}

function useFetch<T>(
  url: string,
  deps: unknown[] = [],
  map?: (raw: unknown) => T,
): FetchState<T> & { refetch: () => void } {
  const [state, setState] = useState<FetchState<T>>({ status: 'idle' });
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetch(url, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json() as Promise<unknown>;
      })
      .then((raw) => {
        const data = map ? map(raw) : (raw as T);
        if (!cancelled) setState({ status: 'ok', data });
      })
      .catch((e: Error) => {
        if (!cancelled) setState({ status: 'error', message: e.message });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick, ...deps]);

  return { ...state, refetch };
}

export function useFinanceSummary() {
  return useFetch<FinanceSummary>(API.summary, [], normalizeFinanceSummary);
}

export function useSpendByDay(range: SpendRange = '30d') {
  return useFetch<SpendByDayData>(`${API.spendByDay}?range=${range}`, [range]);
}

export type FinanceProvidersState = {
  providers: FinanceProviderRow[];
  colorMap: Record<string, string>;
};

export function useFinanceProviders() {
  return useFetch<FinanceProvidersState>(API.providers, [], (raw) => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const providers = asArray<FinanceProviderRow>(r.providers);
    return { providers, colorMap: buildProviderColorMap(providers) };
  });
}

export function useOverviewBundleSlice() {
  return useFetch<DashboardBundle>(dashboardBundleUrl());
}

export function useFinanceBudgets() {
  return useFetch<{ budgets: FinanceBudget[] }>(API.budgets, [], normalizeBudgets);
}

export function useSpendAlerts() {
  return useFetch<{ alerts: SpendAlert[] }>(API.alerts);
}

export function useTransactions(limit = 200) {
  return useFetch<{ transactions: Transaction[] }>(
    `${API.transactions}?limit=${limit}`,
    [],
    normalizeTransactions,
  );
}

export async function resolveAlert(id: number): Promise<void> {
  const r = await fetch(API.resolveAlert(id), {
    method: 'POST',
    credentials: 'include',
  });
  if (!r.ok) throw new Error(`Resolve failed: ${r.status}`);
}

export async function createBudget(
  payload: Omit<FinanceBudget, 'id' | 'tenant_id' | 'workspace_id' | 'actual_usd' | 'created_at'>,
): Promise<void> {
  const r = await fetch(API.budgets, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      month: payload.period,
      category_id: payload.category_id ?? null,
      budget_cents: Math.round(payload.target_usd * 100),
    }),
  });
  if (!r.ok) throw new Error(`Create budget failed: ${r.status}`);
}

export async function importCsv(csv: string, filename: string): Promise<{ imported: number }> {
  const r = await fetch(API.importCsv, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ csv, filename }),
  });
  if (!r.ok) throw new Error(`Import failed: ${r.status}`);
  return r.json();
}
