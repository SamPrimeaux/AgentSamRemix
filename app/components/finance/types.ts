// app/dashboard/components/finance/types.ts
// Shapes aligned to canonical GET /api/finance/* responses

export type TabId = 'transactions' | 'budgets';

export type SpendRange = '7d' | '30d' | 'mtd';

// ── /api/finance/summary (canonical rollups + P&L) ───────────────────────────
export interface FinanceSummary {
  ai_spend_mtd: number;
  tokens_mtd: number;
  mrr: number;
  net_cashflow_last_month: number;
  last_pl_period: { year: number; month: number } | null;
  monthly_pl: MonthlyPlRow[];
  client_revenue: ClientRevenueRow[];
  daily_spend_sparkline: DailySpendSpark[];
}

export interface MonthlyPlRow {
  year: number;
  month: number;
  total_income: number;
  total_expenses: number;
  net_cashflow: number;
}

export interface ClientRevenueRow {
  client_name: string;
  monthly_recurring_revenue: number;
  payment_status: string;
  onboarding_status: string;
}

export interface DailySpendSpark {
  day: string;
  cost_usd: number;
}

// ── /api/finance/spend-by-day ─────────────────────────────────────────────────
export interface SpendByDayRow {
  date: string;
  provider_slug: string;
  total_usd: number;
  request_count: number;
}

export interface SpendByDayDailyTotal {
  date: string;
  total_usd: number;
}

export interface SpendByDayData {
  rows: SpendByDayRow[];
  providers: string[];
  dates: string[];
  daily_totals?: SpendByDayDailyTotal[];
  provider_colors?: Record<string, string>;
}

// ── /api/finance/budgets ──────────────────────────────────────────────────────
export interface FinanceBudget {
  id: number | string;
  tenant_id: string;
  workspace_id: string | null;
  budget_name: string;
  budget_type: 'monthly' | 'weekly' | 'daily' | 'total';
  target_usd: number;
  actual_usd: number;
  period: string;
  model_filter: string | null;
  provider_filter: string | null;
  notes: string | null;
  created_at: string;
  category_id?: string | null;
  category_name?: string | null;
  category_color?: string | null;
}

// ── /api/finance/alerts ───────────────────────────────────────────────────────
export interface SpendAlert {
  id: number;
  tenant_id: string;
  workspace_id: string | null;
  alert_type: string;
  provider_slug: string | null;
  threshold_usd: number;
  actual_usd: number;
  period: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  resolved: 0 | 1;
  resolved_at: string | null;
  created_at: string;
}

// ── /api/finance/transactions (finance_transactions) ──────────────────────────
export interface Transaction {
  id: number | string;
  tenant_id: string;
  workspace_id: string | null;
  account_id: number | string | null;
  category_id: number | string | null;
  amount: number;
  direction: 'in' | 'out';
  description: string;
  merchant: string | null;
  transaction_date: string;
  source: string;
  category_name?: string;
  account_name?: string;
  source_upload_id?: string | null;
}

export interface DateRange {
  from: string;
  to: string;
}
