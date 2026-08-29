/**
 * Tenant spend caps + BYOK flags from tenants.meta_json / tenants.settings.
 * Enforced at catalog dispatch and model billing gates.
 *
 * Tenant model: platform_allowance_usd = lifetime platform AI spend before BYOK required
 * (NOT a daily recurring budget).
 */

import { getSpendLedgerTotals } from './spend-ledger.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function parseJsonSafe(raw, fallback = null) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

const TIER_RANK = {
  free: 0,
  nano: 1,
  mini: 2,
  standard: 3,
  pro: 4,
  opus: 5,
  max: 6,
};

function tierRank(label) {
  const k = trim(label).toLowerCase();
  return TIER_RANK[k] ?? 99;
}

/**
 * @param {any} env
 * @param {string|null|undefined} tenantId
 */
export async function loadTenantSpendPolicy(env, tenantId) {
  const tid = trim(tenantId);
  const empty = {
    tenant_id: tid || null,
    byok_required: false,
    byok_required_after_allowance: false,
    max_model_tier: null,
    platform_allowance_usd: null,
    spend_cap_daily_usd: null,
    spend_cap_monthly_usd: null,
    spend_hard_stop: false,
  };
  if (!env?.DB || !tid) return empty;

  try {
    const row = await env.DB.prepare(
      `SELECT meta_json, settings FROM tenants WHERE id = ? LIMIT 1`,
    )
      .bind(tid)
      .first();
    if (!row) return empty;

    const meta = parseJsonSafe(row.meta_json, {}) || {};
    const settings = parseJsonSafe(row.settings, {}) || {};
    const spendCap = meta.spend_cap && typeof meta.spend_cap === 'object' ? meta.spend_cap : {};

    const platformAllowanceRaw =
      spendCap.platform_total_usd ??
      spendCap.platform_allowance_usd ??
      settings.platform_allowance_usd;
    const platformAllowance =
      Number(platformAllowanceRaw) > 0 ? Number(platformAllowanceRaw) : null;

    const requireByokAfter =
      spendCap.require_byok_after_exhausted === true ||
      settings.byok_required_after_allowance === true ||
      settings.byok_required_after_allowance === 1;

    // Strict BYOK-from-day-one only when no platform allowance is configured.
    const byokRequiredStrict =
      !platformAllowance &&
      (spendCap.byok_required === true ||
        settings.byok_required === true ||
        settings.byok_required === 1);

    const maxTier = trim(settings.max_model_tier || spendCap.max_model_tier) || null;

    const daily =
      Number(settings.spend_cap_daily_usd ?? spendCap.daily_usd) > 0
        ? Number(settings.spend_cap_daily_usd ?? spendCap.daily_usd)
        : null;
    const monthly =
      Number(settings.spend_cap_monthly_usd ?? spendCap.monthly_usd) > 0
        ? Number(settings.spend_cap_monthly_usd ?? spendCap.monthly_usd)
        : null;

    const hardStop =
      settings.spend_hard_stop === true ||
      settings.spend_hard_stop === 1 ||
      spendCap.hard_stop === true;

    return {
      tenant_id: tid,
      byok_required: byokRequiredStrict,
      byok_required_after_allowance: requireByokAfter || platformAllowance != null,
      max_model_tier: maxTier,
      platform_allowance_usd: platformAllowance,
      spend_cap_daily_usd: daily,
      spend_cap_monthly_usd: monthly,
      spend_hard_stop: hardStop,
    };
  } catch (e) {
    console.warn('[tenant-spend-policy] load', e?.message ?? e);
    return empty;
  }
}

/**
 * @param {any} env
 * @param {string} tenantId
 */
export async function getTenantSpendRollups(env, tenantId) {
  const tid = trim(tenantId);
  if (!env?.DB || !tid) return { daily_usd: 0, monthly_usd: 0, total_usd: 0 };
  return getSpendLedgerTotals(env, { tenantId: tid });
}

/**
 * @param {Awaited<ReturnType<typeof loadTenantSpendPolicy>>} policy
 * @param {{ total_usd?: number, daily_usd?: number, monthly_usd?: number }} rollups
 * @param {{ usesPlatformBilling?: boolean, hasByok?: boolean }} [opts]
 */
export function assertPlatformSpendAllowance(policy, rollups, opts = {}) {
  const usesPlatform = opts.usesPlatformBilling !== false;
  const hasByok = opts.hasByok === true;

  if (hasByok) return { ok: true };

  const cap = policy?.platform_allowance_usd;
  const spent = Number(rollups?.total_usd ?? 0) || 0;

  if (cap != null && policy?.spend_hard_stop !== false && usesPlatform) {
    if (spent >= cap) {
      return {
        ok: false,
        error: 'tenant_platform_allowance_exhausted',
        message:
          `Platform AI allowance ($${cap.toFixed(2)} total) is used up — connect BYOK in Settings → Integrations to continue.`,
        spent_usd: spent,
        cap_usd: cap,
      };
    }
    return { ok: true, spent_usd: spent, cap_usd: cap, remaining_usd: cap - spent };
  }

  if (policy?.byok_required && usesPlatform) {
    return {
      ok: false,
      error: 'tenant_byok_required',
      message:
        'This tenant requires BYOK — add your API keys in Settings → Integrations before using platform models or tools.',
    };
  }

  if (policy?.spend_hard_stop) {
    if (
      policy.spend_cap_daily_usd != null &&
      Number(rollups?.daily_usd ?? 0) >= policy.spend_cap_daily_usd
    ) {
      return {
        ok: false,
        error: 'spend_cap_daily',
        message: `Daily AI spend cap ($${policy.spend_cap_daily_usd.toFixed(2)}) reached for this tenant.`,
        spent_usd: rollups.daily_usd,
        cap_usd: policy.spend_cap_daily_usd,
      };
    }
    if (
      policy.spend_cap_monthly_usd != null &&
      Number(rollups?.monthly_usd ?? 0) >= policy.spend_cap_monthly_usd
    ) {
      return {
        ok: false,
        error: 'spend_cap_monthly',
        message: `Monthly AI spend cap ($${policy.spend_cap_monthly_usd.toFixed(2)}) reached for this tenant.`,
        spent_usd: rollups.monthly_usd,
        cap_usd: policy.spend_cap_monthly_usd,
      };
    }
  }

  return { ok: true, spent_usd: spent, cap_usd: cap ?? null };
}

/**
 * @param {Awaited<ReturnType<typeof loadTenantSpendPolicy>>} policy
 * @param {string|null|undefined} modelKey
 * @param {string|null|undefined} modelTier — agentsam_model_catalog.tier when known
 */
export function assertTenantModelTierAllowed(policy, modelKey, modelTier) {
  const ceiling = trim(policy?.max_model_tier);
  if (!ceiling) return { ok: true };

  let tier = trim(modelTier);
  if (!tier && modelKey) {
    const mk = trim(modelKey).toLowerCase();
    if (mk.includes('nano')) tier = 'nano';
    else if (mk.includes('mini')) tier = 'mini';
    else if (mk.includes('opus')) tier = 'opus';
    else if (mk.includes('pro')) tier = 'pro';
  }
  if (!tier) return { ok: true };

  if (tierRank(tier) > tierRank(ceiling)) {
    return {
      ok: false,
      error: 'tenant_model_tier_exceeded',
      message: `Model tier "${tier}" exceeds tenant ceiling "${ceiling}"`,
      max_model_tier: ceiling,
    };
  }
  return { ok: true };
}

/**
 * @param {any} env
 * @param {{
 *   tenantId?: string|null,
 *   userId?: string|null,
 *   isSuperadmin?: boolean,
 *   billingSource?: string|null,
 *   modelKey?: string|null,
 *   modelTier?: string|null,
 *   authSource?: string|null,
 *   hasByok?: boolean,
 * }} ctx
 */
export async function assertTenantSpendPolicy(env, ctx = {}) {
  const tid = trim(ctx.tenantId);
  if (!tid) return { ok: true };

  const wsId = trim(ctx.workspaceId);
  if (wsId) {
    const { assertWorkspaceSpendPolicy } = await import('./workspace-spend.js');
    const workspaceGate = await assertWorkspaceSpendPolicy(env, {
      tenantId: tid,
      workspaceId: wsId,
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      isPlatformOperator: false,
      hasByok: ctx.hasByok,
      usesPlatformBilling:
        ctx.usesPlatformBilling ??
        (trim(ctx.authSource).toLowerCase() === 'platform' ||
          trim(ctx.billingSource).toLowerCase() === 'platform_subscription' ||
          trim(ctx.billingSource).toLowerCase() === 'platform_workers_ai'),
      estimatedCallCostUsd: ctx.estimatedCallCostUsd,
    });
    if (!workspaceGate.ok) return { ...workspaceGate, tenant_id: tid, workspace_id: wsId };
  }

  const policy = await loadTenantSpendPolicy(env, tid);

  if (ctx.modelKey || ctx.modelTier) {
    const tierGate = assertTenantModelTierAllowed(policy, ctx.modelKey, ctx.modelTier);
    if (!tierGate.ok) return tierGate;
  }

  const authSource = trim(ctx.authSource).toLowerCase();
  const billingSource = trim(ctx.billingSource).toLowerCase();
  const usesPlatformKeys =
    authSource === 'platform' ||
    authSource === 'platform_scoped' ||
    billingSource === 'platform_subscription' ||
    billingSource === 'platform_workers_ai';

  const rollups = await getTenantSpendRollups(env, tid);
  const allowanceGate = assertPlatformSpendAllowance(policy, rollups, {
    usesPlatformBilling: usesPlatformKeys,
    hasByok: ctx.hasByok === true,
  });
  if (!allowanceGate.ok) return { ...allowanceGate, tenant_id: tid, policy, rollups };

  return { ok: true, policy, rollups, ...allowanceGate };
}
