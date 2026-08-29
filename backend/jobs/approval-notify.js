/**
 * approval-notify.js
 * Part 3 of plans/active/MULTITASK-A1-LANE-FANOUT-AND-APPROVAL-NOTIFY-2026-07.md
 *
 * Sweeps agentsam_approval_queue for rows stuck at status='pending' and:
 *   - 10 min unanswered  -> push notification via notifyUserInAppAndPush
 *                            (same sender that already fires real deploy
 *                            pushes reliably — src/core/web-push.js)
 *   - 20 min unanswered  -> email via notification_outbox + halt:
 *                            force-expire the approval row (valid CHECK
 *                            value; agentsam_approval_queue.status has no
 *                            'blocked' state) and, if a todo_id is present,
 *                            set agentsam_todo.execution_status='blocked'
 *                            (that column has no CHECK constraint — safe).
 *
 * Dedup: batches by user_id so N simultaneous pending approvals (e.g. a
 * multitask fanout with several lanes hitting approval at once) produce one
 * notification, not N.
 *
 * No new tables. Two new columns added in migrations/1057_approval_notify_sweep.sql:
 *   agentsam_approval_queue.notified_at  — 10-minute push already sent
 *   agentsam_approval_queue.halted_at    — 20-minute halt already applied
 */

const NOTIFY_AFTER_SECONDS = 10 * 60; // 10 minutes
const HALT_AFTER_SECONDS = 20 * 60; // 20 minutes

/**
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
export async function runApprovalNotifySweep(env, ctx) {
  if (!env?.DB) return { ok: false, reason: 'no_db' };

  const now = Math.floor(Date.now() / 1000);
  const notifyCutoff = now - NOTIFY_AFTER_SECONDS;
  const haltCutoff = now - HALT_AFTER_SECONDS;

  const result = {
    ok: true,
    checked: 0,
    notified_users: 0,
    notified_rows: 0,
    halted_users: 0,
    halted_rows: 0,
    errors: [],
  };

  // --- 10-minute push pass ---------------------------------------------
  let toNotify;
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, tenant_id, workspace_id, user_id, tool_name, action_summary,
              approval_type, risk_level, created_at, agent_run_id, conversation_id
       FROM agentsam_approval_queue
       WHERE status = 'pending'
         AND notified_at IS NULL
         AND created_at <= ?`,
    )
      .bind(notifyCutoff)
      .all();
    toNotify = results || [];
  } catch (e) {
    result.errors.push(`notify_query: ${e?.message ?? e}`);
    toNotify = [];
  }

  result.checked += toNotify.length;

  if (toNotify.length) {
    const byUser = groupByUser(toNotify);
    for (const [userId, rows] of byUser) {
      try {
        await sendApprovalPush(env, ctx, userId, rows);
        const ids = rows.map((r) => r.id);
        await markColumn(env, ids, 'notified_at', now);
        result.notified_users += 1;
        result.notified_rows += rows.length;
      } catch (e) {
        result.errors.push(`notify_user:${userId}: ${e?.message ?? e}`);
      }
    }
  }

  // --- 20-minute halt pass -----------------------------------------------
  let toHalt;
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, tenant_id, workspace_id, user_id, tool_name, action_summary,
              approval_type, risk_level, created_at, agent_run_id, conversation_id,
              todo_id, workflow_run_id, input_json, session_id
       FROM agentsam_approval_queue
       WHERE status = 'pending'
         AND halted_at IS NULL
         AND created_at <= ?`,
    )
      .bind(haltCutoff)
      .all();
    toHalt = results || [];
  } catch (e) {
    result.errors.push(`halt_query: ${e?.message ?? e}`);
    toHalt = [];
  }

  if (toHalt.length) {
    const byUser = groupByUser(toHalt);
    for (const [userId, rows] of byUser) {
      try {
        await sendApprovalHaltEmail(env, userId, rows);
        await forceExpireAndBlock(env, rows);
        const ids = rows.map((r) => r.id);
        await markColumn(env, ids, 'halted_at', now);
        result.halted_users += 1;
        result.halted_rows += rows.length;
      } catch (e) {
        result.errors.push(`halt_user:${userId}: ${e?.message ?? e}`);
      }
    }
  }

  return result;
}

/** @param {Array<Record<string, any>>} rows */
function groupByUser(rows) {
  const map = new Map();
  for (const row of rows) {
    const uid = String(row.user_id || '').trim();
    if (!uid) continue;
    if (!map.has(uid)) map.set(uid, []);
    map.get(uid).push(row);
  }
  return map;
}

/**
 * @param {any} env
 * @param {ExecutionContext} ctx
 * @param {string} userId
 * @param {Array<Record<string, any>>} rows
 */
async function sendApprovalPush(env, ctx, userId, rows) {
  const { notifyUserInAppAndPush } =
    await import('../identity/web-push-runtime.js');
  const first = rows[0];
  const subject =
    rows.length === 1
      ? `Approval needed: ${first.tool_name || first.approval_type || 'action'}`
      : `${rows.length} approvals need your attention`;
  const bodyText =
    rows.length === 1
      ? String(first.action_summary || '').slice(0, 180)
      : rows
          .slice(0, 4)
          .map((r) => `- ${r.tool_name || r.approval_type}: ${String(r.action_summary || '').slice(0, 60)}`)
          .join('\n');

  await notifyUserInAppAndPush(env, ctx, {
    tenantId: first.tenant_id ?? null,
    userId,
    workspaceId: first.workspace_id ?? null,
    eventType: 'approval.pending_timeout',
    subject,
    bodyText,
    entityType: 'approval',
    entityId: rows.length === 1 ? first.id : `batch:${rows.map((r) => r.id).join(',').slice(0, 200)}`,
    payloadJson: {
      url: '/dashboard/agent?panel=approvals',
      tag: 'approval-pending',
      count: rows.length,
    },
  });
}

/**
 * @param {any} env
 * @param {string} userId
 * @param {Array<Record<string, any>>} rows
 */
async function sendApprovalHaltEmail(env, userId, rows) {
  if (!env?.DB) return;
  const first = rows[0];
  const user = await env.DB.prepare(`SELECT email FROM auth_users WHERE id = ?`)
    .bind(userId)
    .first()
    .catch(() => null);
  const toAddress = user?.email ? String(user.email).trim() : null;
  if (!toAddress) return;

  const subject =
    rows.length === 1
      ? `[Action halted] Approval timed out: ${first.tool_name || first.approval_type}`
      : `[Action halted] ${rows.length} approvals timed out after 20 minutes`;
  const bodyLines = [
    `${rows.length} pending approval(s) went unanswered for 20+ minutes and have been halted.`,
    `The underlying work is stopped, not lost — it can be revisited on your next session.`,
    '',
    ...rows.map(
      (r) => `- [${r.id}] ${r.tool_name || r.approval_type}: ${String(r.action_summary || '').slice(0, 120)}`,
    ),
  ];

  const notifyTenantId = first.tenant_id != null ? String(first.tenant_id).trim() : '';
  if (!notifyTenantId) return;

  const id = 'notif_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  await env.DB.prepare(
    `INSERT INTO notification_outbox
       (id, tenant_id, channel, to_address, subject, body_text, payload_json,
        status, priority, event_type, created_by, created_at, updated_at)
     VALUES (?, ?, 'email', ?, ?, ?, ?, 'pending', 2, 'approval.timeout_halt', 'approval-notify-sweep',
             unixepoch(), unixepoch())`,
  )
    .bind(
      id,
      notifyTenantId,
      toAddress,
      subject,
      bodyLines.join('\n'),
      JSON.stringify({ approval_ids: rows.map((r) => r.id) }).slice(0, 4096),
    )
    .run();
}

/**
 * Halt: force-expire the approval row (valid CHECK value on
 * agentsam_approval_queue.status) and, where a todo_id is present, mark the
 * underlying todo blocked so it is visibly stalled and resumable rather than
 * silently abandoned. Does NOT touch agentsam_workflow_runs.status — that
 * column's CHECK constraint does not include 'blocked'/'halted', so writing
 * there would fail; left untouched to avoid a schema change in this slice.
 * @param {any} env
 * @param {Array<Record<string, any>>} rows
 */
async function forceExpireAndBlock(env, rows) {
  for (const row of rows) {
    await env.DB.prepare(
      `UPDATE agentsam_approval_queue SET status = 'expired', decided_at = unixepoch()
       WHERE id = ? AND status = 'pending'`,
    )
      .bind(row.id)
      .run()
      .catch(() => {});

    if (row.todo_id) {
      await env.DB.prepare(
        `UPDATE agentsam_todo SET execution_status = 'blocked', updated_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(row.todo_id)
        .run()
        .catch(() => {});
    }
  }

  // Soft-expire spawn budget proposals: keep spawn_job halted + queued lanes intact.
  try {
    const { softExpireSpawnBudgetApprovals } =
      await import('../agentsam/runtime/spawn/orchestrator.js');
    await softExpireSpawnBudgetApprovals(env, rows);
  } catch (e) {
    console.warn('[approval-notify] softExpireSpawnBudgetApprovals', e?.message ?? e);
  }
}

/**
 * @param {any} env
 * @param {string[]} ids
 * @param {'notified_at' | 'halted_at'} column
 * @param {number} value
 */
async function markColumn(env, ids, column, value) {
  if (!ids.length) return;
  for (const id of ids) {
    await env.DB.prepare(`UPDATE agentsam_approval_queue SET ${column} = ? WHERE id = ?`)
      .bind(value, id)
      .run()
      .catch(() => {});
  }
}

/**
 * Reusable lookup for Part 2 (multitask lane chip status). Returns the
 * pending approval row for a given agent_run_id, if any, so status handlers
 * can surface 'awaiting_approval' instead of only 'running'/'done'/'failed'.
 * Used by the backend Multitask spawn orchestrator.
 *
 * @param {any} env
 * @param {string} agentRunId
 * @returns {Promise<{ id: string, tool_name: string, action_summary: string, created_at: number } | null>}
 */
export async function getPendingApprovalForAgentRun(env, agentRunId) {
  if (!env?.DB || !agentRunId) return null;
  const row = await env.DB.prepare(
    `SELECT id, tool_name, action_summary, created_at
     FROM agentsam_approval_queue
     WHERE agent_run_id = ? AND status = 'pending'
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(agentRunId)
    .first()
    .catch(() => null);
  return row || null;
}
