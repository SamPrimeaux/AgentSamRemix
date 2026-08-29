/**
 * Canonical spend totals — spend_ledger is the single source of truth.
 * agentsam_usage_events / rollups_daily are downstream mirrors only.
 */

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function utcDayStartUnix() {
  const d = new Date();
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
}

function utcMonthStartUnix() {
  const d = new Date();
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000);
}

/**
 * @param {any} env
 * @param {{ tenantId?: string|null, workspaceId?: string|null, sessionId?: string|null }} scope
 */
export async function getSpendLedgerTotals(env, scope = {}) {
  const tid = trim(scope.tenantId);
  const ws = trim(scope.workspaceId);
  const sid = trim(scope.sessionId);
  const empty = { daily_usd: 0, monthly_usd: 0, total_usd: 0, session_usd: 0, workspace_daily_usd: 0 };
  if (!env?.DB || !tid) return empty;

  const dayStart = utcDayStartUnix();
  const monthStart = utcMonthStartUnix();

  try {
    const [dailyRow, monthlyRow, totalRow, wsDailyRow, sessionRow] = await Promise.all([
      env.DB.prepare(
        `SELECT COALESCE(SUM(amount_usd), 0) AS total
           FROM spend_ledger
          WHERE tenant_id = ? AND occurred_at >= ?`,
      )
        .bind(tid, dayStart)
        .first(),
      env.DB.prepare(
        `SELECT COALESCE(SUM(amount_usd), 0) AS total
           FROM spend_ledger
          WHERE tenant_id = ? AND occurred_at >= ?`,
      )
        .bind(tid, monthStart)
        .first(),
      env.DB.prepare(
        `SELECT COALESCE(SUM(amount_usd), 0) AS total
           FROM spend_ledger WHERE tenant_id = ?`,
      )
        .bind(tid)
        .first(),
      ws
        ? env.DB.prepare(
            `SELECT COALESCE(SUM(amount_usd), 0) AS total
               FROM spend_ledger
              WHERE tenant_id = ? AND workspace_id = ? AND occurred_at >= ?`,
          )
            .bind(tid, ws, dayStart)
            .first()
        : Promise.resolve(null),
      sid
        ? env.DB.prepare(
            `SELECT COALESCE(SUM(amount_usd), 0) AS total
               FROM spend_ledger
              WHERE tenant_id = ? AND session_tag = ?`,
          )
            .bind(tid, sid)
            .first()
        : Promise.resolve(null),
    ]);

    return {
      daily_usd: Number(dailyRow?.total ?? 0) || 0,
      monthly_usd: Number(monthlyRow?.total ?? 0) || 0,
      total_usd: Number(totalRow?.total ?? 0) || 0,
      session_usd: Number(sessionRow?.total ?? 0) || 0,
      workspace_daily_usd: Number(wsDailyRow?.total ?? 0) || 0,
    };
  } catch (e) {
    console.warn('[spend-ledger-canonical] totals', e?.message ?? e);
    return empty;
  }
}

/**
 * Hard kill switch — checked before every model call in agent-tool-loop.
 * No superadmin bypass: platform spend must stop when caps are hit.
 *
 * @param {any} env
 * @param {{
 *   tenantId?: string|null,
 *   workspaceId?: string|null,
 *   userId?: string|null,
 *   sessionId?: string|null,
 *   modelKey?: string|null,
 * }} ctx
 */
export async function assertSpendKillSwitch(env, ctx = {}) {
  const tid = trim(ctx.tenantId);
  if (!env?.DB || !tid) return { ok: true };

  const { loadTenantSpendPolicy, assertPlatformSpendAllowance, assertTenantModelTierAllowed } =
    await import('./tenant-spend.js');
  const { assertWorkspaceSpendPolicy } = await import('./workspace-spend.js');

  const ws = trim(ctx.workspaceId);
  if (ws) {
    const workspaceGate = await assertWorkspaceSpendPolicy(env, {
      tenantId: tid,
      workspaceId: ws,
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      isPlatformOperator: false,
      usesPlatformBilling: true,
    });
    if (!workspaceGate.ok) {
      return { ...workspaceGate, source: 'spend_ledger', kill_switch: true };
    }
  }

  const policy = await loadTenantSpendPolicy(env, tid);
  if (ctx.modelKey) {
    const tierGate = assertTenantModelTierAllowed(policy, ctx.modelKey, null);
    if (!tierGate.ok) return { ...tierGate, source: 'spend_ledger', kill_switch: true };
  }

  const rollups = await getSpendLedgerTotals(env, {
    tenantId: tid,
    workspaceId: ws || null,
    sessionId: ctx.sessionId || null,
  });

  const allowanceGate = assertPlatformSpendAllowance(policy, rollups, {
    usesPlatformBilling: true,
    hasByok: false,
  });
  if (!allowanceGate.ok) {
    return { ...allowanceGate, source: 'spend_ledger', kill_switch: true, rollups };
  }

  return { ok: true, policy, rollups, source: 'spend_ledger' };
}
