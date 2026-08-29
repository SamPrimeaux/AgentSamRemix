// guard-dup-allow: backend spawn peel; interactive profile compiler migrates separately.
/**
 * Backend-only runtime profile compiler for asynchronous child lanes.
 *
 * This is intentionally narrower than the interactive chat compiler: the
 * caller supplies the lane role and optional model pin, while D1 owns the
 * tool profile, runtime ceilings, and model selection.
 */

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function jsonObject(raw, fallback = {}) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const value = JSON.parse(String(raw || ''));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function toolKeys(raw) {
  let parsed = Array.isArray(raw) ? raw : null;
  if (!parsed && typeof raw === 'string' && raw.trim()) {
    try {
      const value = JSON.parse(raw);
      if (Array.isArray(value)) parsed = value;
    } catch {
      parsed = null;
    }
  }
  if (Array.isArray(parsed)) return parsed.map(trim).filter(Boolean);
  return [];
}

function toolsManifest(rows) {
  return (rows || []).map((row) => {
    const name = trim(row.tool_name || row.tool_key);
    const schema = jsonObject(row.input_schema, { type: 'object', properties: {} });
    return {
      name,
      description: trim(row.description) || name,
      input_schema: { ...schema, type: 'object' },
      tool_category: trim(row.tool_category) || 'builtin',
      requires_approval: Number(row.requires_approval) === 1,
      tool_key: trim(row.tool_key),
      capability_key: trim(row.capability_key),
    };
  }).filter((row) => row.name);
}

async function resolveToolProfile(env, mode, override) {
  const requested = trim(override);
  if (requested) return requested;
  const row = await env?.DB?.prepare(
    `SELECT profile_key FROM agentsam_tool_profile_bindings
      WHERE task_type = ? AND COALESCE(is_active, 1) = 1
      ORDER BY COALESCE(priority, 50) ASC LIMIT 1`,
  ).bind(mode).first().catch(() => null);
  return trim(row?.profile_key) || mode;
}

async function loadCompiledTools(env, profileKey, maxTools) {
  if (!env?.DB || !profileKey || maxTools <= 0) return { rows: [], profile: null };
  const profile = await env.DB.prepare(
    `SELECT profile_key, tool_keys_json, max_tools, write_policy_json, runtime_policy_json
       FROM agentsam_tool_profiles
      WHERE profile_key = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
  ).bind(profileKey).first().catch(() => null);
  const keys = toolKeys(profile?.tool_keys_json);
  if (!keys.length) return { rows: [], profile };
  const placeholders = keys.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT tool_key, tool_name, description, input_schema, tool_category,
            capability_key, requires_approval
       FROM agentsam_tools
      WHERE COALESCE(is_active, 1) = 1 AND COALESCE(is_degraded, 0) = 0
        AND (lower(tool_key) IN (${placeholders}) OR lower(tool_name) IN (${placeholders}))
      LIMIT ?`,
  ).bind(
    ...keys.map((key) => key.toLowerCase()),
    ...keys.map((key) => key.toLowerCase()),
    Math.max(1, Math.floor(maxTools)),
  ).all().catch(() => ({ results: [] }));
  const byKey = new Map((rows.results || []).map((row) => [
    trim(row.tool_key || row.tool_name).toLowerCase(),
    row,
  ]));
  const ordered = [];
  for (const key of keys) {
    const row = byKey.get(key.toLowerCase());
    if (row) ordered.push(row);
  }
  return { rows: toolsManifest(ordered).slice(0, maxTools), profile };
}

async function resolveModel(env, workspaceId, tenantId, requestedModel, mode) {
  const requested = trim(requestedModel);
  let arm = null;
  if (!requested) {
    arm = await env.DB.prepare(
      `SELECT id, model_key, provider
         FROM agentsam_routing_arms
        WHERE COALESCE(is_active, 1) = 1
          AND COALESCE(is_eligible, 1) = 1
          AND COALESCE(is_paused, 0) = 0
          AND COALESCE(budget_exhausted, 0) = 0
          AND (workspace_id IS NULL OR workspace_id = ?)
          AND (mode = ? OR mode IS NULL)
        ORDER BY CASE WHEN workspace_id = ? THEN 0 ELSE 1 END, id ASC
        LIMIT 1`,
    ).bind(workspaceId, mode, workspaceId).first().catch(() => null);
  }
  const modelKey = requested || trim(arm?.model_key);
  if (!modelKey) return { model_key: null, selected_provider: null, routing_arm_id: null };
  const catalog = await env.DB.prepare(
    `SELECT model_key, provider, supports_tools
       FROM agentsam_model_catalog
      WHERE model_key = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
  ).bind(modelKey).first().catch(() => null);
  if (!catalog?.model_key) {
    if (requested) return { model_key: requested, selected_provider: null, routing_arm_id: null };
    return { model_key: null, selected_provider: null, routing_arm_id: null };
  }
  return {
    model_key: trim(catalog.model_key),
    selected_provider: trim(catalog.provider) || trim(arm?.provider) || null,
    routing_arm_id: trim(arm?.id) || null,
  };
}

export async function resolveRuntimeProfile(env, input = {}) {
  const mode = trim(input.mode).toLowerCase() || 'agent';
  const session = input.session || {};
  const overrides = input.overrides || {};
  const workspaceId = trim(session.workspaceId);
  const tenantId = trim(session.tenantId);
  const userId = trim(session.userId);
  const profileKey = await resolveToolProfile(env, mode, overrides.tool_profile_key);
  const profileRow = await env?.DB?.prepare(
    `SELECT max_tools, runtime_policy_json, write_policy_json
       FROM agentsam_tool_profiles
      WHERE profile_key = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
  ).bind(profileKey).first().catch(() => null);
  const runtime = jsonObject(profileRow?.runtime_policy_json);
  const maxTools = Math.max(0, Math.floor(Number(profileRow?.max_tools) || 0));
  const compiled = await loadCompiledTools(env, profileKey, maxTools);
  const model = await resolveModel(
    env,
    workspaceId,
    tenantId,
    overrides.model_key,
    mode,
  );
  const allowlist = compiled.rows.map((row) => row.name);
  return {
    mode,
    mode_controller: `${mode}_controller`,
    profile_id: `mode_${mode}@${profileKey}`,
    profile_hash: '',
    system_prompt_key: mode,
    prompt_layers: [mode],
    tool_allowlist: allowlist,
    tool_denylist: [],
    tool_require_approval: [],
    tool_policy: {
      allowlist,
      denylist: [],
      require_approval: [],
      max_tool_calls: Math.floor(Number(runtime.max_tool_calls) || 0),
      max_runtime_ms: Math.floor(Number(runtime.max_runtime_ms) || 0),
    },
    max_tools: maxTools,
    max_tool_calls: Math.floor(Number(runtime.max_tool_calls) || 0),
    max_turns: Math.floor(Number(runtime.max_turns) || 0),
    max_runtime_ms: Math.floor(Number(runtime.max_runtime_ms) || 0),
    write_policy: jsonObject(profileRow?.write_policy_json),
    routing_task_type: mode,
    model_key: model.model_key,
    routing_arm_id: model.routing_arm_id,
    selected_provider: model.selected_provider,
    temperature: Number.isFinite(Number(runtime.temperature)) ? Number(runtime.temperature) : null,
    parallel_policy: { enabled: false, execution_enabled: false, max_subagents: 0 },
    refined_route_key: mode,
    tool_profile: profileKey,
    tool_capable_required: allowlist.length > 0,
    _compiled_tool_rows: compiled.rows,
    _prompt_route_row: null,
    _runtime_policy: runtime,
    source: { d1_tool_profile_key: profileKey, user_id: userId, workspace_id: workspaceId },
  };
}

export function toolsManifestFromCompiledRows(rows) {
  return Array.isArray(rows) ? rows : [];
}
