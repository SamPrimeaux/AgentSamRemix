/**
 * Mutable per-user/workspace Agent Sam policy stored in D1.
 * Identity owns loading/default normalization; Agent Sam consumes the resolved policy.
 */

export const DEFAULT_USER_POLICY = Object.freeze({
  auto_run_mode: 'allowlist',
  mcp_tools_protection: 1,
  file_deletion_protection: 1,
  external_file_protection: 1,
  require_allowlist_for_mcp: 0,
  tool_risk_level_max: 'high',
  allow_subagent_spawn: 0,
  allow_fanout_execution: 0,
  max_tool_chain_depth: 15,
  max_spawn_depth: 2,
  max_cost_per_call_usd: null,
  max_cost_per_session_usd: null,
  legacy_terminal_tool: 1,
  can_run_pty: 0,
});

/** Grant-based approval lanes only — legacy `auto` collapses to allowlist. */
export function normalizeAutoRunMode(mode) {
  const m = String(mode || '').trim().toLowerCase();
  if (m === 'manual' || m === 'disabled') return 'manual';
  return 'allowlist';
}

/** Read one user's policy for one workspace. No person-class/operator override. */
export async function loadAgentSamUserPolicy(env, userId, workspaceId = '') {
  const uid = String(userId || '').trim();
  const ws = String(workspaceId || '').trim();
  if (!env?.DB || !uid) return { ...DEFAULT_USER_POLICY };

  const finalize = (policy) => ({
    ...DEFAULT_USER_POLICY,
    ...(policy || {}),
    auto_run_mode: normalizeAutoRunMode(policy?.auto_run_mode),
  });

  const fullSql = `SELECT auto_run_mode, mcp_tools_protection, file_deletion_protection, external_file_protection,
              COALESCE(require_allowlist_for_mcp, 0) AS require_allowlist_for_mcp,
              COALESCE(tool_risk_level_max, 'high') AS tool_risk_level_max,
              COALESCE(allow_subagent_spawn, 1) AS allow_subagent_spawn,
              COALESCE(allow_fanout_execution, 0) AS allow_fanout_execution,
              COALESCE(max_tool_chain_depth, 15) AS max_tool_chain_depth,
              COALESCE(max_spawn_depth, 2) AS max_spawn_depth,
              max_cost_per_call_usd, max_cost_per_session_usd,
              COALESCE(legacy_terminal_tool, 1) AS legacy_terminal_tool,
              COALESCE(can_run_pty, 0) AS can_run_pty
       FROM agentsam_user_policy WHERE user_id = ? AND workspace_id = ? LIMIT 1`;
  const legacySql = `SELECT auto_run_mode, mcp_tools_protection, file_deletion_protection, external_file_protection
       FROM agentsam_user_policy WHERE user_id = ? AND workspace_id = ? LIMIT 1`;

  try {
    const row = await env.DB.prepare(fullSql).bind(uid, ws).first();
    return finalize(row);
  } catch {
    try {
      const row = await env.DB.prepare(legacySql).bind(uid, ws).first();
      return finalize(row);
    } catch {
      return finalize(null);
    }
  }
}
