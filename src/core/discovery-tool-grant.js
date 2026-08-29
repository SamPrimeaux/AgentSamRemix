/**
 * Discovery-tool grant on approval — persist into agentsam_mcp_allowlist
 * using the same column set as settings-agents / mcp-tool-preference writers.
 */

/**
 * @param {unknown} inputJson
 * @returns {boolean}
 */
export function approvalWantsDiscoveryGrant(inputJson) {
  try {
    const raw =
      typeof inputJson === 'string'
        ? JSON.parse(inputJson || '{}')
        : inputJson && typeof inputJson === 'object'
          ? inputJson
          : {};
    return raw?.grant_on_approval === true;
  } catch {
    return false;
  }
}

/**
 * Profile allowlist miss for a hydrated discovery tool → approve-to-grant
 * instead of hard block.
 *
 * @param {{ matched?: boolean, hydratedNames?: unknown, toolName?: unknown }} opts
 * @returns {'already_granted'|'needs_grant_approval'|'hard_block'}
 */
export function resolveDiscoveryAllowlistMiss(opts = {}) {
  if (opts.matched === true) return 'already_granted';
  const name = String(opts.toolName || '').trim();
  const hydrated = Array.isArray(opts.hydratedNames)
    ? opts.hydratedNames.map((n) => String(n || '').trim()).filter(Boolean)
    : [];
  if (name && hydrated.includes(name)) return 'needs_grant_approval';
  return 'hard_block';
}

/**
 * Insert (or no-op on conflict) an allowlist row after discovery approval.
 * Fails loud — callers must not swallow errors.
 *
 * @param {D1Database} db
 * @param {{ userId: string, workspaceId: string, toolKey: string, notes?: string|null }} row
 * @returns {Promise<{ ok: true, id: string, inserted: boolean }>}
 */
export async function persistDiscoveryApprovalGrant(db, row) {
  if (!db || typeof db.prepare !== 'function') {
    throw new Error('discovery_grant_db_required');
  }
  const userId = String(row?.userId || '').trim();
  const workspaceId = String(row?.workspaceId || '').trim();
  const toolKey = String(row?.toolKey || '').trim();
  if (!userId) throw new Error('discovery_grant_user_id_required');
  if (!workspaceId) throw new Error('discovery_grant_workspace_id_required');
  if (!toolKey) throw new Error('discovery_grant_tool_key_required');

  const id = `mcpal_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const notes =
    row?.notes != null && String(row.notes).trim()
      ? String(row.notes).trim().slice(0, 200)
      : 'discovery_approval';

  try {
    const result = await db
      .prepare(
        `INSERT INTO agentsam_mcp_allowlist (id, user_id, workspace_id, tool_key, notes, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, workspace_id, tool_key) DO NOTHING`,
      )
      .bind(id, userId, workspaceId, toolKey, notes)
      .run();
    const changes = Number(result?.meta?.changes ?? result?.changes ?? 0);
    return { ok: true, id, inserted: changes > 0 };
  } catch (e) {
    const msg = String(e?.message || e || '');
    if (msg.includes('no such column: notes')) {
      const result = await db
        .prepare(
          `INSERT INTO agentsam_mcp_allowlist (id, user_id, workspace_id, tool_key, created_at)
           VALUES (?, ?, ?, ?, datetime('now'))
           ON CONFLICT(user_id, workspace_id, tool_key) DO NOTHING`,
        )
        .bind(id, userId, workspaceId, toolKey)
        .run();
      const changes = Number(result?.meta?.changes ?? result?.changes ?? 0);
      return { ok: true, id, inserted: changes > 0 };
    }
    throw e;
  }
}
