/**
 * Mac Messages.app iMessage relay — Worker side.
 * Enqueue D1 rows; scripts/imessage/imessage_approval_daemon.py sends + polls.
 * Never BlueBubbles. Identity from session/runContext only.
 */

const TOKEN_BYTES = 4;
const BACKFILL_MAX_AGE_SEC = 3600;
const APPLY_BATCH = 20;

function trimStr(v) {
  return v != null ? String(v).trim() : '';
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function scopeFrom(runContext = {}, params = {}) {
  const tenantId = trimStr(
    params.tenant_id || params.tenantId || runContext.tenantId || runContext.tenant_id,
  );
  const workspaceId = trimStr(
    params.workspace_id || params.workspaceId || runContext.workspaceId || runContext.workspace_id,
  );
  const userId = trimStr(
    params.user_id || params.userId || runContext.userId || runContext.user_id || runContext.canonicalUserId,
  );
  return { tenantId, workspaceId, userId };
}

export async function resolveImessageHandle(env, { tenantId, params = {} } = {}) {
  const fromArgs = trimStr(params.to || params.handle || params.phone || params.self_handle);
  if (fromArgs) return fromArgs;
  if (env?.DB && tenantId) {
    const row = await env.DB.prepare(
      `SELECT self_handle FROM agentsam_imessage_poll_checkpoint
        WHERE tenant_id = ? AND self_handle IS NOT NULL AND trim(self_handle) != ''
        ORDER BY updated_at DESC LIMIT 1`,
    )
      .bind(tenantId)
      .first()
      .catch(() => null);
    const fromCp = trimStr(row?.self_handle);
    if (fromCp) return fromCp;
  }
  const fromEnv = trimStr(env?.IMESSAGE_SELF_HANDLE);
  if (fromEnv) return fromEnv;
  return '';
}

/**
 * @param {any} env
 * @param {{
 *   tenantId: string,
 *   workspaceId?: string,
 *   userId: string,
 *   promptText: string,
 *   kind?: 'send'|'approval',
 *   toHandle?: string,
 *   approvalQueueId?: string|null,
 *   hookId?: string|null,
 *   agentRunId?: string|null,
 *   workflowRunId?: string|null,
 *   executionStepId?: string|null,
 *   conversationId?: string|null,
 * }} opts
 */
export async function enqueueImessage(env, opts) {
  if (!env?.DB) throw new Error('db_required');
  const tenantId = trimStr(opts.tenantId);
  const userId = trimStr(opts.userId);
  const promptText = trimStr(opts.promptText);
  if (!tenantId) throw new Error('tenant_required');
  if (!userId) throw new Error('user_id_required');
  if (!promptText) throw new Error('prompt_required');

  const kind = opts.kind === 'send' ? 'send' : 'approval';
  const toHandle = trimStr(opts.toHandle);
  if (!toHandle) throw new Error('imessage_handle_required');

  const token = newToken();
  const workspaceId = trimStr(opts.workspaceId) || null;
  await env.DB.prepare(
    `INSERT INTO agentsam_imessage_approvals
       (tenant_id, workspace_id, user_id, token, prompt_text, hook_id, agent_run_id,
        workflow_run_id, execution_step_id, conversation_id, kind, to_handle, approval_queue_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      tenantId,
      workspaceId,
      userId,
      token,
      promptText.slice(0, 4000),
      trimStr(opts.hookId) || null,
      trimStr(opts.agentRunId) || null,
      trimStr(opts.workflowRunId) || null,
      trimStr(opts.executionStepId) || null,
      trimStr(opts.conversationId) || null,
      kind,
      toHandle,
      trimStr(opts.approvalQueueId) || null,
    )
    .run();

  return { token, kind, to_handle: toHandle, status: 'pending' };
}

export async function enqueueImessageApprovalForQueue(env, opts) {
  const tenantId = trimStr(opts.tenantId);
  const userId = trimStr(opts.userId);
  const approvalQueueId = trimStr(opts.approvalQueueId);
  const promptText = trimStr(opts.promptText);
  if (!env?.DB || !tenantId || !userId || !approvalQueueId || !promptText) return { ok: false, error: 'imessage_enqueue_skipped' };

  const existing = await env.DB.prepare(
    `SELECT token FROM agentsam_imessage_approvals WHERE approval_queue_id = ? LIMIT 1`,
  )
    .bind(approvalQueueId)
    .first()
    .catch(() => null);
  if (existing?.token) return { ok: true, token: existing.token, deduped: true };

  const toHandle = await resolveImessageHandle(env, { tenantId, params: opts.params || {} });
  if (!toHandle) return { ok: false, error: 'imessage_handle_required' };

  const out = await enqueueImessage(env, {
    tenantId,
    workspaceId: opts.workspaceId,
    userId,
    promptText,
    kind: 'approval',
    toHandle,
    approvalQueueId,
    agentRunId: opts.agentRunId,
    workflowRunId: opts.workflowRunId,
    executionStepId: opts.executionStepId,
    conversationId: opts.conversationId,
  });
  return { ok: true, ...out };
}

export async function getImessageStatus(env, { token, id, userId }) {
  if (!env?.DB) throw new Error('db_required');
  const uid = trimStr(userId);
  if (!uid) throw new Error('user_id_required');
  const tok = trimStr(token);
  const rowId = trimStr(id);
  if (!tok && !rowId) throw new Error('token_or_id_required');

  const row = tok
    ? await env.DB.prepare(
        `SELECT i.id, i.token, i.status, i.kind, i.prompt_text, i.reply_text, i.sent_at,
                i.replied_at, i.approval_queue_id, i.created_at, i.expires_at, i.send_error,
                q.status AS queue_status
           FROM agentsam_imessage_approvals i
           LEFT JOIN agentsam_approval_queue q ON q.id = i.approval_queue_id
          WHERE i.token = ? AND i.user_id = ?
          LIMIT 1`,
      )
        .bind(tok, uid)
        .first()
    : await env.DB.prepare(
        `SELECT i.id, i.token, i.status, i.kind, i.prompt_text, i.reply_text, i.sent_at,
                i.replied_at, i.approval_queue_id, i.created_at, i.expires_at, i.send_error,
                q.status AS queue_status
           FROM agentsam_imessage_approvals i
           LEFT JOIN agentsam_approval_queue q ON q.id = i.approval_queue_id
          WHERE i.id = ? AND i.user_id = ?
          LIMIT 1`,
      )
        .bind(rowId, uid)
        .first();

  if (!row) return { ok: false, error: 'not_found' };
  return { ok: true, ...row };
}

export async function syncPendingApprovalsToImessage(env) {
  if (!env?.DB) return { enqueued: 0, skipped: 0 };
  const cutoff = Math.floor(Date.now() / 1000) - BACKFILL_MAX_AGE_SEC;
  const { results } = await env.DB.prepare(
    `SELECT q.id, q.tenant_id, q.workspace_id, q.user_id, q.action_summary, q.tool_name,
            q.agent_run_id, q.workflow_run_id, q.execution_step_id, q.conversation_id
       FROM agentsam_approval_queue q
       LEFT JOIN agentsam_imessage_approvals i ON i.approval_queue_id = q.id
      WHERE q.status = 'pending'
        AND i.id IS NULL
        AND q.created_at >= ?
      ORDER BY q.created_at ASC
      LIMIT 20`,
  )
    .bind(cutoff)
    .all()
    .catch(() => ({ results: [] }));

  let enqueued = 0;
  let skipped = 0;
  for (const q of results || []) {
    const prompt = trimStr(q.action_summary) || `Approval needed: ${trimStr(q.tool_name)}`;
    const out = await enqueueImessageApprovalForQueue(env, {
      approvalQueueId: q.id,
      tenantId: q.tenant_id,
      workspaceId: q.workspace_id,
      userId: q.user_id,
      promptText: prompt,
      agentRunId: q.agent_run_id,
      workflowRunId: q.workflow_run_id,
      executionStepId: q.execution_step_id,
      conversationId: q.conversation_id,
    }).catch((e) => ({ ok: false, error: e?.message || String(e) }));
    if (out?.ok) enqueued += 1;
    else skipped += 1;
  }
  return { enqueued, skipped };
}

export async function applyImessageDecisions(env, ctx) {
  if (!env?.DB) return { applied: 0 };
  const { results } = await env.DB.prepare(
    `SELECT i.approval_queue_id, i.status, i.user_id
       FROM agentsam_imessage_approvals i
       INNER JOIN agentsam_approval_queue q ON q.id = i.approval_queue_id
      WHERE (i.kind IS NULL OR i.kind = 'approval')
        AND i.status IN ('approved', 'denied')
        AND q.status = 'pending'
        AND i.approval_queue_id IS NOT NULL
      ORDER BY i.replied_at ASC
      LIMIT ?`,
  )
    .bind(APPLY_BATCH)
    .all()
    .catch(() => ({ results: [] }));

  const { handleAgentApprovalDecision } = await import('../agentsam/commands/execute.js');
  let applied = 0;
  for (const row of results || []) {
    const decision = row.status === 'approved' ? 'approved' : 'denied';
    const out = await handleAgentApprovalDecision(env, ctx, {
      approval_id: row.approval_queue_id,
      decision,
      userId: trimStr(row.user_id),
    }).catch((e) => ({ ok: false, error: e?.message || String(e) }));
    if (out?.ok) applied += 1;
  }
  return { applied };
}

export async function executeImessageCatalog(env, config, params, runContext) {
  const op = trimStr(config?.operation || params?.operation).toLowerCase();
  const scope = scopeFrom(runContext, params);
  try {
    if (op === 'status' || op === 'approval_status') {
      const st = await getImessageStatus(env, {
        token: params.token,
        id: params.id,
        userId: scope.userId,
      });
      return st.ok === false ? { ok: false, error: st.error, body: st } : { ok: true, body: st };
    }

    if (!scope.tenantId) return { ok: false, error: 'tenant_required' };
    if (!scope.userId) return { ok: false, error: 'user_id_required' };

    const text = trimStr(params.text || params.message || params.body || params.prompt);
    const toHandle = await resolveImessageHandle(env, { tenantId: scope.tenantId, params });
    if (!toHandle) return { ok: false, error: 'imessage_handle_required' };

    if (op === 'send') {
      if (!text) return { ok: false, error: 'text_required' };
      const out = await enqueueImessage(env, {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        promptText: text,
        kind: 'send',
        toHandle,
        agentRunId: params.agent_run_id || runContext?.agentRunId,
        conversationId: params.conversation_id || runContext?.conversationId || runContext?.sessionId,
      });
      return { ok: true, body: { channel: 'imessage', queued: true, ...out } };
    }

    if (op === 'request_approval') {
      if (!text) return { ok: false, error: 'prompt_required' };
      const queueId = 'prop_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      const now = Math.floor(Date.now() / 1000);
      if (!scope.workspaceId) return { ok: false, error: 'workspace_required' };
      await env.DB.prepare(
        `INSERT INTO agentsam_approval_queue
           (id, tenant_id, workspace_id, user_id, tool_name, action_summary,
            risk_level, input_json, expires_at, status, approval_type, created_at,
            agent_run_id, conversation_id)
         VALUES (?, ?, ?, ?, ?, ?, 'medium', ?, ?, 'pending', 'tool', ?, ?, ?)`,
      )
        .bind(
          queueId,
          scope.tenantId,
          scope.workspaceId,
          scope.userId,
          'agentsam_imessage_request_approval',
          text.slice(0, 500),
          JSON.stringify({ command_text: text, command_source: 'imessage_request_approval' }),
          now + 3600,
          now,
          trimStr(params.agent_run_id || runContext?.agentRunId) || null,
          trimStr(params.conversation_id || runContext?.conversationId || runContext?.sessionId) || null,
        )
        .run();
      const out = await enqueueImessage(env, {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        promptText: text,
        kind: 'approval',
        toHandle,
        approvalQueueId: queueId,
        agentRunId: params.agent_run_id || runContext?.agentRunId,
        conversationId: params.conversation_id || runContext?.conversationId || runContext?.sessionId,
      });
      return {
        ok: true,
        body: {
          channel: 'imessage',
          queued: true,
          approval_queue_id: queueId,
          ...out,
          reply_hint: `Reply: approve ${out.token} / no ${out.token}`,
        },
      };
    }

    return { ok: false, error: `unsupported_imessage_operation:${op || 'empty'}` };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}
