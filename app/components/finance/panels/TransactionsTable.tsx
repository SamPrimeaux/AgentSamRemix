// app/components/finance/panels/TransactionsTable.tsx
// Read-only finance_transactions list (CSV import via Import tab)

import React, { useState, useMemo } from 'react';
import { cn } from '../../../lib/utils';
import { Transaction } from '../types';
import { fmt as fmtConst } from '../constants';

interface Props {
  transactions: Transaction[];
  onRefresh: () => void;
}

export function TransactionsTable({ transactions }: Props) {
  const [search, setSearch] = useState('');
  const [dirFilter, setDirFilter] = useState<'all' | 'in' | 'out'>('all');

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      const matchDir = dirFilter === 'all' || t.direction === dirFilter;
      const matchSearch =
        !search ||
        t.description.toLowerCase().includes(search.toLowerCase()) ||
        (t.merchant ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (t.category_name ?? '').toLowerCase().includes(search.toLowerCase());
      return matchDir && matchSearch;
    });
  }, [transactions, search, dirFilter]);

  return (
    <div className="bg-[#0d2128] border border-white/[0.06] rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
        <input
          type="text"
          placeholder="Search transactions…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-white/[0.05] border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/50 focus:bg-white/[0.07] transition-colors"
        />
        <div className="flex rounded-lg overflow-hidden border border-white/10">
          {(['all', 'in', 'out'] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDirFilter(d)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors capitalize',
                dirFilter === d
                  ? 'bg-violet-600 text-white'
                  : 'bg-white/[0.04] text-slate-400 hover:text-white hover:bg-white/[0.07]',
              )}
            >
              {d === 'all' ? 'All' : d === 'in' ? '↑ In' : '↓ Out'}
            </button>
          ))}
        </div>
      </div>

      <p className="px-4 py-2 text-[11px] text-slate-500 border-b border-white/[0.04]">
        Canonical table: finance_transactions. Add rows via Import CSV tab only.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06]">
              {['Date', 'Description', 'Category', 'Source', 'Amount'].map((h) => (
                <th
                  key={h}
                  className="text-left text-[10px] uppercase tracking-wider text-slate-500 px-4 py-2.5 font-medium"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-slate-500 text-sm py-12">
                  No transactions found.
                </td>
              </tr>
            ) : (
              filtered.map((t) => (
                <tr key={String(t.id)} className="border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors">
                  <td className="px-4 py-2.5 text-slate-400 text-xs tabular-nums whitespace-nowrap">
                    {fmtConst.date(t.transaction_date)}
                  </td>
                  <td className="px-4 py-2.5 text-white max-w-[260px] truncate">
                    {t.description}
                    {t.merchant && (
                      <span className="text-slate-500 text-xs ml-1.5">· {t.merchant}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {t.category_name ? (
                      <span className="text-[11px] bg-white/[0.07] text-slate-300 rounded-full px-2.5 py-0.5">
                        {t.category_name}
                      </span>
                    ) : (
                      <span className="text-slate-600 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs capitalize">{t.source}</td>
                  <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">
                    <span
                      className={cn(
                        'font-semibold',
                        t.direction === 'in' ? 'text-emerald-400' : 'text-rose-400',
                      )}
                    >
                      {t.direction === 'in' ? '+' : '-'}
                      {fmtConst.usd(Math.abs(t.amount))}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2.5 text-[11px] text-slate-600 border-t border-white/[0.04]">
        {filtered.length} of {transactions.length} transactions
      </div>
    </div>
  );
}
