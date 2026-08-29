import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { SettingsPanelModel } from '../hooks/useSettingsData';
import { Toggle, formatPlanLabel, formatCompactNumber, relativeTime } from '../settingsUi';
import { ProviderSpendChart } from '../../usage/ProviderSpendChart';

export type PlanUsageSectionProps = { data: SettingsPanelModel };

function formatInvoiceWhen(ts: number | null | undefined) {
  if (ts == null || !Number.isFinite(Number(ts))) return '—';
  const n = Number(ts);
  const ms = n > 1e12 ? n : n * 1000;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function parseEligiblePlanIds(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x));
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p.map((x: unknown) => String(x)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function couponsForPlan(planId: string, coupons: any[] | undefined): any[] {
  if (!Array.isArray(coupons) || !planId) return [];
  const out: any[] = [];
  for (const c of coupons) {
    const ids = parseEligiblePlanIds(c?.eligible_plan_ids);
    if (ids.length === 0 || ids.includes(planId)) out.push(c);
  }
  return out;
}

function UsageProgressBar({
  label,
  value,
  max,
  rightLabel,
}: {
  label: string;
  value: number;
  max: number | null;
  rightLabel?: string;
}) {
  const pct =
    max != null && max > 0 ? Math.min(100, Math.round((value / max) * 100)) : value > 0 ? 8 : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-muted">{label}</span>
        <span className="text-main font-mono tabular-nums">
          {rightLabel ?? (max != null && max > 0 ? `${pct}%` : formatCompactNumber(value))}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--bg-app)] border border-[var(--border-subtle)] overflow-hidden">
        <div
          className="h-full rounded-full bg-[var(--solar-cyan)] transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function PlanUsageSection({ data }: PlanUsageSectionProps) {
  const u = data.usageData;
  const sub = data.activeSubscription;
  const subStatus = sub?.status != null ? String(sub.status).toLowerCase() : '';
  const paidActive =
    !!sub &&
    sub.plan_id &&
    String(sub.plan_id) !== 'free' &&
    ['active', 'trialing', 'past_due'].includes(subStatus);
  const highlightPlanId = paidActive ? String(sub.plan_id) : 'free';

  const [showBreakdown, setShowBreakdown] = useState(true);
  const [showActivity, setShowActivity] = useState(false);
  const [showPlans, setShowPlans] = useState(!paidActive);
  const [showInvoices, setShowInvoices] = useState(false);
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetSaveMsg, setBudgetSaveMsg] = useState<string | null>(null);

  const usageTotals = useMemo(() => {
    const summary = Array.isArray(u?.summary) ? u.summary : [];
    let costUsd = 0;
    let input = 0;
    let output = 0;
    let calls = 0;
    for (const r of summary) {
      costUsd += Number(r.cost_usd || 0);
      input += Number(r.input_tokens || 0);
      output += Number(r.output_tokens || 0);
      calls += Number(r.call_count || 0);
    }
    return { summary, costUsd, input, output, calls, tokens: input + output };
  }, [u]);

  const currentPlan = useMemo(() => {
    const plans = Array.isArray(data.billingPlans) ? data.billingPlans : [];
    return plans.find((p: any) => String(p.id) === highlightPlanId) ?? null;
  }, [data.billingPlans, highlightPlanId]);

  const monthlyTokenLimit =
    currentPlan?.monthly_token_limit != null ? Number(currentPlan.monthly_token_limit) : null;
  const budgetLimit = Number.parseFloat(String(data.budgetMonthlyLimit || '').trim());
  const budgetMax = Number.isFinite(budgetLimit) && budgetLimit > 0 ? budgetLimit : null;

  const saveBudgetLimit = async () => {
    setBudgetSaving(true);
    setBudgetSaveMsg(null);
    try {
      await data.patchProfile([
        {
          setting_key: 'budget.monthly_limit_usd',
          setting_value: String(data.budgetMonthlyLimit || '').trim(),
        },
      ]);
      setBudgetSaveMsg('Saved');
    } catch (e) {
      setBudgetSaveMsg(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBudgetSaving(false);
    }
  };

  const periodLabel = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const planDisplayName =
    currentPlan?.display_name != null
      ? String(currentPlan.display_name)
      : sub?.display_name != null
        ? String(sub.display_name)
        : formatPlanLabel(data.profilePlan);

  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <h2 className="text-[15px] font-semibold text-[var(--text-heading)] tracking-tight">
        Plan &amp; Usage
      </h2>

      {data.billingPlansError ? (
        <div className="text-[11px] text-[var(--color-danger)] rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-3 py-2">
          {data.billingPlansError}
        </div>
      ) : null}
      {data.usageError ? (
        <div className="text-[11px] text-[var(--color-danger)] rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-3 py-2">
          {data.usageError}
        </div>
      ) : null}

      {/* Current plan — Cursor-style hero card */}
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 space-y-3">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">
          Current plan
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[18px] font-semibold text-main leading-tight">
              {planDisplayName}
            </div>
            {currentPlan?.tagline ? (
              <p className="mt-1 text-[12px] text-muted max-w-md">
                {String(currentPlan.tagline)}
              </p>
            ) : null}
            <p className="mt-1 text-[11px] text-muted">
              Billing period: {periodLabel}
              {sub?.current_period_end
                ? ` · renews ${formatInvoiceWhen(Number(sub.current_period_end))}`
                : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            {paidActive ? (
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[11px] text-main hover:border-[var(--solar-cyan)]/40"
                onClick={() => void data.openBillingPortal()}
              >
                Manage
              </button>
            ) : null}
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[11px] text-muted hover:text-main"
              onClick={() => {
                setShowInvoices(true);
                void data.loadBillingInvoices();
              }}
            >
              Invoices
            </button>
          </div>
        </div>
      </section>

      {data.usageLoading && !u ? (
        <div className="text-[12px] text-muted">Loading usage…</div>
      ) : null}

      {u ? (
        <>
          <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 space-y-4">
            <div className="text-[12px] font-medium text-main">
              Included in {planDisplayName}
            </div>
            <UsageProgressBar
              label="Spend this month"
              value={usageTotals.costUsd}
              max={budgetMax}
              rightLabel={
                budgetMax != null
                  ? `$${usageTotals.costUsd.toFixed(2)} / $${budgetMax.toFixed(0)}`
                  : `$${usageTotals.costUsd.toFixed(2)}`
              }
            />
            {monthlyTokenLimit != null && monthlyTokenLimit > 0 ? (
              <UsageProgressBar
                label="Tokens this month"
                value={usageTotals.tokens}
                max={monthlyTokenLimit}
                rightLabel={`${formatCompactNumber(usageTotals.tokens)} / ${formatCompactNumber(monthlyTokenLimit)}`}
              />
            ) : null}
            <div className="flex flex-wrap gap-2 text-[10px] text-muted font-mono">
              <span>{formatCompactNumber(usageTotals.input)} input</span>
              <span>·</span>
              <span>{formatCompactNumber(usageTotals.output)} output</span>
              <span>·</span>
              <span>{usageTotals.calls.toLocaleString()} calls</span>
            </div>

            <button
              type="button"
              className="flex items-center gap-1.5 text-[11px] text-muted hover:text-main"
              onClick={() => setShowBreakdown((v) => !v)}
            >
              {showBreakdown ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Model breakdown ({usageTotals.summary.length})
            </button>

            {showBreakdown && usageTotals.summary.length > 0 ? (
              <div className="space-y-3 pt-1 border-t border-[var(--border-subtle)]">
                {usageTotals.summary.map((r: any, i: number) => {
                  const cost = Number(r.cost_usd || 0);
                  const share =
                    usageTotals.costUsd > 0 ? Math.round((cost / usageTotals.costUsd) * 100) : 0;
                  return (
                    <div key={`${r.model_used || i}`} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-main truncate font-medium">
                          {String(r.model_used || '—')}
                        </span>
                        <span className="text-muted font-mono shrink-0">
                          ${cost.toFixed(2)}
                        </span>
                      </div>
                      <div className="h-1 rounded-full bg-[var(--bg-app)] overflow-hidden">
                        <div
                          className="h-full bg-[var(--solar-cyan)]/70 rounded-full"
                          style={{ width: `${Math.max(share, cost > 0 ? 4 : 0)}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-muted">
                        {String(r.provider || '—')} · {formatCompactNumber(Number(r.input_tokens || 0))} in ·{' '}
                        {formatCompactNumber(Number(r.output_tokens || 0))} out
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>

          <ProviderSpendChart />

          <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 space-y-3">
            <div className="text-[12px] font-medium text-main">Monthly limit</div>
            <p className="text-[11px] text-muted leading-relaxed">
              Set a fixed USD cap for platform-metered usage. When hard stop is on, agent runs block after the
              limit.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-[11px] min-w-[120px]">
                <span className="text-muted">Limit (USD)</span>
                <input
                  value={data.budgetMonthlyLimit}
                  onChange={(e) => {
                    data.setBudgetMonthlyLimit(e.target.value);
                    setBudgetSaveMsg(null);
                  }}
                  className="px-3 py-2 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[12px] font-mono w-28"
                  inputMode="decimal"
                  placeholder="300"
                />
              </label>
              <button
                type="button"
                disabled={budgetSaving}
                onClick={() => void saveBudgetLimit()}
                className="px-3 py-2 rounded-lg bg-[var(--solar-cyan)]/20 text-[var(--solar-cyan)] border border-[var(--solar-cyan)]/40 text-[11px] font-semibold hover:bg-[var(--solar-cyan)]/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {budgetSaving ? 'Saving…' : 'Save'}
              </button>
              <div className="flex items-center gap-2 pb-1">
                <span className="text-[11px] text-muted">Hard stop</span>
                <Toggle
                  on={data.budgetHardStop}
                  onChange={(v) => {
                    data.setBudgetHardStop(v);
                    void data
                      .patchProfile([
                        { setting_key: 'budget.hard_stop', setting_value: v ? 'true' : 'false' },
                      ])
                      .catch(() => data.setBudgetHardStop(!v));
                  }}
                />
              </div>
            </div>
            {budgetSaveMsg ? (
              <p
                className={`text-[10px] ${
                  budgetSaveMsg === 'Saved'
                    ? 'text-[var(--solar-cyan)]'
                    : 'text-[var(--color-danger)]'
                }`}
              >
                {budgetSaveMsg}
              </p>
            ) : null}
            {budgetMax != null ? (
              <UsageProgressBar
                label="On-demand spend"
                value={usageTotals.costUsd}
                max={budgetMax}
                rightLabel={`$${usageTotals.costUsd.toFixed(2)} / $${budgetMax.toFixed(0)}`}
              />
            ) : null}
          </section>

          <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-[var(--bg-hover)]"
              onClick={() => setShowActivity((v) => !v)}
            >
              <span className="text-[12px] font-medium text-main">Recent activity</span>
              <span className="flex items-center gap-1 text-[11px] text-muted">
                Page {data.usagePage}
                {showActivity ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            </button>
            {showActivity ? (
              <div className="border-t border-[var(--border-subtle)]">
                {(Array.isArray(u.ledger) ? u.ledger : []).slice(0, 25).map((r: any, i: number) => (
                  <div
                    key={String(r.id || i)}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-[var(--border-subtle)] last:border-0 text-[11px]"
                  >
                    <div className="min-w-0">
                      <div className="text-main truncate">{String(r.model_used || '—')}</div>
                      <div className="text-[10px] text-muted">
                        {String(r.provider || '—')} · {relativeTime(r.created_at)}
                      </div>
                    </div>
                    <div className="text-right shrink-0 font-mono text-[10px] text-muted">
                      <div>
                        {formatCompactNumber(
                          Number(r.input_tokens || 0) + Number(r.output_tokens || 0),
                        )}{' '}
                        tok
                      </div>
                      <div>${Number(r.cost_usd || 0).toFixed(4)}</div>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between px-4 py-2 bg-[var(--bg-app)]">
                  <button
                    type="button"
                    className="text-[11px] text-muted hover:text-main disabled:opacity-40"
                    disabled={data.usagePage <= 1}
                    onClick={() => {
                      const p = Math.max(1, data.usagePage - 1);
                      data.setUsagePage(p);
                      void data.loadUsage(p, data.usageProvider, data.usageModel);
                    }}
                  >
                    Previous
                  </button>
                  <div className="flex gap-2">
                    <select
                      value={data.usageProvider}
                      onChange={(e) => {
                        data.setUsageProvider(e.target.value);
                        data.setUsagePage(1);
                        void data.loadUsage(1, e.target.value, data.usageModel);
                      }}
                      className="px-2 py-1 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[10px]"
                    >
                      <option value="">All providers</option>
                      {Array.from(
                        new Set(
                          usageTotals.summary
                            .map((x: any) => String(x.provider || ''))
                            .filter(Boolean),
                        ),
                      ).map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                    <select
                      value={data.usageModel}
                      onChange={(e) => {
                        data.setUsageModel(e.target.value);
                        data.setUsagePage(1);
                        void data.loadUsage(1, data.usageProvider, e.target.value);
                      }}
                      className="px-2 py-1 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[10px]"
                    >
                      <option value="">All models</option>
                      {Array.from(
                        new Set(
                          usageTotals.summary
                            .map((x: any) => String(x.model_used || ''))
                            .filter(Boolean),
                        ),
                      ).map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="text-[11px] text-muted hover:text-main"
                    onClick={() => {
                      const p = data.usagePage + 1;
                      data.setUsagePage(p);
                      void data.loadUsage(p, data.usageProvider, data.usageModel);
                    }}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {/* Plans — collapsed when already on a paid plan */}
      {(data.billingPlansLoading || data.subscriptionLoading) && !data.billingPlans?.length ? (
        <div className="text-[12px] text-muted">Loading plans…</div>
      ) : null}

      {Array.isArray(data.billingPlans) && data.billingPlans.length > 0 ? (
        <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[var(--bg-hover)]"
            onClick={() => setShowPlans((v) => !v)}
          >
            <span className="text-[12px] font-medium text-main">Change plan</span>
            {showPlans ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
          </button>
          {showPlans ? (
            <div className="p-4 pt-0 space-y-3 border-t border-[var(--border-subtle)]">
              <div className="grid grid-cols-1 gap-2">
                {data.billingPlans.map((plan: any) => {
                  const id = String(plan.id ?? '');
                  const isCurrent = id === highlightPlanId;
                  const isFree = id === 'free';
                  return (
                    <div
                      key={id || plan.display_name}
                      className={`rounded-lg border p-3 flex flex-wrap items-center justify-between gap-2 ${
                        isCurrent
                          ? 'border-[var(--solar-cyan)]/50 bg-[var(--solar-cyan)]/5'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-app)]'
                      }`}
                    >
                      <div>
                        <div className="text-[13px] font-medium text-main">
                          {String(plan.display_name ?? plan.name ?? id)}
                        </div>
                        {plan.monthly_token_limit != null ? (
                          <div className="text-[10px] text-muted font-mono mt-0.5">
                            {formatCompactNumber(Number(plan.monthly_token_limit))} tokens / mo
                          </div>
                        ) : null}
                      </div>
                      {isCurrent ? (
                        <span className="text-[10px] uppercase tracking-wider text-[var(--solar-cyan)] font-semibold">
                          Current
                        </span>
                      ) : !isFree ? (
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-lg bg-[var(--solar-cyan)]/20 text-[var(--solar-cyan)] border border-[var(--solar-cyan)]/40 text-[11px] font-semibold"
                          onClick={() => void data.startCheckout(id, plan.billing_period || 'monthly')}
                        >
                          Upgrade
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {(() => {
                const cc = couponsForPlan(highlightPlanId, data.billingCoupons);
                if (!cc.length) return null;
                return (
                  <div className="text-[10px] text-muted space-y-1">
                    {cc.map((c: any) => (
                      <div key={String(c.id ?? c.stripe_coupon_id)}>
                        {String(c.name ?? 'Offer')}
                        {c.percent_off != null ? ` — ${Number(c.percent_off)}% off` : ''}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          ) : null}
        </section>
      ) : null}

      {showInvoices ? (
        <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 space-y-3">
          <div className="text-[12px] font-medium text-main">Invoices</div>
          {data.billingInvoicesLoading ? (
            <div className="text-[11px] text-muted">Loading…</div>
          ) : null}
          {data.billingInvoicesError ? (
            <div className="text-[11px] text-[var(--color-danger)]">{data.billingInvoicesError}</div>
          ) : null}
          {Array.isArray(data.billingInvoices) && data.billingInvoices.length > 0 ? (
            <div className="space-y-2">
              {data.billingInvoices.map((inv: any) => (
                <div
                  key={String(inv.id)}
                  className="flex items-center justify-between gap-3 text-[11px] py-2 border-b border-[var(--border-subtle)] last:border-0"
                >
                  <div className="text-muted">
                    {formatInvoiceWhen(inv.period_end ?? inv.period_start)}
                  </div>
                  <div className="font-mono text-main">
                    ${(Number(inv.amount_paid || 0) / 100).toFixed(2)}
                  </div>
                  <div>
                    {inv.invoice_pdf ? (
                      <a
                        href={inv.invoice_pdf}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--solar-cyan)] hover:underline"
                      >
                        PDF
                      </a>
                    ) : inv.hosted_invoice_url ? (
                      <a
                        href={inv.hosted_invoice_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--solar-cyan)] hover:underline"
                      >
                        View
                      </a>
                    ) : (
                      <span className="text-muted">{String(inv.status || '—')}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted">No invoices yet.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
