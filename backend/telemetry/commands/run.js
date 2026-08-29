/** Canonical agentsam_command_run lifecycle writer. */
import {
  ensureExecutionParent,
  finishExecutionForRun,
} from '../executions/ledger.js';
import { recordCommandPerformance } from './performance.js';

function trim(value) {
  return value == null ? '' : String(value).trim();
}
function integer(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}
function bounded(value, max) {
  const text = value == null ? '' : String(value);
  return text ? text.slice(0, max) : null;
}
function normalizeIntentCategory(value) {
  const raw = trim(value).toLowerCase();
  if (['deploy','debug','db','r2','git','worker','search','file','misc'].includes(raw)) return raw;
  if (raw === 'd1') return 'db';
  if (raw === 'research') return 'search';
  return raw ? 'misc' : null;
}
function json(value, max = 120000) {
  let text;
  try { text = JSON.stringify(value ?? {}); } catch { text = '{}'; }
  return text.length <= max ? text : JSON.stringify({ truncated: true, preview: text.slice(0, max - 80) });
}

export function createCommandRunId() {
  return `run_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export async function startCommandRun(env, p = {}) {
  if (!env?.DB) return { ok: false, reason: 'no_db' };
  const id = trim(p.commandRunId ?? p.command_run_id) || createCommandRunId();
  const workspaceId = trim(p.workspaceId ?? p.workspace_id);
  const tenantId = trim(p.tenantId ?? p.tenant_id);
  if (!workspaceId || !tenantId) return { ok: false, reason: 'command_scope_required' };

  const approvalStatus = trim(p.approvalStatus ?? p.approval_status) || 'not_required';
  const commands = Array.isArray(p.commands) ? p.commands : [];
  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_command_run
        (id, tenant_id, workspace_id, user_id, session_id, conversation_id,
         user_input, normalized_intent, intent_category, model_id,
         commands_json, result_json, success, selected_command_id, selected_command_slug,
         risk_level, requires_confirmation, approval_status, agent_run_id, exec_identity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         tenant_id = excluded.tenant_id,
         workspace_id = excluded.workspace_id,
         user_id = COALESCE(excluded.user_id, agentsam_command_run.user_id),
         session_id = COALESCE(excluded.session_id, agentsam_command_run.session_id),
         conversation_id = COALESCE(excluded.conversation_id, agentsam_command_run.conversation_id),
         selected_command_id = COALESCE(excluded.selected_command_id, agentsam_command_run.selected_command_id),
         selected_command_slug = COALESCE(excluded.selected_command_slug, agentsam_command_run.selected_command_slug),
         risk_level = excluded.risk_level,
         requires_confirmation = excluded.requires_confirmation,
         approval_status = excluded.approval_status,
         agent_run_id = COALESCE(excluded.agent_run_id, agentsam_command_run.agent_run_id),
         exec_identity = COALESCE(excluded.exec_identity, agentsam_command_run.exec_identity)`,
    ).bind(
      id,
      tenantId,
      workspaceId,
      trim(p.userId ?? p.user_id) || null,
      trim(p.sessionId ?? p.session_id) || null,
      trim(p.conversationId ?? p.conversation_id) || null,
      bounded(p.userInput ?? p.user_input ?? p.commandSlug ?? 'command', 2000) || 'command',
      bounded(p.normalizedIntent ?? p.normalized_intent, 500),
      normalizeIntentCategory(p.intentCategory ?? p.intent_category),
      trim(p.modelKey ?? p.model_id) || null,
      json(commands),
      json(p.result ?? {}),
      trim(p.commandId ?? p.selected_command_id) || null,
      trim(p.commandSlug ?? p.selected_command_slug) || null,
      trim(p.riskLevel ?? p.risk_level) || 'low',
      p.requiresConfirmation === true || Number(p.requires_confirmation) === 1 ? 1 : 0,
      approvalStatus,
      trim(p.agentRunId ?? p.agent_run_id) || null,
      trim(p.execIdentity ?? p.exec_identity) || null,
    ).run();
  } catch (error) {
    return { ok: false, commandRunId: id, reason: error?.message ?? String(error) };
  }

  if (p.executionContext && typeof p.executionContext === 'object') {
    const c = p.executionContext;
    await env.DB.prepare(
      `INSERT INTO agentsam_execution_context
        (command_run_id, tenant_id, workspace_id, todo_id, cwd, files_json, recent_error, goal, extra_json, context_tokens, execution_step_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, tenantId, workspaceId, trim(c.todoId) || null, trim(c.cwd) || null,
      json(c.files ?? [], 50000), bounded(c.recentError, 8000), bounded(c.goal, 8000),
      json(c.extra ?? {}, 50000), integer(c.contextTokens), trim(c.executionStepId) || null,
    ).run().catch(() => null);
  }

  if (approvalStatus !== 'pending_approval') {
    await ensureExecutionParent(env, {
      executionType: 'command',
      runId: id,
      executionKey: trim(p.commandSlug),
      tenantId,
      workspaceId,
      userId: trim(p.userId) || null,
      status: 'running',
    });
  }
  return { ok: true, commandRunId: id, reason: null };
}

export async function finishCommandRun(env, p = {}) {
  if (!env?.DB) return { ok: false, reason: 'no_db' };
  const id = trim(p.commandRunId ?? p.command_run_id);
  if (!id) return { ok: false, reason: 'command_run_id_required' };
  const success = p.success === true;
  const durationMs = integer(p.durationMs ?? p.duration_ms);
  const inputTokens = integer(p.inputTokens ?? p.input_tokens);
  const outputTokens = integer(p.outputTokens ?? p.output_tokens);
  const costUsd = Math.max(0, Number(p.costUsd ?? p.cost_usd) || 0);
  const errorMessage = success ? null : bounded(p.errorMessage ?? p.error_message, 8000);
  const outputText = bounded(p.outputSummary ?? p.output_text, 50000);
  const modelKey = trim(p.modelKey ?? p.model_id) || null;
  const resultJson = p.result === undefined ? null : json(p.result);

  try {
    await env.DB.prepare(
      `UPDATE agentsam_command_run SET
         success = ?, exit_code = ?, duration_ms = ?, input_tokens = ?, output_tokens = ?,
         cost_usd = ?, output_text = COALESCE(?, output_text), error_message = ?,
         model_id = COALESCE(?, model_id),
         result_json = CASE WHEN ? IS NULL THEN result_json ELSE ? END,
         approval_status = CASE WHEN approval_status = 'pending_approval' THEN 'approved' ELSE approval_status END
       WHERE id = ?`,
    ).bind(
      success ? 1 : 0, success ? 0 : 1, durationMs, inputTokens, outputTokens, costUsd,
      outputText, errorMessage, modelKey, resultJson, resultJson, id,
    ).run();
    const row = await env.DB.prepare(
      `SELECT tenant_id, workspace_id, selected_command_id, selected_command_slug
         FROM agentsam_command_run WHERE id = ? LIMIT 1`,
    ).bind(id).first().catch(() => null);
    if (row?.selected_command_id && row?.tenant_id && row?.workspace_id) {
      await recordCommandPerformance(env, {
        tenantId: row.tenant_id,
        workspaceId: row.workspace_id,
        commandId: row.selected_command_id,
        commandSlug: row.selected_command_slug,
        success, durationMs, inputTokens, outputTokens, costUsd,
      });
    }
    await finishExecutionForRun(env, {
      executionType: 'command', runId: id, status: success ? 'completed' : 'failed', durationMs,
    });
    return { ok: true, commandRunId: id, status: success ? 'completed' : 'failed' };
  } catch (error) {
    return { ok: false, commandRunId: id, reason: error?.message ?? String(error) };
  }
}

export async function markCommandRunApproval(env, commandRunId, approvalStatus) {
  const id = trim(commandRunId);
  const status = trim(approvalStatus);
  if (!env?.DB || !id || !status) return false;
  const result = await env.DB.prepare(
    `UPDATE agentsam_command_run SET approval_status = ? WHERE id = ?`,
  ).bind(status, id).run().catch(() => null);
  return Boolean(result?.success);
}
