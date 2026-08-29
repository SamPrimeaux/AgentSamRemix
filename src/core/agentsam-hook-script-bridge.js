/**
 * Links agentsam_script_runs to agentsam_hook / agentsam_hook_execution:
 * hooks opt in by setting metadata JSON on the hook row:
 *   { "agentsam_script_id": "<agentsam_scripts.id>" }
 * Only matching hooks fire for script_run_started / script_run_finished audit rows (no command execution here).
 */

/** @param {string} metadataStr */
function metadataMatchesScript(metadataStr, scriptId) {
  if (!scriptId) return false;
  try {
    const m = JSON.parse(metadataStr || '{}');
    const sid = m.agentsam_script_id ?? m.script_id;
    if (sid == null || String(sid).trim() === '') return false;
    return String(sid).trim() === String(scriptId).trim();
  } catch {
    return false;
  }
}

function hookExecutionStatusFromScriptRun(scriptStatus) {
  if (scriptStatus === 'passed') return 'success';
  if (scriptStatus === 'skipped') return 'success';
  if (scriptStatus === 'failed' || scriptStatus === 'cancelled') return 'fail';
  return 'fail';
}

/**
 * Insert agentsam_hook_execution audit rows for hooks bound to this script (metadata.agentsam_script_id).
 *
 * @param {any} db
 * @param {{
 *   phase: 'pre_deploy' | 'post_deploy',
 *   scriptId: string,
 *   scriptRunId: string,
 *   workspaceId: string,
 *   tenantId?: string | null,
 *   userId?: string | null,
 *   scriptStatus?: string | null,
 *   durationMs?: number | null,
 *   outputSummary?: string | null,
 *   errorMessage?: string | null,
 * }} ctx
 */
export async function recordHookExecutionsForAgentsamScriptRun(db, ctx) {
  if (!db || !ctx?.scriptId || !ctx?.scriptRunId || !ctx?.workspaceId) return;

  const trigger = ctx.phase;
  const tenantId = ctx.tenantId ?? null;
  const workspaceId = ctx.workspaceId;

  let hooks;
  try {
    const res = await db
      .prepare(
        `SELECT id, metadata, user_id, tenant_id, workspace_id
         FROM agentsam_hook
         WHERE is_active = 1
           AND trigger = ?
           AND (
             tenant_id IS NULL OR trim(COALESCE(tenant_id,'')) = ''
             OR (? IS NOT NULL AND tenant_id = ?)
           )
           AND (
             workspace_id IS NULL OR trim(COALESCE(workspace_id,'')) = ''
             OR (? IS NOT NULL AND workspace_id = ?)
           )`,
      )
      .bind(trigger, tenantId, tenantId, workspaceId, workspaceId)
      .all();
    hooks = res?.results || [];
  } catch (e) {
    console.warn('[hook-script-bridge] hook SELECT failed', e?.message ?? e);
    return;
  }

  const execStatus =
    ctx.phase === 'post_deploy'
      ? hookExecutionStatusFromScriptRun(ctx.scriptStatus || 'failed')
      : 'success';

  const payload = {
    agentsam_script_run_id: ctx.scriptRunId,
    agentsam_script_id: ctx.scriptId,
    phase: ctx.phase,
  };

  for (const h of hooks) {
    if (!metadataMatchesScript(h.metadata, ctx.scriptId)) continue;

    const hid = String(h.id);
    const uid = String(h.user_id || ctx.userId || 'system');
    const htid = h.tenant_id != null ? String(h.tenant_id) : tenantId;
    const hws = h.workspace_id != null && String(h.workspace_id).trim() !== '' ? String(h.workspace_id) : workspaceId;

    const eventType = ctx.phase === 'pre_deploy' ? 'script_run_started' : 'script_run_finished';

    try {
      await db
        .prepare(
          `INSERT INTO agentsam_hook_execution (
             hook_id, tenant_id, workspace_id, user_id,
             event_type, action, target_type, target_id,
             payload_json, metadata_json, status, duration_ms, output, error, ran_at
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`,
        )
        .bind(
          hid,
          htid,
          hws,
          uid,
          eventType,
          'audit',
          'agentsam_script_run',
          ctx.scriptRunId,
          JSON.stringify(payload),
          JSON.stringify({ bridge: 'agentsam-hook-script-bridge', hook_id: hid }),
          execStatus,
          ctx.durationMs ?? null,
          ctx.outputSummary ?? null,
          ctx.errorMessage ?? null,
        )
        .run();
    } catch (e) {
      console.warn('[hook-script-bridge] execution insert failed', hid, e?.message ?? e);
    }
  }
}
