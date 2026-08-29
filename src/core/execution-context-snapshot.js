/**
 * Step 4 — non-fatal agentsam_execution_context snapshot for chat spine turns.
 */

import { pragmaTableInfo } from '../../backend/services/retention.js';

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   agentRunId?: string|null,
 *   workspaceId: string,
 *   tenantId?: string|null,
 *   conversationId?: string|null,
 *   contextTokens?: number,
 * }} params
 */
export function scheduleChatExecutionContextSnapshot(env, ctx, params) {
  if (!env?.DB) return;
  const ws = String(params.workspaceId || '').trim();
  if (!ws) return;

  const p = (async () => {
    const cols = await pragmaTableInfo(env.DB, 'agentsam_execution_context');
    if (!cols.size) return;

    let goal = null;
    if (params.conversationId && (await pragmaTableInfo(env.DB, 'agentsam_chat_sessions')).size) {
      const sess = await env.DB.prepare(
        `SELECT title FROM agentsam_chat_sessions WHERE conversation_id = ? LIMIT 1`,
      )
        .bind(String(params.conversationId))
        .first()
        .catch(() => null);
      goal = sess?.title != null ? String(sess.title) : null;
    }

    let filesJson = '[]';
    if (cols.has('files_json')) {
      const wsCols = await pragmaTableInfo(env.DB, 'agentsam_workspace_state');
      if (wsCols.has('state_json')) {
        const st = await env.DB.prepare(
          `SELECT state_json FROM agentsam_workspace_state WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 1`,
        )
          .bind(ws)
          .first()
          .catch(() => null);
        if (st?.state_json) {
          try {
            const parsed = JSON.parse(String(st.state_json));
            const files = parsed?.files_open ?? parsed?.openFiles ?? parsed?.files ?? [];
            filesJson = JSON.stringify(Array.isArray(files) ? files : []);
          } catch {
            filesJson = '[]';
          }
        }
      }
    }

    let recentError = null;
    if (cols.has('recent_error')) {
      const patchCols = await pragmaTableInfo(env.DB, 'agentsam_patch_sessions');
      if (patchCols.has('fail_reason')) {
        const agentRunId = params.agentRunId != null ? String(params.agentRunId).trim() : '';
        const ws = String(params.workspaceId || '').trim();
        let err = null;
        if (agentRunId && patchCols.has('agent_run_id')) {
          err = await env.DB.prepare(
            `SELECT fail_reason FROM agentsam_patch_sessions
             WHERE agent_run_id = ?
               AND fail_reason IS NOT NULL AND trim(fail_reason) != ''
             ORDER BY COALESCE(created_at, session_ts, 0) DESC LIMIT 1`,
          )
            .bind(agentRunId)
            .first()
            .catch(() => null);
        }
        if (!err?.fail_reason && ws && patchCols.has('workspace_id')) {
          err = await env.DB.prepare(
            `SELECT fail_reason FROM agentsam_patch_sessions
             WHERE workspace_id = ?
               AND fail_reason IS NOT NULL AND trim(fail_reason) != ''
             ORDER BY COALESCE(created_at, session_ts, 0) DESC LIMIT 1`,
          )
            .bind(ws)
            .first()
            .catch(() => null);
        }
        recentError = err?.fail_reason != null ? String(err.fail_reason).slice(0, 2000) : null;
      }
    }

    let commandRunId = null;
    const agentRunId = params.agentRunId != null ? String(params.agentRunId).trim() : '';
    if (agentRunId && cols.has('command_run_id')) {
      const crCols = await pragmaTableInfo(env.DB, 'agentsam_command_run');
      if (crCols.has('agent_run_id')) {
        const cr = await env.DB.prepare(
          `SELECT id FROM agentsam_command_run WHERE agent_run_id = ? LIMIT 1`,
        )
          .bind(agentRunId)
          .first()
          .catch(() => null);
        commandRunId = cr?.id != null ? String(cr.id) : null;
      }
    }

    if (!commandRunId && cols.has('command_run_id')) {
      return;
    }

    const extra = {
      agent_run_id: agentRunId || null,
      conversation_id: params.conversationId ?? null,
      snapshot_kind: 'chat_spine',
    };

    const insertCols = [];
    const binds = [];
    const add = (col, val) => {
      if (cols.has(col)) {
        insertCols.push(col);
        binds.push(val);
      }
    };

    add('tenant_id', params.tenantId ?? null);
    add('workspace_id', ws);
    add('command_run_id', commandRunId);
    add('goal', goal);
    add('files_json', filesJson);
    add('recent_error', recentError);
    add('context_tokens', Math.max(0, Number(params.contextTokens) || 0));
    add('extra_json', JSON.stringify(extra));

    if (!insertCols.includes('command_run_id')) return;

    await env.DB.prepare(
      `INSERT INTO agentsam_execution_context (${insertCols.join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`,
    )
      .bind(...binds)
      .run()
      .catch((e) => console.warn('[execution_context_snapshot]', e?.message ?? e));
  })();

  if (ctx?.waitUntil) ctx.waitUntil(p);
  else void p;
}
