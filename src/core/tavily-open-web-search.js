/**
 * Tavily-backed open_web_search — budget caps, cache, telemetry (no raw API keys in logs).
 */
import { stripUserTextForIntent } from './active-file-envelope.js';
import { isReadOnlyFileContextIntent, isReadOnlyRepoSearchIntent } from './code-implementation-intent.js';

async function sha256Hex(value) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashStableJson(obj) {
  return sha256Hex(typeof obj === 'string' ? obj : JSON.stringify(obj ?? {}));
}

export const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';

export const TAVILY_DEFAULTS = Object.freeze({
  search_depth: 'basic',
  max_results: 5,
  include_answer: false,
  include_raw_content: false,
  include_images: false,
  auto_parameters: false,
  topic: 'general',
  timeout_ms: 12_000,
  max_chars_per_result: 2_000,
  max_total_chars: 12_000,
  cache_ttl_seconds: 43_200, // 12h
  // Call caps: agentsam_tools.handler_config for search_web (max_calls_per_turn / max_calls_per_run).
  advanced_credit_estimate: 2,
  basic_credit_estimate: 1,
});

/**
 * Resolve open-web call caps from D1 search_web handler_config (and max_calls_per_session).
 * Cached on the shared openWebBudget bag for the run.
 * @param {any} env
 * @param {{ turnCalls?: number, runCalls?: number, limits?: { max_calls_per_turn: number, max_calls_per_run: number } }} budget
 * @returns {Promise<{ ok: true, max_calls_per_turn: number, max_calls_per_run: number } | { ok: false, error: string }>}
 */
export async function resolveOpenWebCallLimits(env, budget) {
  if (budget?.limits && Number.isFinite(budget.limits.max_calls_per_turn) && Number.isFinite(budget.limits.max_calls_per_run)) {
    return { ok: true, ...budget.limits };
  }
  if (!env?.DB) {
    return { ok: false, error: 'open_web_budget_db_required' };
  }
  let row;
  try {
    row = await env.DB.prepare(
      `SELECT handler_config, max_calls_per_session
       FROM agentsam_tools
       WHERE tool_key = 'search_web' AND COALESCE(is_active, 1) = 1
       LIMIT 1`,
    ).first();
  } catch (e) {
    return { ok: false, error: `open_web_budget_query_failed:${e?.message || e}` };
  }
  if (!row) {
    return { ok: false, error: 'open_web_budget_tool_row_missing' };
  }
  let cfg = {};
  try {
    cfg = typeof row.handler_config === 'string' ? JSON.parse(row.handler_config || '{}') : row.handler_config || {};
  } catch {
    return { ok: false, error: 'open_web_budget_handler_config_invalid' };
  }
  const turn = Number(cfg.max_calls_per_turn ?? cfg.budget?.max_calls_per_turn);
  const runRaw = cfg.max_calls_per_run ?? cfg.budget?.max_calls_per_run ?? row.max_calls_per_session;
  const run = Number(runRaw);
  if (!Number.isFinite(turn) || turn < 1 || !Number.isFinite(run) || run < 1) {
    return { ok: false, error: 'open_web_budget_limits_not_configured' };
  }
  const limits = {
    max_calls_per_turn: Math.floor(turn),
    max_calls_per_run: Math.floor(run),
  };
  if (budget && typeof budget === 'object') {
    budget.limits = limits;
  }
  return { ok: true, ...limits };
}

/** Soft budget stop — never throw; model must answer from prior search_web results. */
export function buildOpenWebBudgetExhaustedResult({
  scope = 'turn',
  maxCalls,
  baseTelemetry = {},
} = {}) {
  const turnScope = String(scope || 'turn') === 'run' ? 'run' : 'turn';
  const limit = Number(maxCalls);
  if (!Number.isFinite(limit) || limit < 1) {
    return {
      ok: false,
      error: 'open_web_budget_limit_required',
      message: 'Open-web search budget limit is not configured in D1.',
      lane: 'open_web_search',
      provider: 'tavily',
      results: [],
      result_count: 0,
      telemetry: {
        ...baseTelemetry,
        success: false,
        budget_exhausted: false,
        error_class: 'budget_config_missing',
        result_count: 0,
      },
    };
  }
  return {
    ok: true,
    budget_exhausted: true,
    budget_scope: turnScope,
    lane: 'open_web_search',
    provider: 'tavily',
    results: [],
    result_count: 0,
    message: `Open-web search limit reached (${limit} calls per ${turnScope}).`,
    next_action: 'answer_from_prior_search_results',
    instruction:
      'Do not call search_web again. Answer the user now using any search_web results already returned earlier in this turn. Cite official sources from those results.',
    telemetry: {
      ...baseTelemetry,
      success: true,
      budget_exhausted: true,
      error_class: null,
      result_count: 0,
    },
  };
}

/** @param {unknown} value */
export function isOpenWebBudgetExhaustedResult(value) {
  return !!(value && typeof value === 'object' && value.budget_exhausted === true);
}

const PROVIDER_NATIVE_WEB_SEARCH_IMPLEMENTED = false;

/**
 * @param {any} env
 */
export function hasTavilyApiKey(env) {
  return !!(env?.TAVILY_API_KEY && String(env.TAVILY_API_KEY).trim());
}

/**
 * @param {any} env
 */
export function hasLegacySearchApiKey(env) {
  return !!(env?.SEARCH_API_KEY && String(env.SEARCH_API_KEY).trim());
}

/**
 * @param {any} env
 */
export function resolveTavilyApiKey(env) {
  if (hasTavilyApiKey(env)) return String(env.TAVILY_API_KEY).trim();
  if (hasLegacySearchApiKey(env)) return String(env.SEARCH_API_KEY).trim();
  return null;
}

/**
 * @param {any} env
 */
export function hasOpenWebSearchBackend(env) {
  return !!resolveTavilyApiKey(env);
}

/**
 * Startup/runtime label — "tavily" only when TAVILY_API_KEY is set.
 * @param {any} env
 */
export function resolveOpenWebBackendLabel(env) {
  if (hasTavilyApiKey(env)) return 'tavily';
  if (hasLegacySearchApiKey(env)) return 'search_api';
  return 'none';
}

/**
 * @param {unknown} message
 */
export function isSimpleGreeting(_message) {
  return false;
}

/**
 * @param {unknown} message
 */
export function messageRequestsExplicitDeepResearch(_message) {
  return false;
}

/**
 * @param {unknown} message
 */
export function messageRequestsInternalKnowledge(_message) {
  return false;
}

/**
 * @param {unknown} results
 */
export function isWeakTavilyResultSet(results) {
  if (!Array.isArray(results) || !results.length) return true;
  const withContent = results.filter((r) => {
    const t = String(r?.content ?? r?.snippet ?? '').trim();
    return t.length >= 40;
  });
  return withContent.length < 2;
}

/**
 * @param {Record<string, unknown>} opts
 */
export async function buildTavilyCacheKey(opts) {
  const provider = String(opts.provider || 'tavily');
  const query = String(opts.query || '').trim().toLowerCase();
  const depth = String(opts.search_depth || TAVILY_DEFAULTS.search_depth);
  const maxResults = Number(opts.max_results) || TAVILY_DEFAULTS.max_results;
  const includeDomains = Array.isArray(opts.include_domains)
    ? [...opts.include_domains].map(String).sort()
    : [];
  const excludeDomains = Array.isArray(opts.exclude_domains)
    ? [...opts.exclude_domains].map(String).sort()
    : [];
  const material = JSON.stringify({
    provider,
    query,
    search_depth: depth,
    max_results: maxResults,
    include_domains: includeDomains,
    exclude_domains: excludeDomains,
  });
  const queryHash = await hashStableJson(query);
  const cacheKey = await sha256Hex(`tavily_open_web:${material}`);
  return { cacheKey, queryHash, inputHash: cacheKey };
}

/**
 * @param {any} env
 * @param {{
 *   workspaceId: string,
 *   tenantId?: string|null,
 *   toolInput: Record<string, unknown>,
 *   userId?: string|null,
 *   sessionId?: string|null,
 * }} opts
 */
export async function readTavilyToolCache(env, opts) {
  if (!env?.DB || !opts?.workspaceId) return { hit: false, body: null };
  try {
    const toolRow =
      (await env.DB.prepare(
        `SELECT id, tool_key, cache_policy_json, updated_at_unix FROM agentsam_tools
          WHERE tool_key = 'search_web' AND COALESCE(is_active, 1) = 1 LIMIT 1`,
      ).first()) || { tool_key: 'search_web' };
    const { lookupToolCache } = await import('./tool-cache-bridge.js');
    const cached = await lookupToolCache(env, {
      toolRow,
      toolInput: opts.toolInput,
      tenantId: opts.tenantId ?? null,
      workspaceId: opts.workspaceId,
      userId: opts.userId ?? null,
      sessionId: opts.sessionId ?? null,
    });
    if (!cached?.hit || cached.body == null) return { hit: false, body: null };
    return { hit: true, body: cached.body };
  } catch {
    return { hit: false, body: null };
  }
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} o
 */
export async function writeTavilyToolCache(env, o) {
  if (!env?.DB || !o.workspaceId) return;
  try {
    const toolRow =
      (await env.DB.prepare(
        `SELECT id, tool_key, cache_policy_json, updated_at_unix FROM agentsam_tools
          WHERE tool_key = 'search_web' AND COALESCE(is_active, 1) = 1 LIMIT 1`,
      ).first()) || { tool_key: 'search_web' };
    const { writeToolCacheResult } = await import('./tool-cache-bridge.js');
    await writeToolCacheResult(env, {
      toolRow,
      toolInput: o.toolInput ?? {},
      result: o.body,
      tenantId: o.tenantId ?? null,
      workspaceId: o.workspaceId,
      userId: o.userId ?? null,
      sessionId: o.sessionId ?? null,
      originDurationMs: o.durationMs ?? 0,
      originCostUsd: 0,
      agentRunId: o.agentRunId ?? null,
    });
  } catch (e) {
    console.warn('[tavily_open_web] cache_write', e?.message ?? e);
  }
}

/**
 * @param {any} env
 * @param {string|null} agentRunId
 */
export async function countTavilyCallsForRun(env, agentRunId) {
  if (!env?.DB || !agentRunId) return 0;
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM agentsam_tool_chain
       WHERE agent_run_id = ? AND tool_key = 'search_web' AND tool_status = 'completed'`,
    )
      .bind(agentRunId)
      .first();
    return Number(row?.c) || 0;
  } catch {
    return 0;
  }
}

/**
 * @param {Record<string, unknown>|undefined} runContext
 */
function resolveOpenWebBudget(runContext) {
  const b = runContext?.openWebBudget;
  if (b && typeof b === 'object') return b;
  return { turnCalls: 0, runCalls: 0 };
}

/**
 * @param {unknown} data
 * @param {{ max_chars_per_result: number, max_total_chars: number }} limits
 */
export function trimTavilyResponseForModel(data, limits) {
  const out = { ...data };
  let total = 0;
  if (Array.isArray(out.results)) {
    out.results = out.results.map((r) => {
      const copy = { ...r };
      for (const field of ['content', 'raw_content', 'snippet']) {
        if (copy[field] != null) {
          const s = String(copy[field]);
          const slice = s.slice(0, limits.max_chars_per_result);
          total += slice.length;
          copy[field] = slice;
        }
      }
      return copy;
    });
    if (total > limits.max_total_chars) {
      out.results = out.results.slice(0, Math.max(1, Math.floor(out.results.length / 2)));
    }
  }
  if (out.answer != null) {
    out.answer = String(out.answer).slice(0, limits.max_chars_per_result);
  }
  return out;
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} params
 * @param {Record<string, unknown>} [runContext]
 */
export async function executeTavilyOpenWebSearch(env, params, runContext = {}) {
  const started = Date.now();
  const query = String(params.query ?? params.q ?? '').trim();
  const workspaceId = String(
    runContext.workspaceId ?? runContext.workspace_id ?? params.workspace_id ?? '',
  ).trim();
  const tenantId = String(runContext.tenantId ?? runContext.tenant_id ?? params.tenant_id ?? '').trim() || null;
  const userId = String(runContext.userId ?? runContext.user_id ?? params.user_id ?? '').trim() || null;
  const agentRunId =
    runContext.agentRunId ?? runContext.agent_run_id ?? params.agent_run_id ?? params.agentRunId ?? null;

  const baseTelemetry = {
    lane: 'open_web_search',
    backend: resolveOpenWebBackendLabel(env),
    query_hash: null,
    search_depth: TAVILY_DEFAULTS.search_depth,
    estimated_credits: TAVILY_DEFAULTS.basic_credit_estimate,
    cache_hit: false,
    duration_ms: 0,
    result_count: 0,
    success: false,
    error_class: null,
    agent_run_id: agentRunId,
  };

  if (!query) {
    return {
      error: 'query required',
      lane: 'open_web_search',
      available: false,
      telemetry: { ...baseTelemetry, error_class: 'missing_query' },
    };
  }

  const apiKey = resolveTavilyApiKey(env);
  if (!apiKey) {
    return {
      error: 'open_web_search_unavailable',
      message:
        'Open-web search is not configured (set TAVILY_API_KEY). Use web_fetch for a known URL or workspace tools for repo symbols.',
      lane: 'open_web_search',
      available: false,
      telemetry: { ...baseTelemetry, error_class: 'no_backend' },
    };
  }

  const budget = resolveOpenWebBudget(runContext);
  const limitsResolved = await resolveOpenWebCallLimits(env, budget);
  if (!limitsResolved.ok) {
    return {
      ok: false,
      error: limitsResolved.error,
      message:
        'Open-web search call caps are not configured on agentsam_tools.search_web (handler_config.max_calls_per_turn / max_calls_per_run).',
      lane: 'open_web_search',
      available: false,
      telemetry: { ...baseTelemetry, error_class: 'budget_config_missing' },
    };
  }
  const { max_calls_per_turn: maxTurn, max_calls_per_run: maxRun } = limitsResolved;

  if (budget.turnCalls >= maxTurn) {
    return buildOpenWebBudgetExhaustedResult({
      scope: 'turn',
      maxCalls: maxTurn,
      baseTelemetry,
    });
  }

  const runCount = await countTavilyCallsForRun(env, agentRunId != null ? String(agentRunId) : null);
  const effectiveRunCalls = Math.max(runCount, budget.runCalls);
  if (effectiveRunCalls >= maxRun) {
    return buildOpenWebBudgetExhaustedResult({
      scope: 'run',
      maxCalls: maxRun,
      baseTelemetry,
    });
  }

  let searchDepth = String(params.search_depth || TAVILY_DEFAULTS.search_depth).toLowerCase();
  if (searchDepth !== 'basic' && searchDepth !== 'advanced') searchDepth = 'basic';

  const maxResults = Math.min(
    10,
    Math.max(1, Number(params.max_results) || TAVILY_DEFAULTS.max_results),
  );
  const includeDomains = Array.isArray(params.include_domains) ? params.include_domains : undefined;
  const excludeDomains = Array.isArray(params.exclude_domains) ? params.exclude_domains : undefined;

  const { cacheKey, queryHash, inputHash } = await buildTavilyCacheKey({
    provider: resolveOpenWebBackendLabel(env),
    query,
    search_depth: searchDepth,
    max_results: maxResults,
    include_domains: includeDomains,
    exclude_domains: excludeDomains,
  });
  baseTelemetry.query_hash = queryHash;

  const tavilyToolInput = {
    query,
    search_depth: searchDepth,
    max_results: maxResults,
    include_domains: includeDomains,
    exclude_domains: excludeDomains,
    provider: resolveOpenWebBackendLabel(env),
  };

  if (workspaceId) {
    const cached = await readTavilyToolCache(env, {
      workspaceId,
      tenantId,
      toolInput: tavilyToolInput,
      userId,
      sessionId: agentRunId,
    });
    if (cached.hit && cached.body) {
      budget.turnCalls += 1;
      budget.runCalls += 1;
      const durationMs = Math.max(0, Date.now() - started);
      return {
        ...cached.body,
        lane: 'open_web_search',
        provider: resolveOpenWebBackendLabel(env),
        cache_hit: true,
        telemetry: {
          ...baseTelemetry,
          cache_hit: true,
          duration_ms: durationMs,
          result_count: Array.isArray(cached.body?.results) ? cached.body.results.length : 0,
          success: true,
          search_depth: cached.body?.search_depth ?? searchDepth,
        },
      };
    }
  }

  // Platform Tavily call is not a user-directed URL fetch — do not apply
  // agentsam_fetch_domain_allowlist here (that gate belongs on web_fetch).

  const requestBody = {
    api_key: apiKey,
    query,
    search_depth: searchDepth,
    max_results: maxResults,
    include_answer: params.include_answer === true,
    include_raw_content: params.include_raw_content === true,
    include_images: params.include_images === true,
    auto_parameters: params.auto_parameters === true,
    topic: String(params.topic || TAVILY_DEFAULTS.topic),
  };
  if (includeDomains?.length) requestBody.include_domains = includeDomains;
  if (excludeDomains?.length) requestBody.exclude_domains = excludeDomains;

  const timeoutMs = Math.min(
    20_000,
    Math.max(3_000, Number(params.timeout_ms) || TAVILY_DEFAULTS.timeout_ms),
  );

  let res;
  let data = {};
  try {
    res = await fetch(TAVILY_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs),
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    const durationMs = Math.max(0, Date.now() - started);
    return {
      error: 'tavily_timeout',
      message: String(e?.message || e).slice(0, 200),
      lane: 'open_web_search',
      telemetry: {
        ...baseTelemetry,
        duration_ms: durationMs,
        error_class: 'timeout',
      },
    };
  }

  const durationMs = Math.max(0, Date.now() - started);

  if (!res.ok) {
    return {
      error: data?.error || `search_http_${res.status}`,
      lane: 'open_web_search',
      available: true,
      telemetry: {
        ...baseTelemetry,
        duration_ms: durationMs,
        error_class: 'http_error',
      },
    };
  }

  let trimmed = trimTavilyResponseForModel(
    { ...data, search_depth: searchDepth, max_results: maxResults },
    {
      max_chars_per_result: TAVILY_DEFAULTS.max_chars_per_result,
      max_total_chars: TAVILY_DEFAULTS.max_total_chars,
    },
  );

  const weak = isWeakTavilyResultSet(trimmed.results);
  const allowAdvanced =
    searchDepth === 'basic' &&
    (params.force_advanced === true) &&
    budget.turnCalls < maxTurn &&
    effectiveRunCalls < maxRun - 1;

  if (weak && allowAdvanced && !params._advanced_retry) {
    console.warn('[tavily_open_web] escalating_to_advanced', JSON.stringify({ query_hash: queryHash }));
    const advancedOut = await executeTavilyOpenWebSearch(
      env,
      {
        ...params,
        search_depth: 'advanced',
        _advanced_retry: true,
        _prior_weak: true,
      },
      runContext,
    );
    if (!advancedOut?.error) return advancedOut;
  }

  if (searchDepth === 'advanced') {
    console.warn(
      '[tavily_open_web] advanced_search_credit_risk',
      JSON.stringify({ query_hash: queryHash, estimated_credits: TAVILY_DEFAULTS.advanced_credit_estimate }),
    );
  }

  budget.turnCalls += 1;
  budget.runCalls += 1;

  const resultCount = Array.isArray(trimmed.results) ? trimmed.results.length : 0;
  const payload = {
    ...trimmed,
    lane: 'open_web_search',
    provider: resolveOpenWebBackendLabel(env),
    cache_hit: false,
    telemetry: {
      ...baseTelemetry,
      search_depth: searchDepth,
      estimated_credits:
        searchDepth === 'advanced'
          ? TAVILY_DEFAULTS.advanced_credit_estimate
          : TAVILY_DEFAULTS.basic_credit_estimate,
      duration_ms: durationMs,
      result_count: resultCount,
      success: true,
    },
  };

  if (workspaceId) {
    await writeTavilyToolCache(env, {
      workspaceId,
      tenantId,
      toolInput: tavilyToolInput,
      body: payload,
      durationMs,
      agentRunId,
    });
  }

  return payload;
}

/**
 * Provider-native web search is catalog-detectable but not dispatched yet.
 */
export function isProviderNativeWebSearchImplemented() {
  return PROVIDER_NATIVE_WEB_SEARCH_IMPLEMENTED;
}

/**
 * @param {any} env
 * @param {{ modelKey?: string|null, tenantId?: string|null }} [opts]
 */
export async function resolveOpenWebSearchBackend(env, opts = {}) {
  const modelKey = opts.modelKey != null ? String(opts.modelKey).trim() : '';
  let providerNativeDetected = false;

  if (PROVIDER_NATIVE_WEB_SEARCH_IMPLEMENTED && env?.DB && modelKey && modelKey !== 'auto') {
    try {
      const row = await env.DB.prepare(
        `SELECT supports_web_search, provider, api_platform
         FROM agentsam_ai WHERE model_key = ? AND status = 'active' LIMIT 1`,
      )
        .bind(modelKey)
        .first();
      if (Number(row?.supports_web_search) === 1) {
        return {
          available: true,
          tier: 'provider_native',
          provider: row?.provider ?? row?.api_platform ?? null,
          open_web_backend: 'provider_native',
          provider_native_detected: true,
        };
      }
      providerNativeDetected = Number(row?.supports_web_search) === 1;
    } catch (_) {
      /* non-fatal */
    }
  } else if (env?.DB && modelKey && modelKey !== 'auto') {
    try {
      const row = await env.DB.prepare(
        `SELECT supports_web_search FROM agentsam_ai WHERE model_key = ? AND status = 'active' LIMIT 1`,
      )
        .bind(modelKey)
        .first();
      providerNativeDetected = Number(row?.supports_web_search) === 1;
    } catch (_) {
      /* non-fatal */
    }
  }

  const label = resolveOpenWebBackendLabel(env);
  if (label === 'tavily' || label === 'search_api') {
    return {
      available: true,
      tier: label,
      provider: label,
      open_web_backend: label,
      provider_native_detected: providerNativeDetected,
    };
  }

  return {
    available: false,
    tier: 'none',
    provider: null,
    open_web_backend: 'none',
    provider_native_detected: providerNativeDetected,
  };
}
