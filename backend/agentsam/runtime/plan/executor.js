/**
 * Agent Sam Task Executor
 * Runs agentsam_plan_tasks sequentially, emitting SSE events per task.
 * Each task uses its handler_type to decide execution path.
 */

import {
  approvalQueueApprovedForCommandRun,
  findPendingApprovalForCommandRun,
  insertApprovalQueueRow,
} from '../../approvals/queue.js';
import { executeAgentPlanTask } from './handlers/agent.js';

/**
 * Build an executor for one request from owning-domain adapters.
 *
 * The executor is intentionally independent of legacy src/ modules. HTTP
 * composition supplies provider, identity, storage, and capability adapters.
 *
 * @param {{
 *   dispatchComplete: Function,
 *   dispatchByToolCode: Function,
 *   resolveModelForTask: Function,
 *   resolveCanonicalUserId: Function,
 *   fetchAuthUserTenantId: Function,
 *   pragmaTableInfo: Function,
 *   insertPlanExecutionStep: Function,
 *   resolvePlanTaskCapabilityType: Function,
 *   recordArmOutcome?: Function,
 *   emitPlanRoadblockQuestions?: Function,
 *   runBrowserCapabilityAction?: Function,
 *   runExcalidrawCapabilityAction?: Function,
 *   githubHandlers?: Record<string, Function>,
 *   executeFsEditFile?: Function,
 *   executeFsWriteFile?: Function,
 *   resolveIdentityScopedGcpCwd?: Function,
 *   loadWorkspaceSettingsJson?: Function,
 * }} deps
 */
export function createPlanExecutor(deps) {
  const {
    dispatchComplete,
    dispatchByToolCode,
    resolveModelForTask,
    resolveCanonicalUserId,
    fetchAuthUserTenantId,
    pragmaTableInfo,
    insertPlanExecutionStep,
    resolvePlanTaskCapabilityType,
    recordArmOutcome,
    emitPlanRoadblockQuestions,
    runBrowserCapabilityAction,
    runExcalidrawCapabilityAction,
    githubHandlers,
    executeFsEditFile,
    executeFsWriteFile,
    resolveIdentityScopedGcpCwd,
    loadWorkspaceSettingsJson,
  } = deps || {};

  if (
    typeof dispatchComplete !== 'function' ||
    typeof dispatchByToolCode !== 'function' ||
    typeof resolveModelForTask !== 'function' ||
    typeof resolveCanonicalUserId !== 'function' ||
    typeof fetchAuthUserTenantId !== 'function' ||
    typeof pragmaTableInfo !== 'function' ||
    typeof insertPlanExecutionStep !== 'function' ||
    typeof resolvePlanTaskCapabilityType !== 'function'
  ) {
    throw new Error('plan_executor_dependencies_required');
  }

async function resolveTaskExecutorModelKey(env, workspaceId) {
  const resolved = await resolveModelForTask(env, {
    mode: 'agent',
    workspace_id:
      workspaceId != null && String(workspaceId).trim() !== ''
        ? String(workspaceId).trim()
        : null,
    require_tools: true,
  });
  if (!resolved?.model_key) {
    throw new Error('agentsam-task-executor: resolveModelForTask returned no model');
  }
  return resolved;
}

/**
 * Tenant/workspace for plan execution: caller params → agentsam_plans → logged-in user (auth_users.tenant_id).
 */
async function resolvePlanTenantWorkspace(env, { planId, tenantId, workspaceId, userId }) {
  let tid = tenantId != null && String(tenantId).trim() !== '' ? String(tenantId).trim() : null;
  let wid = workspaceId != null && String(workspaceId).trim() !== '' ? String(workspaceId).trim() : '';

  if (env?.DB && planId) {
    const prow = await env.DB
      .prepare(`SELECT tenant_id, workspace_id FROM agentsam_plans WHERE id = ? LIMIT 1`)
      .bind(planId)
      .first()
      .catch(() => null);
    if (!tid && prow?.tenant_id != null && String(prow.tenant_id).trim() !== '') {
      tid = String(prow.tenant_id).trim();
    }
    if (!wid && prow?.workspace_id != null && String(prow.workspace_id).trim() !== '') {
      wid = String(prow.workspace_id).trim();
    }
  }

  const uid = userId != null && String(userId).trim() !== '' ? String(userId).trim() : '';
  if (!tid && uid) {
    tid = await fetchAuthUserTenantId(env, uid).catch(() => null);
  }

  return { tenantId: tid, workspaceId: wid };
}

/** Shell text to run after authorization (quality_gate.proposed_shell, cmd:, agentsam_commands id, or description). */
function shellCommandForTerminalTask(task) {
  try {
    const qg = JSON.parse(String(task.quality_gate_json || '{}'));
    if (qg.proposed_shell && String(qg.proposed_shell).trim()) {
      return String(qg.proposed_shell).trim().slice(0, 4000);
    }
  } catch {
    /* ignore */
  }
  const hk = task.handler_key != null ? String(task.handler_key).trim() : '';
  const desc = String(task.description || '').trim();
  if (hk.startsWith('cmd:')) return desc.slice(0, 4000);
  if (hk && /^[a-zA-Z0-9_.-]{4,80}$/.test(hk) && !/[;&|`$]/.test(hk)) {
    return desc.slice(0, 4000);
  }
  return (hk || desc).slice(0, 4000);
}

/**
 * Planner-generated shell: create command_run + approval_queue and attach to the plan task.
 * @param {any} env
 * @param {{ task: Record<string, unknown>, planId: string, userId: string|null, workspaceId: string, tenantId: string|null, sessionId: string|null, cmd: string, emit: (ev: string, data: Record<string, unknown>) => void }} p
 * @returns {Promise<{ ok: boolean, reused?: boolean, created?: boolean, command_run_id?: string, approval_id?: string }>}
 */
async function ensurePlanTerminalApprovalProposal(env, p) {
  const { task, planId, userId, workspaceId, tenantId, sessionId, cmd, emit } = p;
  if (!env.DB || !cmd.trim()) return { ok: false };

  const ws = String(workspaceId || '').trim();
  if (!ws) return { ok: false };

  let tid = tenantId != null && String(tenantId).trim() !== '' ? String(tenantId).trim() : null;
  let workflowRunId = null;
  const prow = await env.DB
    .prepare(`SELECT tenant_id, workflow_run_id FROM agentsam_plans WHERE id = ? LIMIT 1`)
    .bind(planId)
    .first()
    .catch(() => null);
  if (!tid && prow?.tenant_id != null) tid = String(prow.tenant_id).trim();
  if (prow?.workflow_run_id != null && String(prow.workflow_run_id).trim() !== '') {
    workflowRunId = String(prow.workflow_run_id).trim();
  }

  const uidRaw = userId != null && String(userId).trim() !== '' ? String(userId).trim() : null;
  if (!uidRaw) return { ok: false };
  const canonicalUser = await resolveCanonicalUserId(uidRaw, env);
  if (!canonicalUser) return { ok: false, error: 'auth_user_id_required' };

  if (!tid) {
    tid = await fetchAuthUserTenantId(env, canonicalUser).catch(() => null);
  }
  if (!tid) return { ok: false };

  const existingCrid = task.command_run_id != null ? String(task.command_run_id).trim() : '';
  if (existingCrid) {
    const run = await env.DB
      .prepare(`SELECT approval_status FROM agentsam_command_run WHERE id = ? LIMIT 1`)
      .bind(existingCrid)
      .first()
      .catch(() => null);
    const q = await findPendingApprovalForCommandRun(env, existingCrid);
    if (run && String(run.approval_status || '').toLowerCase() === 'pending_approval' && q?.id) {
      emit('approval_required', {
        task_id: task.id,
        command_run_id: existingCrid,
        approval_id: String(q.id),
        title: String(task.title || 'Terminal'),
        command_preview: cmd.slice(0, 2000),
        risk_level: 'high',
        action_summary: `Plan terminal task needs explicit approval before execution.`,
        plan_id: planId,
        workflow_run_id: workflowRunId,
        execution_step_id: task.execution_step_id != null ? String(task.execution_step_id) : undefined,
      });
      return { ok: true, reused: true, command_run_id: existingCrid, approval_id: String(q.id) };
    }
  }

  const runId = 'run_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const approvalId = 'appr_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const commandsJson = JSON.stringify([{ proposed_shell: cmd.slice(0, 4000), source: 'plan_terminal', plan_task_id: task.id }]);
  const userInput = String(task.title || 'Plan terminal').slice(0, 2000);

  let estepId = task.execution_step_id != null ? String(task.execution_step_id).trim() : '';
  const stepCols = await pragmaTableInfo(env.DB, 'agentsam_execution_steps');
  const planTaskCols = await pragmaTableInfo(env.DB, 'agentsam_plan_tasks');

  try {
    if (!estepId && workflowRunId) {
      estepId =
        (await insertPlanExecutionStep(env, stepCols, {
          workflowRunId,
          nodeKey: `plan_terminal_dynamic_${String(task.id || 'task').slice(0, 40)}`,
          nodeType: 'terminal',
          inputObj: { plan_task_id: task.id, plan_id: planId, source: 'plan_terminal_dynamic' },
        })) || '';
      if (estepId && planTaskCols.has('execution_step_id')) {
        await env.DB
          .prepare(`UPDATE agentsam_plan_tasks SET execution_step_id = ? WHERE id = ?`)
          .bind(estepId, task.id)
          .run();
      }
    }

    const inputJson = JSON.stringify({
      command_text: cmd.slice(0, 4000),
      plan_task_id: task.id,
      plan_id: planId,
      execution_step_id: estepId || null,
    });

    await env.DB
      .prepare(
        `INSERT INTO agentsam_command_run
          (id, tenant_id, workspace_id, user_id, session_id, conversation_id,
           user_input, normalized_intent, intent_category, model_id,
           commands_json, result_json, output_text, confidence_score,
           success, exit_code, duration_ms, input_tokens, output_tokens, cost_usd, error_message,
           selected_command_id, selected_command_slug, risk_level, requires_confirmation, approval_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        runId,
        tid,
        ws,
        canonicalUser,
        sessionId || null,
        null,
        userInput,
        'plan_terminal',
        'misc',
        null,
        commandsJson,
        '{}',
        null,
        null,
        0,
        null,
        null,
        0,
        0,
        0,
        null,
        null,
        null,
        'high',
        1,
        'pending_approval',
      )
      .run();

    await insertApprovalQueueRow(env, {
      id: approvalId,
      tenant_id: tid,
      workspace_id: ws,
      user_id: canonicalUser,
      session_id: sessionId || null,
      plan_id: planId,
      workflow_run_id: workflowRunId || undefined,
      command_run_id: runId,
      execution_step_id: estepId || undefined,
      tool_name: 'terminal.plan_task',
      action_summary: `Approve shell for plan task: ${String(task.title || '').slice(0, 200)}`,
      input_json: inputJson,
      risk_level: 'high',
      status: 'pending',
      expires_at: null,
    });

    if (estepId) {
      await env.DB
        .prepare(
          `UPDATE agentsam_execution_steps SET approval_id = ?, status = 'approval_pending' WHERE id = ?`,
        )
        .bind(approvalId, estepId)
        .run();
    }

    await env.DB
      .prepare(
        `UPDATE agentsam_plan_tasks SET command_run_id = ?, output_summary = ?, status = 'todo' WHERE id = ?`,
      )
      .bind(runId, '[terminal] Awaiting explicit approval (Allow) before execution.', task.id)
      .run();

    emit('approval_required', {
      task_id: task.id,
      command_run_id: runId,
      approval_id: approvalId,
      title: String(task.title || 'Terminal'),
      command_preview: cmd.slice(0, 2000),
      risk_level: 'high',
      action_summary: `Plan terminal task needs explicit approval before execution.`,
      plan_id: planId,
      workflow_run_id: workflowRunId,
      execution_step_id: estepId || (task.execution_step_id != null ? String(task.execution_step_id) : undefined),
    });

    return { ok: true, created: true, command_run_id: runId, approval_id: approvalId };
  } catch (e) {
    console.warn('[executePlan] terminal approval proposal failed', e?.message ?? e);
    return { ok: false };
  }
}

/**
 * @param {any} env
 * @param {string} commandRunId
 * @param {Record<string, unknown>|null} task
 */
async function isCommandRunApprovedForTerminal(env, commandRunId, task = null) {
  const id = String(commandRunId || '').trim();
  if (!id || !env.DB) return false;
  const run = await env.DB
    .prepare(`SELECT * FROM agentsam_command_run WHERE id = ? LIMIT 1`)
    .bind(id)
    .first()
    .catch(() => null);
  if (!run) return false;

  const st = run.approval_status != null ? String(run.approval_status).toLowerCase().trim() : '';
  const esid = task?.execution_step_id != null ? String(task.execution_step_id).trim() : '';
  if (esid) {
    return approvalQueueApprovedForCommandRun(env, id, esid);
  }
  if (st === 'approved') return true;

  try {
    return await approvalQueueApprovedForCommandRun(env, id, '');
  } catch {
    return false;
  }
}

/**
 * Opt-in terminal: only after an approved agentsam_command_run, or executeCommand() did not
 * return pending_approval (same approval gate as the command pipeline).
 *
 * @param {any} env
 * @param {any} ctx
 * @param {{ task: Record<string, unknown>, planId: string, userId: string|null, workspaceId: string, tenantId: string|null, sessionId: string|null }} p
 */
async function authorizePlanTerminalExecution(env, ctx, p) {
  const { task, planId, userId, workspaceId, tenantId, sessionId, commandRuntime } = p;
  const stubCtx =
    ctx && typeof ctx.waitUntil === 'function'
      ? ctx
      : { waitUntil: (fn) => void Promise.resolve(typeof fn === 'function' ? fn() : fn).catch(() => {}) };

  const crid = task.command_run_id != null ? String(task.command_run_id).trim() : '';
  if (crid && (await isCommandRunApprovedForTerminal(env, crid, task))) {
    return {
      allowed: true,
      via: task.execution_step_id ? 'approval_queue' : 'approved_command_run',
      command_run_id: crid,
      chain_id: null,
      commandId: null,
    };
  }

  let commandId = '';
  const hkRaw = task.handler_key != null ? String(task.handler_key).trim() : '';
  if (hkRaw.startsWith('cmd:')) commandId = hkRaw.slice(4).trim();
  else if (hkRaw && !hkRaw.includes(' ')) commandId = hkRaw;

  if (!commandId && crid && env.DB) {
    const run = await env.DB
      .prepare(`SELECT selected_command_id FROM agentsam_command_run WHERE id = ? LIMIT 1`)
      .bind(crid)
      .first()
      .catch(() => null);
    if (run?.selected_command_id != null && String(run.selected_command_id).trim() !== '') {
      commandId = String(run.selected_command_id).trim();
    }
  }

  if (!commandId || !env.DB) {
    return {
      allowed: false,
      reason: 'no_gate',
      userMessage:
        '[terminal] NOT EXECUTED: link an approved agentsam_command_run (set plan task command_run_id after approval), or set handler_key to an agentsam_commands.id so the command approval gate can run.',
    };
  }

  const cmdRow = await env.DB
    .prepare(`SELECT id FROM agentsam_commands WHERE id = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`)
    .bind(commandId)
    .first()
    .catch(() => null);
  if (!cmdRow?.id) {
    return {
      allowed: false,
      reason: 'command_not_found',
      userMessage: `[terminal] NOT EXECUTED: agentsam_commands id not found or inactive: ${commandId}`,
    };
  }

  const prepareCommandFn = commandRuntime?.prepareCommandExecution;
  if (typeof prepareCommandFn !== 'function') {
    return { allowed: false, reason: 'command_runtime_unavailable', userMessage: '[terminal] NOT EXECUTED: command approval runtime unavailable.' };
  }
  const prepared = await prepareCommandFn(env, stubCtx, {
    commandId,
    userId,
    tenantId,
    workspaceId,
    sessionId: sessionId || null,
    planId,
    executionStepId: task.execution_step_id ?? null,
    skipApprovalGate: false,
  });

  if (!prepared || prepared.ok === false) {
    return {
      allowed: false,
      reason: 'prepareCommandExecution_failed',
      userMessage: `[terminal] NOT EXECUTED: command preparation failed — ${prepared?.error ?? JSON.stringify(prepared)}`,
    };
  }
  if (prepared.status === 'pending_approval') {
    return {
      allowed: false,
      reason: 'pending_approval',
      approval_id: prepared.approval_id ?? null,
      command_run_id: prepared.command_run_id ?? null,
      command_preview: prepared.command_preview != null ? String(prepared.command_preview).slice(0, 2000) : null,
      userMessage:
        '[terminal] NOT EXECUTED: command requires human approval. Click Allow, then resume this task.',
    };
  }

  return {
    allowed: true,
    via: 'prepared_command',
    chain_id: null,
    agent_run_id: prepared.agent_run_id ?? null,
    command_run_id: prepared.command_run_id ?? null,
    commandId,
  };
}

async function patchPlanExecutionStep(env, task, status, extra = {}) {
  const eid = task?.execution_step_id != null ? String(task.execution_step_id).trim() : '';
  if (!eid || !env?.DB) return;
  const cols = await pragmaTableInfo(env.DB, 'agentsam_execution_steps');
  const sets = [];
  const binds = [];
  if (cols.has('status')) {
    sets.push('status = ?');
    binds.push(status);
  }
  if (extra.outputJson != null && cols.has('output_json')) {
    sets.push('output_json = ?');
    binds.push(String(extra.outputJson).slice(0, 16000));
  }
  if (extra.errorJson != null && cols.has('error_json')) {
    sets.push('error_json = ?');
    binds.push(String(extra.errorJson).slice(0, 16000));
  }
  if (extra.latencyMs != null && cols.has('latency_ms')) {
    sets.push('latency_ms = ?');
    binds.push(extra.latencyMs);
  }
  if (!extra.skipCompleted && cols.has('completed_at')) {
    sets.push('completed_at = unixepoch()');
  }
  if (!sets.length) return;
  binds.push(eid);
  await env.DB
    .prepare(`UPDATE agentsam_execution_steps SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run()
    .catch(() => {});
}

/**
 * D1 agentsam_capability_aliases → tool_key rows for an abstract capability (monaco_edit, browser_capture).
 * @param {any} env
 * @param {string} abstractCapability
 */
async function resolveCapabilityAliasToolKeys(env, abstractCapability) {
  if (!env?.DB) return [];
  const cap = String(abstractCapability || '').trim().toLowerCase();
  if (!cap) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT match_kind, match_value, priority, requires_approval, is_mutation
       FROM agentsam_capability_aliases
       WHERE abstract_capability = ? AND is_active = 1
       ORDER BY priority ASC`,
    )
      .bind(cap)
      .all();
    return results || [];
  } catch {
    return [];
  }
}

function languageForPlanFile(filePath) {
  const p = String(filePath || '').toLowerCase();
  if (p.endsWith('.html') || p.endsWith('.htm')) return 'html';
  if (p.endsWith('.css')) return 'css';
  if (p.endsWith('.js') || p.endsWith('.mjs') || p.endsWith('.cjs')) return 'javascript';
  if (p.endsWith('.ts') || p.endsWith('.tsx')) return 'typescript';
  if (p.endsWith('.json')) return 'json';
  if (p.endsWith('.md')) return 'markdown';
  if (p.endsWith('.svg')) return 'xml';
  return 'plaintext';
}

/** R2 file API URLs are not valid BrowserView targets until published/saved. */
function isR2ApiPreviewUrl(url) {
  if (!isAbsoluteHttpUrl(url)) return false;
  try {
    return new URL(url).pathname.includes('/api/r2/file');
  } catch {
    return false;
  }
}

function iamOrigin(env) {
  return String(env?.IAM_ORIGIN || 'https://inneranimalmedia.com').replace(/\/$/, '');
}

function isAbsoluteHttpUrl(url) {
  const u = String(url || '').trim();
  return u.startsWith('http://') || u.startsWith('https://');
}

/** True when URL is the product homepage — not a plan artifact preview target. */
function isHomepagePreviewUrl(url, env) {
  if (!isAbsoluteHttpUrl(url)) return false;
  try {
    const u = new URL(url);
    const home = new URL(`${iamOrigin(env)}/`);
    if (u.origin !== home.origin) return false;
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return path === '/' || path === '';
  } catch {
    return false;
  }
}

/**
 * @typedef {{ path: string, bucket?: string, key?: string, previewUrl?: string, content?: string, language?: string, draft?: boolean }} PlanWrittenArtifact
 */

async function markPlanTaskSkipped(env, task, message, emit, cap) {
  const msg = String(message || 'skipped').slice(0, 4000);
  await env.DB.prepare(
    `UPDATE agentsam_plan_tasks SET status='skipped', completed_at=unixepoch(), output_summary=? WHERE id=?`,
  )
    .bind(msg, task.id)
    .run();
  emit('task_complete', {
    task_id: task.id,
    title: task.title,
    status: 'skipped',
    output: msg,
    order_index: task.order_index,
  });
  await patchPlanExecutionStep(env, task, 'success', {
    outputJson: JSON.stringify({ capability_type: cap, skipped: true, message: msg }),
  });
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {(type: string, payload: Record<string, unknown>) => void} emit
 * @param {{
 *   planId: string,
 *   planTitle: string,
 *   tenantId: string,
 *   workspaceId: string,
 *   userId?: string|null,
 *   sessionId?: string|null,
 *   workflowRunId?: string|null,
 *   roadblockEmitted: { value: boolean },
 * }} rb
 * @param {Record<string, unknown>} task
 * @param {string} msg
 */
async function maybeEmitPlanRoadblock(env, ctx, emit, rb, task, msg) {
  if (rb.roadblockEmitted.value) return;
  rb.roadblockEmitted.value = true;
  try {
    if (typeof emitPlanRoadblockQuestions !== 'function') return;
    await emitPlanRoadblockQuestions(env, ctx, emit, {
      planId: rb.planId,
      workflowRunId: rb.workflowRunId ?? null,
      tenantId: rb.tenantId,
      workspaceId: rb.workspaceId,
      userId: rb.userId ?? null,
      sessionId: rb.sessionId ?? null,
      goal: rb.planTitle || rb.planId,
      roadblock: {
        task_id: task.id,
        task_title: task.title,
        error: msg,
      },
    });
  } catch (e) {
    console.warn('[executePlan] roadblock questions', e?.message ?? e);
  }
}

async function markPlanTaskFailed(env, task, message, emit, cap, roadblockCtx = null) {
  const msg = String(message || 'failed').slice(0, 4000);
  await env.DB.prepare(
    `UPDATE agentsam_plan_tasks SET status='blocked', completed_at=unixepoch(), output_summary=?, error_trace=? WHERE id=?`,
  )
    .bind(msg, msg, task.id)
    .run();
  emit('task_complete', {
    task_id: task.id,
    title: task.title,
    status: 'failed',
    error: msg,
    order_index: task.order_index,
  });
  await patchPlanExecutionStep(env, task, 'failed', {
    outputJson: JSON.stringify({ capability_type: cap, error: msg }),
    errorJson: JSON.stringify({ error: msg }),
  });
  if (roadblockCtx?.ctx) {
    await maybeEmitPlanRoadblock(
      env,
      roadblockCtx.ctx,
      emit,
      roadblockCtx,
      task,
      msg,
    );
  }
}

async function executePlan(
  env,
  {
    planId,
    userId,
    workspaceId: workspaceIdIn,
    tenantId: tenantIdIn,
    emit,
    ctx = null,
    onlyTaskId = null,
    sessionId = null,
    skipPlanAggregate = false,
    workflowRunId = null,
    request = null,
    commandRuntime = null,
  },
) {
  if (!env.DB) {
    emit('text', { text: '[Agent Sam] Database is not available; plan tasks were not executed.' });
    return;
  }

  let tenantId = tenantIdIn != null && String(tenantIdIn).trim() !== '' ? String(tenantIdIn).trim() : null;
  let workspaceId =
    workspaceIdIn != null && String(workspaceIdIn).trim() !== '' ? String(workspaceIdIn).trim() : '';

  const resolvedTw = await resolvePlanTenantWorkspace(env, { planId, tenantId, workspaceId, userId });
  tenantId = resolvedTw.tenantId;
  workspaceId = resolvedTw.workspaceId;
  if (!tenantId) {
    emit('text', {
      text: '[Agent Sam] **Tenant not resolved** for this plan. Ensure you are logged in and have a tenant on your account, or that the plan has `tenant_id` set.',
    });
    return;
  }

  const wfStarted = Date.now();
  let wfRun = workflowRunId != null && String(workflowRunId).trim() !== '' ? String(workflowRunId).trim() : null;
  if (!wfRun) {
    const pr = await env.DB
      .prepare(`SELECT workflow_run_id FROM agentsam_plans WHERE id = ? LIMIT 1`)
      .bind(planId)
      .first()
      .catch(() => null);
    if (pr?.workflow_run_id != null && String(pr.workflow_run_id).trim() !== '') {
      wfRun = String(pr.workflow_run_id).trim();
    }
  }

  let taskSql = `SELECT * FROM agentsam_plan_tasks
    WHERE plan_id = ? AND status IN ('todo','in_progress')
    ORDER BY order_index ASC`;
  const binds = [planId];
  if (onlyTaskId != null && String(onlyTaskId).trim() !== '') {
    taskSql = `SELECT * FROM agentsam_plan_tasks
    WHERE plan_id = ? AND id = ? AND status IN ('todo','in_progress','skipped')
    ORDER BY order_index ASC LIMIT 1`;
    binds.push(String(onlyTaskId).trim());
  }

  const { results: tasks } = await env.DB.prepare(taskSql).bind(...binds).all();

  const planMeta = await env.DB.prepare(`SELECT title, workflow_run_id FROM agentsam_plans WHERE id = ? LIMIT 1`)
    .bind(planId)
    .first()
    .catch(() => null);
  const roadblockCtx = {
    planId,
    planTitle: String(planMeta?.title || planId),
    tenantId,
    workspaceId,
    userId,
    sessionId,
    workflowRunId: wfRun ?? planMeta?.workflow_run_id ?? null,
    roadblockEmitted: { value: false },
    ctx,
  };

  if (!tasks || tasks.length === 0) {
    emit('text', { text: onlyTaskId ? '[Agent Sam] No runnable plan task found for resume.' : '[Agent Sam] No pending plan tasks.' });
    return;
  }

  let completed = 0;
  let failed = 0;
  let skipped = 0;
  /** @type {PlanWrittenArtifact[]} */
  const planWrittenArtifacts = [];

  for (const task of tasks || []) {
    const capForStart = resolvePlanTaskCapabilityType(task);
    emit('task_start', {
      task_id: task.id,
      title: task.title,
      description: task.description,
      order_index: task.order_index,
      handler_type: task.handler_type,
      capability_type: capForStart,
      execution_step_id: task.execution_step_id,
      command_run_id: task.command_run_id,
      total_tasks: tasks.length,
    });

    await env.DB
      .prepare(`UPDATE agentsam_plan_tasks SET status='in_progress', started_at=unixepoch() WHERE id=?`)
      .bind(task.id)
      .run();

    await patchPlanExecutionStep(env, task, 'running', { skipCompleted: true });

    let output = null;
    let ok = true;

    const cap = resolvePlanTaskCapabilityType(task);
    const isPlaywrightScript = task.handler_type === 'script' && cap === 'playwright_validation';
    const terminalLike = task.handler_type === 'terminal' || isPlaywrightScript;

    try {
      if (cap === 'browser_capture') {
        if (!planWrittenArtifacts.length) {
          skipped++;
          await markPlanTaskSkipped(
            env,
            task,
            'Generated files are ready in the code editor. Browser preview was skipped because no saved preview URL exists yet.',
            emit,
            cap,
          );
          continue;
        }

        const urlMatch = String(task.description || '').match(/https?:\/\/[^\s"'<>)]+/i);
        let previewUrl = urlMatch ? urlMatch[0].replace(/[.,;]+$/, '') : '';
        if (!isAbsoluteHttpUrl(previewUrl)) {
          const htmlArt =
            planWrittenArtifacts.find((a) => /\.html?$/i.test(a.path)) || planWrittenArtifacts[0];
          previewUrl = htmlArt?.previewUrl || '';
        }
        if (!isAbsoluteHttpUrl(previewUrl)) {
          skipped++;
          await markPlanTaskSkipped(
            env,
            task,
            'Generated files are ready in the code editor. Browser preview was skipped because no saved preview URL exists yet.',
            emit,
            cap,
          );
          continue;
        }
        if (isR2ApiPreviewUrl(previewUrl)) {
          skipped++;
          await markPlanTaskSkipped(
            env,
            task,
            'Generated files are ready in the code editor. Browser preview was skipped — save or publish for a preview URL.',
            emit,
            cap,
          );
          continue;
        }
        if (isHomepagePreviewUrl(previewUrl, env)) {
          skipped++;
          await markPlanTaskSkipped(
            env,
            task,
            'Preview skipped — homepage is not a valid artifact target. Open files in the code editor.',
            emit,
            cap,
          );
          continue;
        }
        if (!wfRun) {
          skipped++;
          await markPlanTaskSkipped(
            env,
            task,
            'No deployable preview URL — workflow run missing. Open files in the code editor.',
            emit,
            cap,
          );
          continue;
        }

        emit('surface_open', { surface: 'browser', reason: 'plan_task_browser_capture', url: previewUrl });
        emit('agent_surface_open', { surface: 'browser', reason: 'plan_task_browser_capture', url: previewUrl });
        if (typeof runBrowserCapabilityAction !== 'function') {
          throw new Error('browser_capability_unavailable');
        }
        const br = await runBrowserCapabilityAction({
          env,
          runId: wfRun,
          tenantId,
          workspaceId: workspaceId || '',
          userId: userId || '',
          message: `${task.title}\n${task.description || ''}`,
          browserContext: { url: previewUrl },
          emit,
        });
        const bout = br?.output && typeof br.output === 'object' ? br.output : {};
        const screenshotUrl =
          bout.screenshot_url != null
            ? String(bout.screenshot_url)
            : bout.screenshot?.screenshot_url != null
              ? String(bout.screenshot.screenshot_url)
              : null;
        const domSummary =
          typeof bout.content_excerpt === 'string'
            ? bout.content_excerpt.slice(0, 12000)
            : typeof bout.title === 'string'
              ? bout.title.slice(0, 2000)
              : null;
        const consoleErrors = Array.isArray(bout.console_errors)
          ? bout.console_errors
          : Array.isArray(bout.console)
            ? bout.console
            : [];
        const summaryText = br?.ok
          ? `[browser_capture] ${previewUrl}\nScreenshot: ${screenshotUrl || 'n/a'}\nDOM excerpt length: ${domSummary ? domSummary.length : 0}`
          : `[browser_capture] failed: ${String(br?.error || 'unknown')}`;
        await env.DB
          .prepare(
            `UPDATE agentsam_plan_tasks SET status=?, completed_at=unixepoch(), output_summary=? WHERE id=?`,
          )
          .bind(br?.ok ? 'done' : 'blocked', String(summaryText).slice(0, 4000), task.id)
          .run();
        if (br?.ok) {
          completed++;
          emit('task_complete', {
            task_id: task.id,
            title: task.title,
            status: 'done',
            output: String(summaryText).slice(0, 2000),
            order_index: task.order_index,
          });
          await patchPlanExecutionStep(env, task, 'success', {
            outputJson: JSON.stringify({
              capability_type: cap,
              screenshot_url: screenshotUrl,
              dom_summary: domSummary,
              console_errors: consoleErrors,
              artifact_pointer: screenshotUrl,
              url: previewUrl,
            }),
            latencyMs: null,
          });
        } else {
          failed++;
          emit('task_complete', {
            task_id: task.id,
            title: task.title,
            status: 'failed',
            error: String(br?.error || 'browser_capture_failed').slice(0, 2000),
            order_index: task.order_index,
          });
          await patchPlanExecutionStep(env, task, 'failed', {
            outputJson: JSON.stringify({ capability_type: cap, error: String(br?.error || '') }),
            errorJson: JSON.stringify({ error: String(br?.error || '') }),
          });
        }
        continue;
      }

      if (cap === 'excalidraw_diagram') {
        if (!wfRun) {
          skipped++;
          emit('task_complete', {
            task_id: task.id,
            title: task.title,
            status: 'skipped',
            output: '[excalidraw_diagram] workflow_run_id missing',
            order_index: task.order_index,
          });
          continue;
        }
        emit('surface_open', { surface: 'excalidraw', reason: 'plan_task_excalidraw_diagram' });
        emit('agent_surface_open', { surface: 'excalidraw', reason: 'plan_task_excalidraw_diagram' });
        if (typeof runExcalidrawCapabilityAction !== 'function') {
          throw new Error('excalidraw_capability_unavailable');
        }
        const xr = await runExcalidrawCapabilityAction({
          env,
          runId: wfRun,
          tenantId,
          workspaceId: workspaceId || '',
          userId: userId || '',
          message: `${task.title}\n${task.description || ''}`,
          emit,
        });
        const scene = xr?.output?.scene ?? null;
        const summaryText = xr?.ok
          ? `[excalidraw_diagram] scene elements: ${scene?.elements?.length ?? 0}`
          : `[excalidraw_diagram] failed: ${String(xr?.error || 'unknown')}`;
        await env.DB
          .prepare(
            `UPDATE agentsam_plan_tasks SET status=?, completed_at=unixepoch(), output_summary=? WHERE id=?`,
          )
          .bind(xr?.ok ? 'done' : 'blocked', String(summaryText).slice(0, 4000), task.id)
          .run();
        if (xr?.ok) {
          completed++;
          emit('task_complete', {
            task_id: task.id,
            title: task.title,
            status: 'done',
            output: String(summaryText).slice(0, 2000),
            order_index: task.order_index,
          });
          await patchPlanExecutionStep(env, task, 'success', {
            outputJson: JSON.stringify({
              capability_type: cap,
              diagram_json: scene,
              artifact_pointer: scene ? 'inline:excalidraw_scene' : null,
            }),
          });
        } else {
          failed++;
          emit('task_complete', {
            task_id: task.id,
            title: task.title,
            status: 'failed',
            error: String(xr?.error || '').slice(0, 2000),
            order_index: task.order_index,
          });
          await patchPlanExecutionStep(env, task, 'failed', {
            outputJson: JSON.stringify({ capability_type: cap, error: String(xr?.error || '') }),
            errorJson: JSON.stringify({ error: String(xr?.error || '') }),
          });
        }
        continue;
      }

      if (
        cap === 'monaco_edit' &&
        (task.handler_type === 'agent' ||
          !task.handler_type ||
          (task.handler_type === 'mcp_tool' && String(task.handler_key || '').startsWith('cap:')))
      ) {
        emit('surface_open', { surface: 'code', reason: 'plan_task_monaco_edit' });
        emit('agent_surface_open', { surface: 'code', reason: 'plan_task_monaco_edit' });

        let mergedFiles = [];
        try {
          const existing = JSON.parse(String(task.files_involved || '[]'));
          if (Array.isArray(existing)) {
            mergedFiles = existing.map((x) => String(x).trim()).filter(Boolean);
          }
        } catch {
          /* ignore */
        }
        if (!mergedFiles.length) {
          failed++;
          await markPlanTaskFailed(env, task, 'monaco_edit: no files_involved paths to write', emit, cap, roadblockCtx);
          continue;
        }

        const fileGenSys = `You are Agent Sam implementing files for a plan task.
Return ONLY valid JSON (no markdown fences):
{"patch_summary":"one short paragraph","files":[{"path":"relative/path.ext","find":"exact text to replace (preferred for edits)","replace":"replacement text","replace_all":false,"content":"full file body ONLY when creating a new file or full rewrite is required"}]}
Rules:
- Prefer find/replace (surgical) for existing files — exact unique match.
- Use content only for new files or explicit full rewrites.
- Include every path listed in files_involved.
- path must be repo-relative (no .. segments).`;
        const resolved = await resolveTaskExecutorModelKey(env, workspaceId);
        const modelKey = resolved.model_key;
        const genResult = await dispatchComplete(env, {
          modelKey,
          taskType: 'code',
          systemPrompt: fileGenSys,
          messages: [
            {
              role: 'user',
              content: `Task: ${task.title}\nfiles_involved: ${JSON.stringify(mergedFiles)}\n\n${task.description || ''}`,
            },
          ],
          options: { reasoningEffort: 'medium', verbosity: 'low' },
        });
        try {
          if (resolved?.routing_arm_id && recordArmOutcome) {
            await recordArmOutcome(
              env, ctx, resolved.routing_arm_id, genResult?.ok ?? true,
              { model_key: resolved.model_key }
            );
          }
        } catch (_) {}
        const genRaw = genResult?.text || genResult?.output_text || '';
        let parsedGen = null;
        try {
          parsedGen = JSON.parse(genRaw.replace(/```json|```/g, '').trim());
        } catch {
          parsedGen = { patch_summary: genRaw.slice(0, 2000), files: [] };
        }
        /** @type {Map<string, Record<string, unknown>>} */
        const generatedByPath = new Map();
        if (Array.isArray(parsedGen?.files)) {
          for (const f of parsedGen.files) {
            const p = f?.path != null ? String(f.path).trim() : '';
            if (!p) continue;
            generatedByPath.set(p, f && typeof f === 'object' ? f : {});
            const base = p.split('/').pop() || '';
            if (base && !generatedByPath.has(base)) generatedByPath.set(base, f);
          }
        }

        let githubRepo = '';
        let githubBranch = '';
        try {
          const hc =
            task.handler_config != null
              ? typeof task.handler_config === 'string'
                ? JSON.parse(task.handler_config)
                : task.handler_config
              : null;
          githubRepo = String(
            hc?.github_repo || hc?.repo || task.github_repo || parsedGen?.github_repo || '',
          ).trim();
          githubBranch = String(
            hc?.branch ||
              hc?.ref ||
              task.branch ||
              task.ref ||
              parsedGen?.branch ||
              parsedGen?.ref ||
              '',
          ).trim();
        } catch {
          githubRepo = String(task.github_repo || parsedGen?.github_repo || '').trim();
          githubBranch = String(task.branch || task.ref || parsedGen?.branch || parsedGen?.ref || '').trim();
        }
        const useGithub = githubRepo.includes('/');

        const privilegedCtx = {
          userId,
          user_id: userId,
          workspaceId,
          workspace_id: workspaceId,
          tenantId,
          tenant_id: tenantId,
          sessionId,
          request: request || null,
          privileged_plan_execute: true,
        };

        const writeReceipts = [];
        let writeFailed = false;
        for (const relPath of mergedFiles) {
          const spec =
            generatedByPath.get(relPath) ||
            generatedByPath.get(relPath.split('/').pop() || '') ||
            null;
          if (!spec) {
            failed++;
            writeFailed = true;
            await markPlanTaskFailed(
              env,
              task,
              `Generation failed: ${relPath} (no generated content)`,
              emit,
              cap,
              roadblockCtx,
            );
            break;
          }
          const find =
            spec.find != null
              ? String(spec.find)
              : spec.old_text != null
                ? String(spec.old_text)
                : '';
          const replace =
            spec.replace != null
              ? String(spec.replace)
              : spec.new_text != null
                ? String(spec.new_text)
                : null;
          const fullContent = spec.content != null ? String(spec.content) : '';
          const replaceAll = spec.replace_all === true || spec.replaceAll === true;

          let out = null;
          let lane = 'local';
          try {
            if (useGithub) {
              const ghHandlers = githubHandlers || {};
              const ghParams = {
                user_id: userId,
                repo: githubRepo,
                path: relPath,
                branch: String(spec.branch || spec.ref || githubBranch).trim(),
              };
              if (find && replace != null) {
                out = await ghHandlers.github_patch_file(
                  { ...ghParams, find, replace, replace_all: replaceAll },
                  env,
                );
                lane = 'github_patch';
              } else if (fullContent) {
                out = await ghHandlers.github_upsert_file(
                  {
                    ...ghParams,
                    content: fullContent,
                    message: `plan ${planId}: ${task.title || relPath}`.slice(0, 200),
                  },
                  env,
                );
                lane = 'github_write';
              } else {
                out = { error: 'monaco_edit_missing_find_or_content', path: relPath };
              }
            } else if (find && replace != null) {
              if (typeof executeFsEditFile !== 'function') throw new Error('fs_edit_capability_unavailable');
              out = await executeFsEditFile(
                env,
                { path: relPath, find, replace, replace_all: replaceAll },
                privilegedCtx,
              );
              lane = 'fs_edit_file';
            } else if (fullContent) {
              if (typeof executeFsWriteFile !== 'function') throw new Error('fs_write_capability_unavailable');
              out = await executeFsWriteFile(env, { path: relPath, content: fullContent }, privilegedCtx);
              lane = 'fs_write_file';
            } else {
              out = { error: 'monaco_edit_missing_find_or_content', path: relPath };
            }
          } catch (e) {
            out = { error: String(e?.message || e).slice(0, 500), path: relPath };
          }

          const err =
            out?.error ||
            (out?.success === false ? String(out?.message || out?.error || 'write_failed') : null);
          if (err) {
            failed++;
            writeFailed = true;
            await markPlanTaskFailed(
              env,
              task,
              `monaco_edit ${lane} failed for ${relPath}: ${err}`,
              emit,
              cap,
              roadblockCtx,
            );
            break;
          }

          const contentForUi =
            fullContent ||
            (typeof out?.after === 'string' ? out.after : '') ||
            (typeof out?.content === 'string' ? out.content : '') ||
            '';
          writeReceipts.push({
            path: relPath,
            lane,
            bytes: contentForUi.length || Number(out?.bytes_written || 0) || 0,
            lines_added: out?.lines_added ?? null,
            lines_removed: out?.lines_removed ?? null,
          });
          if (contentForUi) {
            planWrittenArtifacts.push({
              path: relPath,
              content: contentForUi,
              language: languageForPlanFile(relPath),
              draft: false,
            });
            emit('monaco_file_generated', {
              type: 'monaco_file_generated',
              surface: 'monaco',
              filename: relPath.split('/').pop() || relPath,
              path: relPath,
              language: languageForPlanFile(relPath),
              content: contentForUi,
              plan_id: planId,
              task_id: task.id,
              workflow_run_id: wfRun || null,
              persisted: true,
              lane,
            });
          }
        }

        if (writeFailed) {
          continue;
        }

        emit('monaco_files_generated', {
          type: 'monaco_files_generated',
          surface: 'monaco',
          plan_id: planId,
          task_id: task.id,
          workflow_run_id: wfRun || null,
          files: writeReceipts,
          persisted: true,
        });

        await env.DB
          .prepare(`UPDATE agentsam_plan_tasks SET files_involved = ? WHERE id = ?`)
          .bind(JSON.stringify(mergedFiles), task.id)
          .run()
          .catch(() => {});

        const summary = String(
          parsedGen?.patch_summary ||
            `Persisted ${writeReceipts.length} file(s) via privileged Build (${writeReceipts.map((r) => r.lane).join(', ')}).`,
        ).slice(0, 4000);
        output = summary;
        await env.DB
          .prepare(
            `UPDATE agentsam_plan_tasks SET status='done', completed_at=unixepoch(), output_summary=? WHERE id=?`,
          )
          .bind(summary, task.id)
          .run();
        completed++;
        emit('task_complete', {
          task_id: task.id,
          title: task.title,
          status: 'done',
          output: summary.slice(0, 2000),
          order_index: task.order_index,
        });
        await patchPlanExecutionStep(env, task, 'success', {
          outputJson: JSON.stringify({
            capability_type: cap,
            storage: useGithub ? 'github_api' : 'workspace_pty',
            files_written: writeReceipts,
            patch_summary: summary,
          }),
        });
        continue;
      }

      if (task.handler_type === 'agent' || !task.handler_type) {
        const result = await executeAgentPlanTask({
          env,
          ctx,
          task,
          workspaceId,
          dispatchComplete,
          resolveTaskExecutorModelKey,
          recordArmOutcome,
          reasoningEffort: 'medium',
          verbosity: 'low',
        });
        output = result.output;
        ok = result.ok;
      } else if (terminalLike) {
        const cmd = shellCommandForTerminalTask(task).trim();

        const stubCtx =
          ctx && typeof ctx.waitUntil === 'function'
            ? ctx
            : { waitUntil: (fn) => void Promise.resolve(typeof fn === 'function' ? fn() : fn).catch(() => {}) };

        const authz = await authorizePlanTerminalExecution(env, ctx, {
          task,
          planId,
          userId,
          workspaceId,
          tenantId,
          sessionId: sessionId || null,
          commandRuntime,
        });

        if (authz.allowed && !cmd) {
          output =
            '[terminal] NOT EXECUTED: put the shell command in the task description when handler_key is an agentsam_commands id (cmd:… prefix).';
          await env.DB
            .prepare(
              `UPDATE agentsam_plan_tasks
        SET status='skipped', completed_at=unixepoch(), output_summary=?
        WHERE id=?`,
            )
            .bind(String(output || '').slice(0, 4000), task.id)
            .run();
          skipped++;
          emit('task_complete', {
            task_id: task.id,
            title: task.title,
            status: 'skipped',
            output: String(output || '').slice(0, 2000),
            order_index: task.order_index,
          });
          continue;
        }

        if (!authz.allowed) {
          if (cmd && (authz.reason === 'no_gate' || authz.reason === 'command_not_found')) {
            const prop = await ensurePlanTerminalApprovalProposal(env, {
              task,
              planId,
              userId,
              workspaceId,
              tenantId,
              sessionId,
              cmd,
              emit,
            });
            if (prop?.ok) {
              skipped++;
              await env.DB
                .prepare(
                  `UPDATE agentsam_plan_tasks SET status='todo', started_at=NULL, completed_at=NULL,
                   output_summary = CASE WHEN trim(coalesce(output_summary,'')) = '' THEN ? ELSE output_summary END WHERE id=?`,
                )
                .bind('[terminal] Awaiting explicit approval — use Allow, then resume this task.', task.id)
                .run()
                .catch(() => {});
              await patchPlanExecutionStep(env, task, 'approval_pending', { skipCompleted: true });
              emit('task_complete', {
                task_id: task.id,
                title: task.title,
                status: 'skipped',
                output:
                  '[terminal] Approval required — click **Allow** on the card, then confirm execution resumes for this task.',
                order_index: task.order_index,
              });
              continue;
            }
          }

          if (authz.reason === 'pending_approval' && authz.approval_id) {
            const pre = authz.command_preview || cmd.slice(0, 2000);
            const cr = authz.command_run_id != null ? String(authz.command_run_id).trim() : '';
            if (cr) {
              await env.DB
                .prepare(
                  `UPDATE agentsam_plan_tasks SET command_run_id = COALESCE(?, command_run_id), output_summary = ?, status = 'skipped', completed_at = unixepoch() WHERE id = ?`,
                )
                .bind(
                  cr,
                  '[terminal] Catalog command awaiting explicit approval — click Allow, then use resume for this task.',
                  task.id,
                )
                .run();
            } else {
              await env.DB
                .prepare(
                  `UPDATE agentsam_plan_tasks SET output_summary = ?, status = 'skipped', completed_at = unixepoch() WHERE id = ?`,
                )
                .bind(authz.userMessage || '[terminal] Awaiting approval.', task.id)
                .run();
            }
            skipped++;
            emit('approval_required', {
              task_id: task.id,
              command_run_id: cr || undefined,
              approval_id: authz.approval_id,
              title: String(task.title || 'Terminal'),
              command_preview: pre,
              risk_level: 'medium',
              action_summary: 'Approve catalog-linked terminal command before execution.',
              plan_id: planId,
              workflow_run_id: wfRun || undefined,
              execution_step_id: task.execution_step_id != null ? String(task.execution_step_id) : undefined,
            });
            emit('task_complete', {
              task_id: task.id,
              title: task.title,
              status: 'skipped',
              output: authz.userMessage || '[terminal] Awaiting approval.',
              order_index: task.order_index,
            });
            continue;
          }

          output = authz.userMessage || `[terminal] NOT EXECUTED (${authz.reason || 'denied'})`;
          await env.DB
            .prepare(
              `UPDATE agentsam_plan_tasks
        SET status='skipped', completed_at=unixepoch(), output_summary=?
        WHERE id=?`,
            )
            .bind(String(output || '').slice(0, 4000), task.id)
            .run();
          skipped++;
          emit('task_complete', {
            task_id: task.id,
            title: task.title,
            status: 'skipped',
            output: String(output || '').slice(0, 2000),
            order_index: task.order_index,
          });
          continue;
        }

        const t0 = Date.now();
        if (
          typeof resolveIdentityScopedGcpCwd !== 'function' ||
          typeof loadWorkspaceSettingsJson !== 'function'
        ) {
          throw new Error('terminal_capability_unavailable');
        }
        const settings = workspaceId ? await loadWorkspaceSettingsJson(env, workspaceId) : null;
        const scoped = await resolveIdentityScopedGcpCwd({
          userId,
          tenantId,
          workspaceId,
          settings,
          env,
        });
        if (!scoped.ok) {
          output = `[terminal] NOT EXECUTED: ${scoped.user_message || scoped.error}`;
          await env.DB
            .prepare(
              `UPDATE agentsam_plan_tasks
        SET status='skipped', completed_at=unixepoch(), output_summary=?
        WHERE id=?`,
            )
            .bind(String(output || '').slice(0, 4000), task.id)
            .run();
          skipped++;
          emit('task_complete', {
            task_id: task.id,
            title: task.title,
            status: 'skipped',
            output: String(output || '').slice(0, 2000),
            order_index: task.order_index,
          });
          continue;
        }
        const terminalDispatch = await dispatchByToolCode(
          env,
          'agentsam_terminal_remote',
          { command: cmd, cwd: scoped.cwd },
          { tenantId, workspaceId, userId, sessionId, source_client: 'agentsam_plan' },
        );
        const terminalResult = terminalDispatch?.result ?? terminalDispatch?.body ?? {};
        const terminalText =
          terminalResult?.text ?? terminalResult?.stdout ?? terminalResult?.output ?? terminalDispatch?.error ?? '';
        const http = { ok: terminalDispatch?.ok === true, text: String(terminalText || '') };
        const durationMs = Math.max(0, Date.now() - t0);

        const commandRunIdForTelemetry =
          (authz.command_run_id != null && String(authz.command_run_id).trim()) ||
          (task.command_run_id != null && String(task.command_run_id).trim()) ||
          '';
        if (commandRunIdForTelemetry && typeof commandRuntime?.completeCommand === 'function') {
          await commandRuntime.completeCommand(env, stubCtx, {
            commandRunId: commandRunIdForTelemetry,
            success: !!http?.ok,
            durationMs,
            outputSummary: http?.ok ? String(http.text || '').slice(0, 8000) : null,
            errorMessage: http?.ok ? null : 'terminal_http_exec_failed',
          });
        }

        if (!http?.ok) {
          failed++;
          output = `[terminal] Authorized but execution failed (HTTP exec / PTY bridge). Command: ${cmd.slice(0, 400)}`;
          await env.DB
            .prepare(
              `UPDATE agentsam_plan_tasks
        SET status='blocked', error_trace=?, completed_at=unixepoch()
        WHERE id=?`,
            )
            .bind(String(output || '').slice(0, 2000), task.id)
            .run();
          emit('task_complete', {
            task_id: task.id,
            title: task.title,
            status: 'failed',
            error: String(output || '').slice(0, 2000),
            order_index: task.order_index,
          });
          await patchPlanExecutionStep(env, task, 'failed', {
            outputJson: JSON.stringify({ error: String(output || '').slice(0, 2000) }),
          });
          await maybeEmitPlanRoadblock(
            env,
            ctx,
            emit,
            roadblockCtx,
            task,
            String(output || '').slice(0, 2000),
          );
          continue;
        }

        output = `[terminal] executed (${authz.via || 'authorized'})\n${String(http.text || '').slice(0, 3500)}`;
        await env.DB
          .prepare(
            `UPDATE agentsam_plan_tasks
        SET status='done', completed_at=unixepoch(), output_summary=?
        WHERE id=?`,
          )
          .bind(String(output || '').slice(0, 4000), task.id)
          .run();
        completed++;
        emit('task_complete', {
          task_id: task.id,
          title: task.title,
          status: 'done',
          output: String(output || '').slice(0, 2000),
          order_index: task.order_index,
        });
        await patchPlanExecutionStep(env, task, 'success', {
          outputJson: JSON.stringify({
            terminal: true,
            preview: String(http.text || '').slice(0, 4000),
          }),
          latencyMs: durationMs,
        });
        continue;
      } else if (task.handler_type === 'db_query') {
        const crDb = task.command_run_id != null ? String(task.command_run_id).trim() : '';
        const esDb = task.execution_step_id != null ? String(task.execution_step_id).trim() : '';
        if (crDb && esDb) {
          const okApr = await isCommandRunApprovedForTerminal(env, crDb, task);
          if (!okApr) {
            skipped++;
            const qDb = await findPendingApprovalForCommandRun(env, crDb);
            await env.DB
              .prepare(
                `UPDATE agentsam_plan_tasks SET status='todo', output_summary = ? WHERE id = ?`,
              )
              .bind('[db_query] Awaiting approval for linked command_run before execution.', task.id)
              .run();
            emit('approval_required', {
              task_id: task.id,
              command_run_id: crDb,
              approval_id: qDb?.id != null ? String(qDb.id) : undefined,
              title: String(task.title || 'Database'),
              command_preview: String(task.description || '').slice(0, 2000),
              risk_level: 'high',
              action_summary: 'Approve risky db_query plan task before execution.',
              plan_id: planId,
              workflow_run_id: wfRun || undefined,
              execution_step_id: task.execution_step_id != null ? String(task.execution_step_id) : undefined,
            });
            emit('task_complete', {
              task_id: task.id,
              title: task.title,
              status: 'skipped',
              output: '[db_query] Awaiting approval — click **Allow**, then resume this task.',
              order_index: task.order_index,
            });
            await patchPlanExecutionStep(env, task, 'approval_pending', { skipCompleted: true });
            continue;
          }
        }
        const resolved = await resolveTaskExecutorModelKey(env, workspaceId);
        const modelKey = resolved.model_key;
        const result = await dispatchComplete(env, {
          modelKey,
          systemPrompt:
            'You are a D1 database assistant. Describe what query you would run and what it returns.',
          messages: [{ role: 'user', content: task.description || task.title }],
          options: { reasoningEffort: 'low', verbosity: 'low' },
        });
        try {
          if (resolved?.routing_arm_id && recordArmOutcome) {
            await recordArmOutcome(
              env, ctx, resolved.routing_arm_id, result?.ok ?? true,
              { model_key: resolved.model_key }
            );
          }
        } catch (_) {}
        output = result?.text || result?.output_text || '';
      } else if (task.handler_type === 'mcp_tool') {
        const wk = String(task.handler_key || '').trim();
        if (wk && !wk.startsWith('cap:')) {
          const wResult = await dispatchByToolCode(
            env,
            'agentsam_run_agent',
            {
              workflow_key: wk,
              input: { message: task.description || task.title },
              tenant_id: tenantId,
              workspace_id: workspaceId || '',
              user_id: userId,
              trigger_type: 'agent',
            },
            { tenantId, workspaceId: workspaceId || '', userId },
          );
          const workflowResult = wResult?.result ?? wResult;
          output = workflowResult?.ok
            ? JSON.stringify(workflowResult.output ?? workflowResult.journal_steps ?? {})
            : `Workflow failed: ${workflowResult?.error ?? workflowResult?.kill_reason ?? 'unknown'}`;
          ok = !!workflowResult?.ok;
        } else {
          const result = await executeAgentPlanTask({
            env,
            ctx,
            task,
            workspaceId,
            dispatchComplete,
            resolveTaskExecutorModelKey,
            recordArmOutcome,
          });
          output = result.output;
          ok = result.ok;
        }
      } else {
        const result = await executeAgentPlanTask({
          env,
          ctx,
          task,
          workspaceId,
          dispatchComplete,
          resolveTaskExecutorModelKey,
          recordArmOutcome,
        });
        output = result.output;
        ok = result.ok;
      }

      if (ok) {
        await env.DB
          .prepare(
            `UPDATE agentsam_plan_tasks
        SET status='done', completed_at=unixepoch(), output_summary=?
        WHERE id=?`,
          )
          .bind(String(output || '').slice(0, 4000), task.id)
          .run();

        completed++;
        emit('task_complete', {
          task_id: task.id,
          title: task.title,
          status: 'done',
          output: String(output || '').slice(0, 2000),
          order_index: task.order_index,
        });
        await patchPlanExecutionStep(env, task, 'success', {
          outputJson: JSON.stringify({ summary: String(output || '').slice(0, 4000) }),
        });
      } else {
        failed++;
        const errMsg = String(output || 'workflow failed').slice(0, 2000);
        await env.DB
          .prepare(
            `UPDATE agentsam_plan_tasks
        SET status='blocked', error_trace=?, completed_at=unixepoch()
        WHERE id=?`,
          )
          .bind(errMsg, task.id)
          .run();

        emit('task_complete', {
          task_id: task.id,
          title: task.title,
          status: 'failed',
          error: errMsg,
          order_index: task.order_index,
        });
        await patchPlanExecutionStep(env, task, 'failed', {
          outputJson: JSON.stringify({ error: errMsg }),
        });
        await maybeEmitPlanRoadblock(env, ctx, emit, roadblockCtx, task, errMsg);
      }
    } catch (e) {
      failed++;
      const errMsg = e?.message ?? String(e);
      await env.DB
        .prepare(
          `UPDATE agentsam_plan_tasks
        SET status='blocked', error_trace=?, completed_at=unixepoch()
        WHERE id=?`,
        )
        .bind(errMsg.slice(0, 2000), task.id)
        .run();

      emit('task_complete', {
        task_id: task.id,
        title: task.title,
        status: 'failed',
        error: errMsg,
        order_index: task.order_index,
      });
      await patchPlanExecutionStep(env, task, 'failed', {
        outputJson: JSON.stringify({ error: errMsg }),
      });
      await maybeEmitPlanRoadblock(env, ctx, emit, roadblockCtx, task, errMsg);
    }
  }

  if (!skipPlanAggregate) {
    await env.DB
      .prepare(
        `UPDATE agentsam_plans
    SET tasks_done=?,
        tasks_blocked = COALESCE(tasks_blocked, 0) + ?,
        status=CASE WHEN ?=0 THEN 'complete' ELSE 'active' END,
        updated_at=unixepoch()
    WHERE id=?`,
      )
      .bind(completed, skipped, failed, planId)
      .run();

    emit('plan_complete', {
      plan_id: planId,
      tasks_completed: completed,
      tasks_failed: failed,
      tasks_skipped: skipped,
      status: failed === 0 ? 'complete' : 'partial',
    });
  } else {
    emit('plan_task_resume_complete', {
      plan_id: planId,
      task_id: onlyTaskId,
      tasks_completed: completed,
      tasks_failed: failed,
      tasks_skipped: skipped,
      status: failed === 0 ? 'ok' : 'partial',
    });
  }
  return { completed, failed, skipped, durationMs: Math.max(0, Date.now() - wfStarted) };
}

  return { executePlan };
}
