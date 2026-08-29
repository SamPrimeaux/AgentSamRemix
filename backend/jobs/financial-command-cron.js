import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';
import { resolveCronTenantId } from './cron-tenant.js';
import { notifyOperator } from './notify-operator.js';
import { runBillingReminderCron } from './billing-reminder-cron.js';

/** Daily 09:00 UTC: compare spend_ledger today vs agentsam_guardrails cost_budget policy; email if over. */
export async function runFinancialCommandCron(env, ctx) {
  if (!env.DB) return;
  await runBillingReminderCron(env, ctx).catch((e) =>
    console.warn('[cron] billing reminder hook', e?.message ?? e),
  );
  const cronTenant = await resolveCronTenantId(env);
  const begun = await startCronRun(env, {
    jobName: 'financial_command_daily',
    cronExpression: '0 9 * * *',
    tenantId: cronTenant,
    workspaceId: null,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();
  let rowsRead = 0;
  let dailyBudgetUsd = 50;
  try {
    const { results } = await env.DB.prepare(
      `SELECT policy_json AS metadata FROM agentsam_guardrails WHERE is_enabled = 1 AND category = 'cost_budget' ORDER BY priority DESC LIMIT 10`,
    ).all();
    rowsRead += 1;
    for (const row of results || []) {
      if (!row?.metadata) continue;
      try {
        const m = JSON.parse(String(row.metadata));
        if (typeof m.daily_budget_usd === 'number') {
          dailyBudgetUsd = m.daily_budget_usd;
          break;
        }
        if (typeof m.daily_spend_cap_usd === 'number') {
          dailyBudgetUsd = m.daily_spend_cap_usd;
          break;
        }
      } catch (_) { /* next row */ }
    }
  } catch (e) {
    console.warn('[cron] financial guardrails read', e?.message ?? e);
  }
  try {
    const finTid = cronTenant;
    if (!finTid) {
      if (runId) await completeCronRun(env, runId, startedAt, { rowsRead, rowsWritten: 0, metadata: { skip: 'no_tenant' } });
      return;
    }
    const row = await env.DB.prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS total FROM spend_ledger
       WHERE tenant_id = ?
       AND date(occurred_at, 'unixepoch') = date('now')`,
    )
      .bind(finTid)
      .first();
    rowsRead += 1;
    const total = Number(row?.total ?? 0);
    if (total > dailyBudgetUsd) {
      notifyOperator(
        env,
        {
          subject: `Daily spend alert: $${total.toFixed(2)} over cap $${dailyBudgetUsd.toFixed(2)}`,
          body: `Today's spend (spend_ledger): $${total.toFixed(2)}\nConfigured daily budget (agentsam_guardrails policy): $${dailyBudgetUsd.toFixed(2)}\n`,
          category: 'finance',
        },
        ctx,
      );
    }
    if (runId) {
      await completeCronRun(env, runId, startedAt, {
        rowsRead,
        rowsWritten: 0,
        metadata: { dailyBudgetUsd, spendToday: total, alerted: total > dailyBudgetUsd },
      });
    }
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    console.warn('[cron] runFinancialCommandCron', e?.message ?? e);
  }
}
