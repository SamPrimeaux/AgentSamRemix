/**
 * Billing plan lookup and model-access policy.
 */
import { getUserBYOKey } from './byok.js';

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(String(text || ''));
  } catch {
    return fallback;
  }
}

export async function getUserPlan(env, tenantId) {
  if (!env?.DB || !tenantId) {
    return {
      plan_id: 'free',
      features: {},
      free_models: [],
      allows_byok: false,
      allows_usage_billing: false,
      limits: {},
    };
  }

  try {
    const sub = await env.DB.prepare(
      `SELECT bs.plan_id, bp.features_json, bp.monthly_token_limit,
              bp.daily_request_limit, bp.max_concurrency,
              bp.allows_byok, bp.allows_usage_billing, bp.free_tier_models_json
         FROM billing_subscriptions bs
         JOIN billing_plans bp ON bp.id = bs.plan_id
        WHERE bs.tenant_id = ? AND bs.status = 'active'
        LIMIT 1`,
    ).bind(tenantId).first();
    const plan = sub || await env.DB.prepare(
      `SELECT * FROM billing_plans WHERE id = ? LIMIT 1`,
    ).bind('free').first();
    return {
      plan_id: plan?.plan_id || plan?.id || 'free',
      features: safeJsonParse(plan?.features_json, {}),
      free_models: safeJsonParse(plan?.free_tier_models_json, []),
      allows_byok: !!plan?.allows_byok,
      allows_usage_billing: !!plan?.allows_usage_billing,
      limits: {
        monthly_tokens: plan?.monthly_token_limit ?? null,
        daily_requests: plan?.daily_request_limit ?? null,
        concurrency: plan?.max_concurrency ?? null,
      },
    };
  } catch (error) {
    console.warn('[getUserPlan]', error?.message ?? error);
    return {
      plan_id: 'free',
      features: {},
      free_models: [],
      allows_byok: false,
      allows_usage_billing: false,
      limits: {},
    };
  }
}

function modelMatchesFreeTierList(modelKey, freeModels) {
  const mk = String(modelKey || '').trim();
  if (!mk) return false;
  return (Array.isArray(freeModels) ? freeModels : []).some((value) => {
    const f = String(value || '').trim();
    return f && (f === mk || mk.includes(f) || f.includes(mk));
  });
}

/**
 * Plan, BYOK, tenant spend, and workspace spend gate for a model request.
 */
export async function evaluatePlanForModelRequest(
  env,
  { tenantId, userId, workspaceId, sessionId, modelKey, apiPlatform, isSuperadmin },
) {
  if (isSuperadmin === true) {
    return { allowed: true, billingSource: 'platform_operator', byokApiKey: null };
  }

  const {
    loadTenantSpendPolicy,
    getTenantSpendRollups,
    assertTenantModelTierAllowed,
    assertPlatformSpendAllowance,
  } = await import('../policy/tenant-spend.js');
  const tenantPolicy = await loadTenantSpendPolicy(env, tenantId);
  const spendRollups = await getTenantSpendRollups(env, tenantId);

  let modelTier = null;
  const mk = String(modelKey || '').trim();
  if (mk && env?.DB) {
    try {
      const row = await env.DB.prepare(
        `SELECT tier FROM agentsam_model_catalog WHERE model_key = ? LIMIT 1`,
      ).bind(mk).first();
      modelTier = row?.tier != null ? String(row.tier) : null;
    } catch {}
  }

  const tierGate = assertTenantModelTierAllowed(tenantPolicy, mk, modelTier);
  if (!tierGate.ok) {
    return {
      allowed: false,
      status: 402,
      body: {
        error: tierGate.error,
        message: tierGate.message,
        max_model_tier: tierGate.max_model_tier,
      },
    };
  }

  const plan = await getUserPlan(env, tenantId);
  const platform = String(apiPlatform || '').trim();
  const freeModels = Array.isArray(plan.free_models) ? plan.free_models : [];
  const isWorkersAi = platform === 'workers_ai' || mk.startsWith('@cf/');
  const isOllama = platform === 'ollama' || mk === 'ollama/local' || /ollama/i.test(mk);
  if (isOllama) return { allowed: true, billingSource: 'ollama', byokApiKey: null };

  const provider = byokProviderSlugFromApiPlatform(platform);
  const byok = plan.allows_byok && userId && provider
    ? await getUserBYOKey(env, userId, tenantId, provider)
    : null;

  if (workspaceId) {
    const { assertWorkspaceSpendPolicy } = await import('../policy/workspace-spend.js');
    const workspaceGate = await assertWorkspaceSpendPolicy(env, {
      tenantId,
      workspaceId: String(workspaceId).trim(),
      userId,
      sessionId: sessionId != null ? String(sessionId).trim() : null,
      isSuperadmin,
      hasByok: !!byok?.key,
      usesPlatformBilling: true,
    });
    if (!workspaceGate.ok) {
      return {
        allowed: false,
        status: 402,
        body: {
          error: workspaceGate.error,
          message: workspaceGate.message,
          spent_usd: workspaceGate.spent_usd,
          cap_usd: workspaceGate.cap_usd,
          upgrade_url: '/dashboard/settings/integrations',
        },
      };
    }
  }

  if (isWorkersAi) {
    if (!modelMatchesFreeTierList(mk, freeModels)) {
      return {
        allowed: false,
        status: 402,
        body: {
          error: 'Model not available on your plan',
          upgrade_url: '/dashboard/settings/billing',
          free_models: freeModels,
        },
      };
    }
    const allowance = assertPlatformSpendAllowance(tenantPolicy, spendRollups, {
      usesPlatformBilling: true,
      hasByok: !!byok?.key,
    });
    if (!allowance.ok) {
      return {
        allowed: false,
        status: 402,
        body: {
          error: allowance.error,
          message: allowance.message,
          spent_usd: allowance.spent_usd,
          cap_usd: allowance.cap_usd,
          upgrade_url: '/dashboard/settings/integrations',
        },
      };
    }
    return { allowed: true, billingSource: 'platform_workers_ai', byokApiKey: null };
  }

  if (byok?.key) {
    return {
      allowed: true,
      billingSource: 'byok',
      byokApiKey: byok.key,
      byokProvider: provider,
    };
  }

  if (plan.plan_id !== 'free' || plan.allows_usage_billing) {
    const allowance = assertPlatformSpendAllowance(tenantPolicy, spendRollups, {
      usesPlatformBilling: true,
      hasByok: false,
    });
    if (!allowance.ok) {
      return {
        allowed: false,
        status: 402,
        body: {
          error: allowance.error,
          message: allowance.message,
          spent_usd: allowance.spent_usd,
          cap_usd: allowance.cap_usd,
          upgrade_url: '/dashboard/settings/integrations',
        },
      };
    }
    return { allowed: true, billingSource: 'platform_subscription', byokApiKey: null };
  }

  return {
    allowed: false,
    status: 402,
    body: {
      error: 'Model not available on your plan',
      upgrade_url: '/dashboard/settings/billing',
      free_models: freeModels,
    },
  };
}

function byokProviderSlugFromApiPlatform(apiPlatform) {
  const platform = String(apiPlatform || '').trim();
  if (platform === 'anthropic_api') return 'anthropic';
  if (platform === 'openai' || platform === 'cursor') return 'openai';
  if (['gemini_api', 'vertex_ai', 'google_ai'].includes(platform)) return 'google';
  return null;
}

export function envWithLlmKeyOverride(env, billingGate, apiPlatform) {
  if (!billingGate?.byokApiKey || billingGate.billingSource !== 'byok') return env;
  const key = billingGate.byokApiKey;
  const platform = String(apiPlatform || '').trim();
  const envKey =
    platform === 'anthropic_api'
      ? 'ANTHROPIC_API_KEY'
      : platform === 'openai' || platform === 'cursor'
        ? 'OPENAI_API_KEY'
        : platform === 'gemini_api' || platform === 'vertex_ai'
          ? 'GEMINI_API_KEY'
          : null;
  if (!envKey) return env;
  return new Proxy(env, {
    get(target, prop, receiver) {
      if (prop === envKey || (envKey === 'GEMINI_API_KEY' && prop === 'GOOGLE_AI_API_KEY')) {
        return key;
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
