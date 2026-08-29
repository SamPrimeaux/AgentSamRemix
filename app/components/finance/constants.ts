// app/dashboard/components/finance/constants.ts

export const API = {
  summary:       '/api/finance/summary',
  spendByDay:    '/api/finance/spend-by-day',
  providers:     '/api/finance/providers',
  budgets:       '/api/finance/budgets',
  alerts:        '/api/finance/alerts',
  resolveAlert:  (id: number) => `/api/finance/alerts/${id}/resolve`,
  transactions:  '/api/finance/transactions',
  importCsv:     '/api/finance/import-csv',
  health:        '/api/finance/health',
  dashboardBundle: '/api/overview/dashboard-bundle',
} as const;

export type SpendRange = '7d' | '30d' | 'mtd';

export const TAB_LABELS: Record<string, string> = {
  transactions: 'Transactions',
  budgets: 'Budgets',
};

// Formatters (no color literals)
export const fmt = {
  usd: (n: number, compact = false): string => {
    if (compact && Math.abs(n) >= 1000) {
      return '$' + (n / 1000).toFixed(1) + 'k';
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  },
  num: (n: number): string =>
    new Intl.NumberFormat('en-US').format(Math.round(n)),
  pct: (n: number): string => `${Math.round(n)}%`,
  date: (iso: string): string =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  month: (yyyyMm: string): string => {
    const [y, m] = yyyyMm.split('-');
    return new Date(Number(y), Number(m) - 1).toLocaleDateString('en-US', {
      month: 'short', year: 'numeric',
    });
  },
};

export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
