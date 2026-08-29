/**
 * D1-owned tool profiles (ROUTING-TOOL-SSOT).
 *
 * Diagnostic law: new task_type → INSERT agentsam_tool_profile_bindings row (no deploy).
 * New tools on a profile → UPDATE agentsam_tool_profiles.tool_keys_json (no deploy).
 * JS *-tool-profile.js / resolveD1ToolProfileKey cold-start only when D1 empty.
 */
import { resolveCatalogDispatchToolKey } from './catalog-tool-key-resolve.js';
import { materializeWritePolicyFlags } from '../../shared/agent-runtime/tool-capability-policy.js';

/**
 * Was: exclusive pin lock that blocked oauth catalog fallback (starved GitHub/CF).
 * Emptied — D1 profile pins are optional telemetry, not an exclusive menu.
 * @type {Set<string>}
 */
export const PINNED_PROFILE_KEYS = new Set();

/** @type {Map<string, string>|null} */
let _bindingsCache = null;
let _bindingsCacheAt = 0;
const BINDINGS_TTL_MS = 60_000;

/**
 * In-app menus are profile-owned. OAuth parity must be explicitly requested
 * by MCP/catalog discovery callers.
 * @param {{ mcpOAuthParity?: boolean|null, routeKey?: string|null, routeKeyPin?: string|null, mode?: string|null }} input
 */
export function resolveUseOAuthParity(input) {
  return input?.mcpOAuthParity === true;
}

/**
 * @param {string|null|undefined} raw
 * @returns {Record<string, unknown>}
 */
export function parseWritePolicyJson(raw) {
  if (!raw) return materializeWritePolicyFlags({});
  try {
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return materializeWritePolicyFlags({});
    }
    return materializeWritePolicyFlags(parsed);
  } catch {
    return materializeWritePolicyFlags({});
  }
}

/**
 * Runtime ceilings + debug_policy from agentsam_tool_profiles.runtime_policy_json.
 * Missing/empty → fail closed (0 / null) — never invent 15/90000/0.7 in JS.
 * @param {unknown} raw
 * @returns {{
 *   max_tool_calls: number,
 *   max_turns: number,
 *   max_runtime_ms: number,
 *   temperature: number|null,
 *   debug_policy: Record<string, unknown>|null,
 * }}
 */
export function parseRuntimePolicyJson(raw) {
  /** @type {Record<string, unknown>} */
  let parsed = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    parsed = /** @type {Record<string, unknown>} */ (raw);
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const j = JSON.parse(raw);
      if (j && typeof j === 'object' && !Array.isArray(j)) parsed = j;
    } catch {
      parsed = {};
    }
  }

  const numOrZero = (v) => {
    if (v == null || String(v).trim() === '') return 0;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  let temperature = null;
  if (parsed.temperature != null && String(parsed.temperature).trim() !== '') {
    const t = Number(parsed.temperature);
    temperature = Number.isFinite(t) ? t : null;
  }

  let debugPolicy = null;
  const rawDebug = parsed.debug_policy;
  if (rawDebug && typeof rawDebug === 'object' && !Array.isArray(rawDebug)) {
    const d = /** @type {Record<string, unknown>} */ (rawDebug);
    debugPolicy = {
      evidence_required_before_write:
        d.evidence_required_before_write === true ||
        d.evidence_required_before_write === 1 ||
        Number(d.evidence_required_before_write) === 1,
      evidence_required_before_deploy:
        d.evidence_required_before_deploy === true ||
        d.evidence_required_before_deploy === 1 ||
        Number(d.evidence_required_before_deploy) === 1,
      phase: d.phase != null && String(d.phase).trim() !== '' ? String(d.phase).trim() : 'hypothesize',
    };
  }

  return {
    max_tool_calls: Math.floor(numOrZero(parsed.max_tool_calls)),
    max_turns: Math.floor(numOrZero(parsed.max_turns)),
    max_runtime_ms: Math.floor(numOrZero(parsed.max_runtime_ms)),
    agent_run_hard_timeout_ms: Math.floor(numOrZero(parsed.agent_run_hard_timeout_ms)),
    agent_run_target_ms: Math.floor(numOrZero(parsed.agent_run_target_ms)),
    hard_timeout_ms: Math.floor(numOrZero(parsed.hard_timeout_ms)),
    temperature,
    debug_policy: debugPolicy,
  };
}

/**
 * Load task_type → profile_key from D1 (cached briefly per isolate).
 * @param {unknown} env
 * @returns {Promise<Map<string, string>>}
 */
export async function loadToolProfileBindingsMap(env) {
  const now = Date.now();
  if (_bindingsCache && now - _bindingsCacheAt < BINDINGS_TTL_MS) {
    return _bindingsCache;
  }
  /** @type {Map<string, string>} */
  const map = new Map();
  if (!env?.DB) {
    _bindingsCache = map;
    _bindingsCacheAt = now;
    return map;
  }
  try {
    const { results } = await env.DB.prepare(
      `SELECT task_type, profile_key
       FROM agentsam_tool_profile_bindings
       WHERE COALESCE(is_active, 1) = 1
       ORDER BY priority ASC`,
    ).all();
    for (const row of results || []) {
      const tt = String(row.task_type || '')
        .trim()
        .toLowerCase();
      const pk = String(row.profile_key || '')
        .trim()
        .toLowerCase();
      if (tt && pk && !map.has(tt)) map.set(tt, pk);
    }
  } catch (e) {
    console.warn('[d1-tool-profile] bindings_load_failed', e?.message ?? e);
  }
  _bindingsCache = map;
  _bindingsCacheAt = now;
  return map;
}

/** Test/helper — clear bindings cache */
export function clearToolProfileBindingsCache() {
  _bindingsCache = null;
  _bindingsCacheAt = 0;
}

/**
 * Load force_first_tool for a task_type (MCP Optimization Spec §6.1).
 * @param {unknown} env
 * @param {string|null|undefined} taskType
 * @returns {Promise<string|null>}
 */
export async function loadForceFirstToolForTask(env, taskType) {
  const tt = String(taskType || '')
    .trim()
    .toLowerCase();
  if (!tt || !env?.DB?.prepare) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT force_first_tool FROM agentsam_tool_profile_bindings
        WHERE task_type = ? AND COALESCE(is_active, 1) = 1
        ORDER BY priority ASC LIMIT 1`,
    )
      .bind(tt)
      .first();
    const v = String(row?.force_first_tool || '').trim();
    return v || null;
  } catch {
    return null;
  }
}

/**
 * Map task_type → D1 profile_key.
 * Law: classifier/task_type → agentsam_tool_profile_bindings only.
 * No JS shouldUse* heuristics. No task_type→profile synonym tables in code.
 * Explicit taskSpec.toolProfile / subagent pin remain; route_key alone does not invent cms.
 *
 * @param {unknown} env
 * @param {{
 *   taskSpec?: { toolProfile?: string|null }|null,
 *   taskType?: string|null,
 *   routeKey?: string|null,
 *   routeKeyPin?: string|null,
 *   mode?: string|null,
 * }} ctx
 * @returns {Promise<{ profileKey: string, source: 'd1_binding'|'task_spec'|'subagent_tool_profile_key'|'d1_unbound' }>}
 */
export async function resolveD1ToolProfileKey(env, ctx) {
  const tt = String(ctx.taskType || '')
    .trim()
    .toLowerCase();
  const mode = String(ctx.mode || '')
    .trim()
    .toLowerCase();
  const rk = String(ctx.routeKeyPin || ctx.routeKey || '')
    .trim()
    .toLowerCase();

  // Chosen subagent profile pin wins — never remap to a mode/task preset.
  const subagentPin = String(ctx.toolProfilePin || ctx.tool_profile_key || '')
    .trim()
    .toLowerCase();
  if (subagentPin) {
    return { profileKey: subagentPin, source: 'subagent_tool_profile_key' };
  }

  // Surface pin: CMS studio writable turns.
  // cms_edit is not a chat-agent task/profile pin — do not force that menu from route_key.

  // Bindings table column is still named task_type, but composer rows are mode keys
  // (agent/ask/plan/…). Prefer mode; accept legacy tt only when it matches a binding.
  const bindings = await loadToolProfileBindingsMap(env);
  if (mode && bindings.has(mode)) {
    return { profileKey: /** @type {string} */ (bindings.get(mode)), source: 'd1_binding' };
  }
  if (tt && tt !== mode && bindings.has(tt)) {
    return { profileKey: /** @type {string} */ (bindings.get(tt)), source: 'd1_binding' };
  }

  // Temporary bridge: TaskSpec toolProfile only when mode/tt unbound.
  const tp = String(ctx.taskSpec?.toolProfile || '')
    .trim()
    .toLowerCase();
  if (tp && tp !== 'image' && tp !== 'exempt' && tp !== 'oauth_parity') {
    return { profileKey: tp, source: 'task_spec' };
  }

  // Bindings loaded but mode unbound → fail closed to ask (power-safe).
  if (bindings.size > 0) {
    console.warn(
      '[d1-tool-profile] mode_unbound',
      JSON.stringify({ mode: mode || null, task_type: tt || null, route_key: rk || null }),
    );
    return { profileKey: 'ask', source: 'd1_unbound' };
  }

  // Bindings table empty/unavailable — power contract only, not toolbox inventing.
  console.warn('[d1-tool-profile] bindings_empty_fail_closed', JSON.stringify({ mode }));
  if (mode === 'plan') return { profileKey: 'plan', source: 'd1_unbound' };
  return { profileKey: 'ask', source: 'd1_unbound' };
}

/**
 * @param {unknown} env
 * @param {string} profileKey
 */
export async function loadToolProfileRow(env, profileKey) {
  const key = String(profileKey || '').trim();
  if (!env?.DB || !key) return null;
  try {
    return await env.DB.prepare(
      `SELECT id, profile_key, display_name, tool_keys_json, max_tools, default_deny_oauth,
              write_policy_json, runtime_policy_json, notes, is_active
       FROM agentsam_tool_profiles
       WHERE profile_key = ? AND COALESCE(is_active, 1) = 1
       LIMIT 1`,
    )
      .bind(key)
      .first();
  } catch (e) {
    // Pre-migration 1150: column may be missing — load without ceilings (fail closed to 0).
    const msg = String(e?.message || e || '');
    if (!/runtime_policy_json/i.test(msg)) return null;
    try {
      return await env.DB.prepare(
        `SELECT id, profile_key, display_name, tool_keys_json, max_tools, default_deny_oauth,
                write_policy_json, notes, is_active
         FROM agentsam_tool_profiles
         WHERE profile_key = ? AND COALESCE(is_active, 1) = 1
         LIMIT 1`,
      )
        .bind(key)
        .first();
    } catch {
      return null;
    }
  }
}

/**
 * @param {string|null|undefined} raw
 * @returns {string[]}
 */
export function parseToolProfileKeysJson(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed.map((k) => String(k).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Compile catalog rows from an ordered pin list.
 * @param {unknown} env
 * @param {{ workspaceId?: string|null }} scope
 * @param {string[]} pinnedKeys
 * @param {number} maxTools
 */
export async function compilePinnedToolKeysToRows(env, scope, pinnedKeys, maxTools) {
  const cap = Math.max(1, Math.min(32, Number(maxTools) || 12));
  const { listAgentsamToolsByKeys, mapCatalogRowsToAgentTools } = await import(
    './agentsam-tools-catalog.js'
  );
  const { mapCatalogRowsToMcpParityAgentTools } = await import('./in-app-mcp-oauth-parity.js');

  const resolvedPins = [
    ...new Set(pinnedKeys.map((k) => resolveCatalogDispatchToolKey(k) || k).filter(Boolean)),
  ];

  const rawPinned = await listAgentsamToolsByKeys(
    env,
    new Set(resolvedPins.map((k) => k.toLowerCase())),
    {
      workspaceId: scope.workspaceId,
      limit: Math.max(resolvedPins.length, cap),
    },
  );

  const byKey = new Map();
  for (const r of rawPinned || []) {
    const kn = String(r.tool_name || r.tool_key || '')
      .trim()
      .toLowerCase();
    if (kn) byKey.set(kn, r);
    const kk = String(r.tool_key || '')
      .trim()
      .toLowerCase();
    if (kk) byKey.set(kk, r);
  }

  const orderedCatalog = [];
  const seenKeys = new Set();
  for (const key of resolvedPins) {
    const row = byKey.get(String(key).trim().toLowerCase());
    if (!row) continue;
    const id = String(row.tool_name || row.tool_key || '')
      .trim()
      .toLowerCase();
    if (!id || seenKeys.has(id)) continue;
    seenKeys.add(id);
    orderedCatalog.push(row);
  }

  let rows = mapCatalogRowsToMcpParityAgentTools(orderedCatalog);
  if (!rows.length) rows = mapCatalogRowsToAgentTools(orderedCatalog);
  rows = rows.slice(0, cap);

  return {
    rows,
    pinned_count: orderedCatalog.length,
    total: rows.length,
    missingPinned: resolvedPins.filter((k) => !seenKeys.has(String(k).trim().toLowerCase())),
  };
}

/**
 * Compile pinned tool rows for a D1 profile.
 * Cap SSOT: agentsam_tool_profiles.max_tools. opts.maxTools may only tighten.
 * Menus are D1-only (agentsam_tool_profiles.tool_keys_json). No JS pin lists / jsFallback.
 *
 * @param {unknown} env
 * @param {{ userId: string, tenantId?: string|null, workspaceId?: string|null, isSuperadmin?: boolean }} scope
 * @param {{
 *   profileKey: string,
 *   maxTools?: number|null,
 *   taskType?: string|null,
 *   modeSlug?: string|null,
 *   message?: string|null,
 *   routeToolRequirements?: import('./agentsam-route-tool-resolver.js').RouteToolRequirements|null,
 * }} opts
 */
export async function compileD1ToolProfileRows(env, scope, opts) {
  const profileKey = String(opts.profileKey || '').trim();
  const d1Row = await loadToolProfileRow(env, profileKey);
  const profileMaxRaw = d1Row?.max_tools;
  const profileMax =
    profileMaxRaw != null && String(profileMaxRaw).trim() !== '' && Number.isFinite(Number(profileMaxRaw))
      ? Math.floor(Number(profileMaxRaw))
      : null;
  const requestTighten =
    opts.maxTools != null && String(opts.maxTools).trim() !== '' && Number.isFinite(Number(opts.maxTools))
      ? Math.floor(Number(opts.maxTools))
      : null;

  /** @type {number} */
  let maxTools;
  if (profileMax === 0 || requestTighten === 0) {
    maxTools = 0;
  } else if (profileMax != null && profileMax > 0) {
    maxTools =
      requestTighten != null && requestTighten > 0
        ? Math.min(profileMax, requestTighten)
        : profileMax;
  } else if (requestTighten != null && requestTighten > 0) {
    maxTools = requestTighten;
  } else {
    // Missing profile max_tools → fail closed (no invent 12/20/32).
    console.warn(
      '[d1-tool-profile] profile_max_tools_missing_fail_closed',
      JSON.stringify({ profile_key: profileKey }),
    );
    maxTools = 0;
  }

  const pinnedKeys = parseToolProfileKeysJson(d1Row?.tool_keys_json);
  const writePolicy = parseWritePolicyJson(d1Row?.write_policy_json);

  // Fail loud: empty / missing profile → no tools (never JS menu, never default_route→ask).
  if (!pinnedKeys.length || maxTools <= 0) {
    if (!pinnedKeys.length) {
      console.warn(
        '[d1-tool-profile] profile_empty_no_fallback',
        JSON.stringify({
          profile_key: profileKey,
          d1_row: !!d1Row,
          reason: d1Row ? 'empty_tool_keys_json' : 'profile_missing',
        }),
      );
    }
    return {
      rows: [],
      missingPinned: [],
      pinned_count: pinnedKeys.length,
      total: 0,
      source: maxTools <= 0 && pinnedKeys.length ? 'd1_profile_max_tools_zero' : 'd1_profile_empty',
      profile_key: profileKey,
      d1_row_id: d1Row?.id ?? null,
      write_policy: writePolicy,
      d1_row: d1Row,
    };
  }

  let result = await compilePinnedToolKeysToRows(env, scope, pinnedKeys, maxTools);

  // When the user names a catalog tool (e.g. agentsam_github_tree), pin only those
  // tools (drop d1 + siblings) so mini/nano cannot hallucinate a wrong call.
  const explicitKeys = []; /* message catalog pin removed */
  if (explicitKeys.length && result.rows?.length) {
    const byName = new Map(
      result.rows.map((r) => {
        const n = String(r.name || r.tool_key || r.tool_name || '')
          .trim()
          .toLowerCase();
        return [n, r];
      }),
    );
    /** @type {typeof result.rows} */
    const ordered = [];
    const seen = new Set();
    for (const k of explicitKeys) {
      const row = byName.get(k);
      if (row && !seen.has(k)) {
        ordered.push(row);
        seen.add(k);
      }
    }
    const pinOnly = explicitKeys.some((k) => k.startsWith('agentsam_github_') || k.startsWith('fs_'));
    if (pinOnly && ordered.length) {
      result = {
        ...result,
        rows: ordered.slice(0, maxTools),
        total: Math.min(ordered.length, maxTools),
      };
    } else {
      const dropD1 = pinOnly;
      for (const r of result.rows) {
        const n = String(r.name || r.tool_key || r.tool_name || '')
          .trim()
          .toLowerCase();
        if (!n || seen.has(n)) continue;
        if (dropD1 && (n === 'agentsam_d1_query' || n === 'd1_query')) continue;
        ordered.push(r);
        seen.add(n);
      }
      result = {
        ...result,
        rows: ordered.slice(0, maxTools),
        total: Math.min(ordered.length, maxTools),
      };
    }
  }

  // Exclusive ceiling: tool_keys_json is the menu. No JS pad into other lanes.

  if (result.missingPinned?.length) {
    console.warn(
      '[d1-tool-profile] missing_pinned_catalog',
      JSON.stringify({ profile_key: profileKey, missing: result.missingPinned }),
    );
  }

  return {
    ...result,
    source: 'd1_tool_profile',
    profile_key: profileKey,
    d1_row_id: d1Row?.id ?? null,
    write_policy: writePolicy,
    d1_row: d1Row,
  };
}

/**
 * Mode runtime ceilings from agentsam_tool_profiles (via task_type binding).
 * Replaces the old agent.js stub that invented max_tool_calls=15 for every caller.
 * Missing/empty runtime_policy_json → fail closed (0 / null) — never invent ceilings in JS.
 *
 * @param {any} env
 * @param {string} [modeSlug]
 * @param {string|null} [workspaceId] reserved (workspace overrides not used yet)
 * @returns {Promise<{
 *   slug: string,
 *   profile_key: string|null,
 *   temperature: number|null,
 *   auto_run: number,
 *   max_tool_calls: number,
 *   max_runtime_ms: number,
 *   max_turns: number,
 *   max_tools: number,
 *   system_prompt_fragment: null,
 *   context_strategy: null,
 *   tool_policy_json: string|null,
 *   source: string,
 * }>}
 */
export async function loadModeConfig(env, modeSlug = 'agent', workspaceId = null) {
  void workspaceId;
  const slug = String(modeSlug || 'agent').trim().toLowerCase() || 'agent';
  const empty = {
    slug,
    profile_key: null,
    temperature: null,
    auto_run: 0,
    max_tool_calls: 0,
    max_runtime_ms: 0,
    max_turns: 0,
    max_tools: 0,
    system_prompt_fragment: null,
    context_strategy: null,
    tool_policy_json: null,
    source: 'missing_profile',
  };
  if (!env?.DB) return empty;

  try {
    const bound = await env.DB.prepare(
      `SELECT p.profile_key, p.max_tools, p.runtime_policy_json, p.write_policy_json
       FROM agentsam_tool_profile_bindings b
       JOIN agentsam_tool_profiles p ON p.profile_key = b.profile_key AND COALESCE(p.is_active, 1) = 1
       WHERE b.task_type = ? AND COALESCE(b.is_active, 1) = 1
       ORDER BY b.priority ASC
       LIMIT 1`,
    )
      .bind(slug)
      .first();

    let row = bound;
    if (!row) {
      row = await env.DB.prepare(
        `SELECT profile_key, max_tools, runtime_policy_json, write_policy_json
         FROM agentsam_tool_profiles
         WHERE profile_key = 'default_route' AND COALESCE(is_active, 1) = 1
         LIMIT 1`,
      ).first();
    }
    if (!row?.profile_key) {
      console.warn('[d1-tool-profile] loadModeConfig_no_profile', JSON.stringify({ mode: slug }));
      return empty;
    }

    const policy = parseRuntimePolicyJson(row.runtime_policy_json);
    const maxToolsRaw = Number(row.max_tools);
    const maxTools =
      Number.isFinite(maxToolsRaw) && maxToolsRaw > 0 ? Math.floor(maxToolsRaw) : 0;

    if (policy.max_tool_calls <= 0 && policy.max_runtime_ms <= 0) {
      console.warn(
        '[d1-tool-profile] loadModeConfig_runtime_policy_empty',
        JSON.stringify({ mode: slug, profile_key: row.profile_key }),
      );
    }

    return {
      slug,
      profile_key: String(row.profile_key),
      temperature: policy.temperature,
      auto_run: 0,
      max_tool_calls: policy.max_tool_calls,
      max_runtime_ms: policy.max_runtime_ms,
      max_turns: policy.max_turns,
      max_tools: maxTools,
      system_prompt_fragment: null,
      context_strategy: null,
      tool_policy_json:
        row.write_policy_json != null && String(row.write_policy_json).trim() !== ''
          ? String(row.write_policy_json)
          : null,
      source: bound ? 'd1_binding' : 'default_route',
    };
  } catch (e) {
    console.warn('[d1-tool-profile] loadModeConfig_failed', e?.message ?? e);
    return empty;
  }
}
