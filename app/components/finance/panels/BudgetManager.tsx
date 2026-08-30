// app/components/finance/panels/BudgetManager.tsx

import React, { useState } from 'react';
import { cn } from '../../../lib/utils';
import { FinanceBudget } from '../types';
import { fmt, currentMonth } from '../constants';
import { createBudget } from '../hooks/useFinanceData';

interface Props {
  budgets: FinanceBudget[];
  onRefresh: () => void;
}

const BUDGET_TYPES = ['monthly', 'weekly', 'daily', 'total'] as const;

function BudgetRow({ b }: { b: FinanceBudget }) {
  const ratio = b.actual_usd / b.target_usd;
  const over = ratio > 1;
  const pct = Math.min(ratio * 100, 100);

  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors">
      {/* Name + type */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-white font-medium truncate">{b.budget_name}</span>
          {b.category_name && (
            <span className="text-[10px] text-slate-500 block truncate">{b.category_name}</span>
          )}
          <span className="text-[10px] bg-white/[0.07] text-slate-400 rounded px-1.5 py-0.5 capitalize shrink-0">
            {b.budget_type}
          </span>
        </div>
        {b.model_filter && (
          <span className="text-[11px] font-mono text-slate-500 mt-0.5 block">
            filter: {b.model_filter}
          </span>
        )}
      </div>

      {/* Progress */}
      <div className="w-40 shrink-0 space-y-1">
        <div className="flex justify-between text-[10px] text-slate-500">
          <span>{fmt.usd(b.actual_usd)}</span>
          <span className={over ? 'text-orange-400 font-semibold' : ''}>{fmt.usd(b.target_usd)}</span>
        </div>
        <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', over ? 'bg-orange-500' : 'bg-violet-500')}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className={cn('text-[10px] text-right', over ? 'text-orange-400' : 'text-slate-500')}>
          {fmt.pct(ratio * 100)} used
        </div>
      </div>

      {/* Period */}
      <div className="text-[11px] text-slate-500 shrink-0 w-16 text-right">
        {b.period}
      </div>
    </div>
  );
}

export function BudgetManager({ budgets, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    budget_name: '',
    budget_type: 'monthly' as typeof BUDGET_TYPES[number],
    target_usd: '',
    period: currentMonth(),
    model_filter: '',
    provider_filter: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleSave() {
    setSaving(true);
    setErr('');
    try {
      await createBudget({
        budget_name: form.budget_name,
        budget_type: form.budget_type,
        target_usd: parseFloat(form.target_usd),
        period: form.period,
        model_filter: form.model_filter || null,
        provider_filter: form.provider_filter || null,
        notes: form.notes || null,
      });
      setShowForm(false);
      setForm({ budget_name: '', budget_type: 'monthly', target_usd: '', period: currentMonth(), model_filter: '', provider_filter: '', notes: '' });
      onRefresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      {/* Budget list */}
      <div className="bg-[#0d2128] border border-white/[0.06] rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <h3 className="text-sm font-semibold text-white">Budgets</h3>
          <button
            onClick={() => setShowForm((p) => !p)}
            className="text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            + New Budget
          </button>
        </div>

        {budgets.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-sm">
            No budgets set. Create one to track spend limits.
          </div>
        ) : (
          budgets.map((b) => <BudgetRow key={b.id} b={b} />)
        )}
      </div>

      {/* Add form */}
      {showForm && (
        <div className="bg-[#0d2128] border border-white/[0.06] rounded-xl p-5 space-y-4">
          <h4 className="text-sm font-semibold text-white">New Budget</h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 uppercase tracking-wider">Name</label>
              <input
                value={form.budget_name}
                onChange={(e) => setForm((f) => ({ ...f, budget_name: e.target.value }))}
                placeholder="e.g. Monthly AI Cap"
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/50"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 uppercase tracking-wider">Type</label>
              <select
                value={form.budget_type}
                onChange={(e) => setForm((f) => ({ ...f, budget_type: e.target.value as any }))}
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
              >
                {BUDGET_TYPES.map((t) => (
                  <option key={t} value={t} className="bg-[#0d2128]">{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 uppercase tracking-wider">Target ($)</label>
              <input
                type="number"
                value={form.target_usd}
                onChange={(e) => setForm((f) => ({ ...f, target_usd: e.target.value }))}
                placeholder="30.00"
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/50"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 uppercase tracking-wider">Period</label>
              <input
                value={form.period}
                onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))}
                placeholder="YYYY-MM"
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/50"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 uppercase tracking-wider">Model filter (optional)</label>
              <input
                value={form.model_filter}
                onChange={(e) => setForm((f) => ({ ...f, model_filter: e.target.value }))}
                placeholder="%codex%"
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 font-mono focus:outline-none focus:border-violet-500/50"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 uppercase tracking-wider">Provider filter (optional)</label>
              <input
                value={form.provider_filter}
                onChange={(e) => setForm((f) => ({ ...f, provider_filter: e.target.value }))}
                placeholder="openai"
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 font-mono focus:outline-none focus:border-violet-500/50"
              />
            </div>
          </div>

          {err && <p className="text-xs text-rose-400">{err}</p>}

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !form.budget_name || !form.target_usd}
              className="px-4 py-2 text-sm font-medium bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-lg transition-colors"
            >
              {saving ? 'Saving…' : 'Save Budget'}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
