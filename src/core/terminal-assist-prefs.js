/**
 * Terminal session prefs, AI assist catalogs, and /catalog response.
 */
import { resolvePtyTenantIdForUser } from '../../backend/agentsam/terminal/pty-workspace-paths.js';

export const DEFAULT_TERMINAL_PREFS = {
  terminal_mode: 'shell',
  terminal_ai_enabled: false,
  active_agent_slug: null,
  active_model_key: null,
  assist_modes: ['ask', 'explain', 'error', 'fix'],
};

export function parseTerminalPrefs(json) {
  const base = { ...DEFAULT_TERMINAL_PREFS, assist_modes: [...DEFAULT_TERMINAL_PREFS.assist_modes] };
  try {
    const parsed = JSON.parse(json || '{}');
    if (parsed && typeof parsed === 'object') {
      return { ...base, ...parsed };
    }
  } catch (_) {}
  return base;
}

export async function loadTerminalSessionPrefs(env, sessionId) {
  if (!env?.DB || !sessionId) return parseTerminalPrefs('{}');
  try {
    const row = await env.DB.prepare(
      'SELECT prefs_json FROM terminal_sessions WHERE id = ? LIMIT 1',
    )
      .bind(String(sessionId).trim())
      .first();
    return parseTerminalPrefs(row?.prefs_json);
  } catch (_) {
    return parseTerminalPrefs('{}');
  }
}

export async function saveTerminalSessionPrefs(env, sessionId, prefs, userId, workspaceId) {
  if (!env?.DB || !sessionId || !userId || !workspaceId) return false;
  try {
    const row = await env.DB.prepare(
      'SELECT user_id, workspace_id FROM terminal_sessions WHERE id = ? LIMIT 1',
    )
      .bind(String(sessionId).trim())
      .first();
    if (!row) return false;
    if (String(row.user_id).trim() !== String(userId).trim()) return false;
    if (String(row.workspace_id).trim() !== String(workspaceId).trim()) return false;
    await env.DB.prepare(
      'UPDATE terminal_sessions SET prefs_json = ?, updated_at = unixepoch() WHERE id = ?',
    )
      .bind(JSON.stringify(prefs), String(sessionId).trim())
      .run();
    return true;
  } catch (e) {
    console.warn('[saveTerminalSessionPrefs]', e?.message ?? e);
    return false;
  }
}

export async function userCanUseTerminalAi(env, userId, workspaceId) {
  if (!env?.DB || !userId || !workspaceId) return false;
  try {
    const policy = await env.DB.prepare(
      'SELECT terminal_ai_enabled FROM agentsam_user_policy WHERE user_id = ? AND workspace_id = ? LIMIT 1',
    )
      .bind(String(userId).trim(), String(workspaceId).trim())
      .first();
    return Number(policy?.terminal_ai_enabled) === 1;
  } catch (_) {
    return false;
  }
}

export async function loadTerminalAgentCatalog(env, { userId, workspaceId, tenantId = null }) {
  if (!env?.DB || !userId) return [];
  const uid = String(userId).trim();
  const wid = workspaceId != null ? String(workspaceId).trim() : '';
  try {
    const rows = await env.DB.prepare(
      `SELECT slug, display_name, description, default_model_id
       FROM agentsam_subagent_profile
       WHERE is_active = 1
         AND (
           COALESCE(is_platform_global, 0) = 1
           OR (user_id = ? AND (workspace_id = ? OR workspace_id IS NULL OR workspace_id = ''))
         )
       ORDER BY display_name ASC, slug ASC`,
    )
      .bind(uid, wid)
      .all();
    return rows?.results ?? [];
  } catch (e) {
    console.warn('[loadTerminalAgentCatalog]', e?.message ?? e);
    return [];
  }
}

export async function loadTerminalModelCatalog(env, { userId, workspaceId }) {
  if (!env?.DB) return [];
  let tierMax = 4;
  if (userId && workspaceId) {
    try {
      const policy = await env.DB.prepare(
        'SELECT allowed_model_tier_max FROM agentsam_user_policy WHERE user_id = ? AND workspace_id = ? LIMIT 1',
      )
        .bind(String(userId).trim(), String(workspaceId).trim())
        .first();
      if (policy?.allowed_model_tier_max != null) {
        tierMax = Number(policy.allowed_model_tier_max);
      }
    } catch (_) {}
  }
  const sizeClassTier = { nano: 0, mini: 1, small: 1, standard: 2, medium: 2, pro: 3, large: 3, max: 4, opus: 4 };
  try {
    const rows = await env.DB.prepare(
      `SELECT
         mc.model_key,
         mc.display_name,
         mc.provider,
         0 AS sort_order,
         mc.tier AS size_class,
         mc.context_window,
         mc.max_output_tokens,
         mc.supports_tools,
         mc.supports_streaming,
         mc.supports_json_mode,
         mc.supports_reasoning,
         mc.is_active,
         mc.is_degraded,
         mc.budget_exhausted
       FROM agentsam_model_catalog mc
       WHERE COALESCE(mc.show_in_picker, 0) = 1
         AND mc.model_key IS NOT NULL
         AND COALESCE(mc.is_active, 1) = 1
         AND COALESCE(mc.is_degraded, 0) = 0
         AND COALESCE(mc.budget_exhausted, 0) = 0
       ORDER BY mc.provider ASC, mc.display_name ASC`,
    ).all();
    const results = rows?.results ?? [];
    return results.filter((m) => {
      const sc = m.size_class != null ? String(m.size_class).trim().toLowerCase() : '';
      // Catalog tier names map loosely onto size-class tiers for terminal gating.
      const tierAlias = {
        micro: 'nano',
        flash: 'small',
        standard: 'medium',
        power: 'large',
        reasoning: 'opus',
      };
      const mapped = tierAlias[sc] || sc;
      const tier = mapped && sizeClassTier[mapped] != null ? sizeClassTier[mapped] : 0;
      return tier <= tierMax;
    });
  } catch (e) {
    console.warn('[loadTerminalModelCatalog]', e?.message ?? e);
    return [];
  }
}

/**
 * Validate prefs update against policy + D1 catalogs before persist.
 */
export async function validateTerminalSessionPrefsUpdate(env, { userId, workspaceId, tenantId, prefs }) {
  const next = parseTerminalPrefs(JSON.stringify(prefs));
  if (next.terminal_ai_enabled) {
    const allowed = await userCanUseTerminalAi(env, userId, workspaceId);
    if (!allowed) {
      return { ok: false, error: 'terminal_ai_not_enabled', prefs: null };
    }
  }
  if (next.active_agent_slug) {
    const agents = await loadTerminalAgentCatalog(env, { userId, workspaceId, tenantId });
    if (!agents.some((a) => a.slug === next.active_agent_slug)) {
      return { ok: false, error: 'invalid_agent_slug', prefs: null };
    }
  }
  if (next.active_model_key) {
    const models = await loadTerminalModelCatalog(env, { userId, workspaceId });
    if (!models.some((m) => m.model_key === next.active_model_key)) {
      return { ok: false, error: 'invalid_model_key', prefs: null };
    }
  }
  if (next.terminal_mode === 'agentsam' && !next.terminal_ai_enabled) {
    next.terminal_ai_enabled = true;
  }
  if (next.terminal_mode === 'shell') {
    next.terminal_ai_enabled = false;
  }
  return { ok: true, prefs: next, error: null };
}

async function checkOllamaReachable(env, connection) {
  const url = String(connection?.ollama_url || env?.OLLAMA_URL || '').trim();
  if (!url) return false;
  try {
    const base = url.replace(/\/+$/, '');
    const res = await fetch(`${base}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

/**
 * @param {Record<string, unknown>} env
 * @param {import('./auth.js').AuthUser} authUser
 * @param {string} workspaceId
 * @param {string} targetType — terminal_connections.target_type; required (no invent)
 */
export async function buildTerminalCatalogResponse(env, authUser, workspaceId, targetType, deps = {}) {
  const userId = String(authUser.id).trim();
  const wid = String(workspaceId).trim();
  const aiAllowed = await userCanUseTerminalAi(env, userId, wid);
  const tenantId = await resolvePtyTenantIdForUser(env, authUser, userId);
  let resolvedTargetType;
  try {
    resolvedTargetType = deps.requireTerminalConnectionTargetType(targetType);
  } catch (e) {
    return {
      ok: false,
      error: e?.code || e?.message || 'target_type_required',
      user_id: userId,
      workspace_id: wid,
    };
  }
  const sel = await deps.getSelectedTerminalConnection?.(env.DB, {
    userId,
    workspaceId: wid,
    tenantId,
    targetType: resolvedTargetType,
  });
  const ollamaReachable = await checkOllamaReachable(env, sel.connection);
  const agents = aiAllowed
    ? await loadTerminalAgentCatalog(env, { userId, workspaceId: wid, tenantId })
    : [];
  const models = aiAllowed ? await loadTerminalModelCatalog(env, { userId, workspaceId: wid }) : [];
  return {
    ai_allowed: aiAllowed,
    ai_enabled_default: false,
    agents,
    models,
    ollama_reachable: ollamaReachable,
  };
}
