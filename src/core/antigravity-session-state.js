/**
 * Persist Antigravity interaction + environment ids per workspace (multi-turn sandbox resume).
 */

function safeParseJson(raw) {
  if (!raw || typeof raw !== 'string') return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/**
 * @param {unknown} env
 * @param {string} workspaceId
 * @returns {Promise<{ interactionId: string|null, environmentId: string|null }>}
 */
export async function loadAntigravitySessionState(env, workspaceId) {
  const ws = String(workspaceId || '').trim();
  if (!env?.DB || !ws) return { interactionId: null, environmentId: null };

  const row = await env.DB.prepare(
    `SELECT state_json FROM agentsam_workspace_state
     WHERE workspace_id = ?
     ORDER BY updated_at DESC LIMIT 1`,
  )
    .bind(ws)
    .first()
    .catch(() => null);

  const state = safeParseJson(row?.state_json != null ? String(row.state_json) : '');
  const ag = state?.antigravity && typeof state.antigravity === 'object' ? state.antigravity : {};
  return {
    interactionId: ag.interaction_id ? String(ag.interaction_id).trim() : null,
    environmentId: ag.environment_id ? String(ag.environment_id).trim() : null,
  };
}

/**
 * @param {unknown} env
 * @param {string} workspaceId
 * @param {{ interactionId?: string|null, environmentId?: string|null }} patch
 */
export async function saveAntigravitySessionState(env, workspaceId, patch) {
  const ws = String(workspaceId || '').trim();
  if (!env?.DB || !ws) return;

  const row = await env.DB.prepare(
    `SELECT id, state_json FROM agentsam_workspace_state
     WHERE workspace_id = ?
     ORDER BY updated_at DESC LIMIT 1`,
  )
    .bind(ws)
    .first()
    .catch(() => null);

  const state = safeParseJson(row?.state_json != null ? String(row.state_json) : '');
  const prev = state.antigravity && typeof state.antigravity === 'object' ? state.antigravity : {};
  state.antigravity = {
    ...prev,
    ...(patch.interactionId ? { interaction_id: patch.interactionId } : {}),
    ...(patch.environmentId ? { environment_id: patch.environmentId } : {}),
    updated_at: new Date().toISOString(),
  };

  const json = JSON.stringify(state);
  if (row?.id) {
    await env.DB.prepare(
      `UPDATE agentsam_workspace_state SET state_json = ?, updated_at = unixepoch() WHERE id = ?`,
    )
      .bind(json, row.id)
      .run()
      .catch((e) => console.warn('[antigravity-session] save', e?.message ?? e));
    return;
  }

  const id = `aws_ag_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await env.DB.prepare(
    `INSERT INTO agentsam_workspace_state (id, workspace_id, state_json, workspace_type, created_at, updated_at)
     VALUES (?, ?, ?, 'platform', unixepoch(), unixepoch())`,
  )
    .bind(id, ws, json)
    .run()
    .catch((e) => console.warn('[antigravity-session] insert', e?.message ?? e));
}
