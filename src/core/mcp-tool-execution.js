/**
 * MCP / builtin tool execution ledger — SSOT: agentsam_tool_call_log.
 */

import { recordSpan } from './tracer.js';
import { loadAgentsamToolPolicyKeySet } from './agentsam-tool-policy-keys.js';
import { recordToolCallLog } from './agentsam-ops-ledger.js';
import {
  buildToolCacheLookupOpts,
  attachToolCacheProvenance,
  warnToolCacheWriteFailure,
} from '../../shared/agent-runtime/tool-cache-session.js';
import {
  resolveToolCallLogStatusFromMcpFields,
  mcpFieldsTerminalFailure,
} from './tool-call-log-status.js';

export { resolveToolCallLogStatusFromMcpFields } from './tool-call-log-status.js';
import { fireForgetAgentToolChainRow } from '../../backend/telemetry/tool-chain.js';

/** SHA-256 hex of canonical JSON for tool-cache keys (Workers Web Crypto). */
export async function hashToolInputJson(obj) {
  try {
    const raw =
      typeof obj === 'string'
        ? obj
        : JSON.stringify(obj === undefined ? {} : obj === null ? null : obj);
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}

const NON_CACHEABLE_TOOLS_FALLBACK = new Set([
  'terminal_execute',
  'deploy',
  'r2_delete',
  'd1_write',
  'excalidraw_plan_map_create',
  'illustration_create',
  'agentsam_terminal_local',
  'agentsam_terminal_remote',
  'agentsam_d1_write',
  'agentsam_d1_query',
  'agentsam_ticket_add_note',
  'agentsam_ticket_create',
  'agentsam_ticket',
  'agentsam_ticket_set_status',
  'agentsam_memory_save',
  'agentsam_memory_write',
  'agentsam_r2_upload',
  'agentsam_notify',
  'agentsam_send_email',
]);

function trimTool(v) {
  return v == null ? '' : String(v).trim();
}

/** Reject stale dispatch envelopes and empty GitHub payloads (pre-4b2d1aa4 cache poison). */
export function isSubstantiveToolOutput(toolName, value) {
  if (value == null) return false;
  if (typeof value !== 'object' || Array.isArray(value)) return true;
  const n = trimTool(toolName).toLowerCase();
  const keys = Object.keys(value);
  if (
    value.tool_key &&
    keys.length <= 4 &&
    !value.tree &&
    !value.rows &&
    !value.text &&
    !value.files
  ) {
    return false;
  }
  if (n.includes('github') && (n.includes('tree') || n.includes('get_tree'))) {
    return (
      (Array.isArray(value.tree) && value.tree.length >= 0) ||
      (typeof value.tree_count === 'number' && value.tree_count >= 0) ||
      typeof value.error === 'string'
    );
  }
  if (n.includes('github') && n.includes('search')) {
    // Empty items is a real answer (no matches) — do not treat as stale envelope.
    return Array.isArray(value.items) || typeof value.error === 'string';
  }
  if (
    n.includes('github') &&
    (n.includes('read_many') || n.includes('batch_read'))
  ) {
    if (!Array.isArray(value.files)) return typeof value.error === 'string';
    // Usable when any file has text OR a structured per-path error (dir/glob/404).
    return value.files.some(
      (f) =>
        (typeof f?.text === 'string' && f.text.length > 0) ||
        (typeof f?.error === 'string' && f.error.length > 0),
    );
  }
  if (n.includes('github') && (n.includes('read') || n.includes('file'))) {
    return (
      (typeof value.text === 'string' && value.text.length > 0) ||
      typeof value.error === 'string' ||
      value.is_directory === true
    );
  }
  return true;
}

const toolCacheOutputIsUsable = isSubstantiveToolOutput;

async function toolExecutionIsCacheable(env, toolName) {
  const n = String(toolName || '').trim();
  if (!n || !env?.DB) return false;
  try {
    const row = await env.DB.prepare(
      `SELECT tool_key, cache_policy_json FROM agentsam_tools
        WHERE tool_key = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
    )
      .bind(n)
      .first();
    const { resolveToolCachePolicyFromRow, isToolCacheEnabled } = await import('./tool-cache-bridge.js');
    return isToolCacheEnabled(resolveToolCachePolicyFromRow(row || { tool_key: n }), n);
  } catch {
    return false;
  }
}

/**
 * @param {any} env
 * @param {{ workspaceId?: string | null, tenantId?: string | null, toolName: string, toolInput: unknown }} o
 * @returns {Promise<{ hit: false } | { hit: true, value: unknown }>}
 */
export async function tryReadAgentsamToolCache(env, o) {
  if (!env?.DB || !(await toolExecutionIsCacheable(env, o?.toolName))) return { hit: false };
  const ws =
    o.workspaceId != null && String(o.workspaceId).trim() !== ''
      ? String(o.workspaceId).trim()
      : '';
  if (!ws) return { hit: false };
  const toolName = String(o.toolName || '').trim();
  const cacheOpts = buildToolCacheLookupOpts(o.toolInput, {
    tenantId: o.tenantId,
    workspaceId: ws,
    userId: o.userId,
    sessionId: o.sessionId,
    sourceVersion: o.sourceVersion ?? o.source_version,
    sourceEtag: o.sourceEtag ?? o.source_etag,
  });
  try {
    const toolRow = await env.DB.prepare(
      `SELECT id, tool_key, cache_policy_json, updated_at_unix FROM agentsam_tools
        WHERE tool_key = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
    )
      .bind(toolName)
      .first();
    const { lookupToolCache } = await import('./tool-cache-bridge.js');
    const cached = await lookupToolCache(env, {
      toolRow: toolRow || { tool_key: toolName },
      toolInput: o.toolInput ?? {},
      tenantId: cacheOpts.tenantId,
      workspaceId: ws,
      userId: cacheOpts.userId,
      sessionId: cacheOpts.sessionId,
      sourceVersion: cacheOpts.sourceVersion,
      sourceEtag: cacheOpts.sourceEtag,
    });
    if (!cached?.hit || cached.body == null) return { hit: false };
    if (!toolCacheOutputIsUsable(toolName, cached.body)) return { hit: false };
    return {
      hit: true,
      value: attachToolCacheProvenance(cached.body, {
        cache_hit: 1,
        external_execution: 0,
        result_source: 'tool_cache',
      }),
    };
  } catch {
    return { hit: false };
  }
}

/**
 * @param {any} env
 * @param {{
 *   workspaceId?: string | null,
 *   tenantId?: string | null,
 *   toolName: string,
 *   toolInput: unknown,
 *   toolOutput: unknown,
 *   durationMs?: number,
 *   execErr?: unknown,
 *   modelKey?: string|null,
 *   model_key?: string|null,
 *   provider?: string|null,
 * }} o
 */
export async function writeAgentsamToolCacheAfterSuccess(env, o) {
  if (!env?.DB || !(await toolExecutionIsCacheable(env, o?.toolName))) {
    return { ok: false, reason: 'not_cacheable' };
  }
  if (o?.execErr) return { ok: false, reason: 'exec_error' };
  if (!toolCacheOutputIsUsable(o?.toolName, o?.toolOutput)) {
    return { ok: false, reason: 'output_not_usable' };
  }
  const ws =
    o.workspaceId != null && String(o.workspaceId).trim() !== ''
      ? String(o.workspaceId).trim()
      : '';
  if (!ws) return { ok: false, reason: 'no_workspace' };
  const toolName = String(o.toolName || '').trim();
  const durationMs = Math.max(0, Math.floor(Number(o.durationMs) || 0));
  const cacheOpts = buildToolCacheLookupOpts(o.toolInput, {
    tenantId: o.tenantId,
    workspaceId: ws,
    userId: o.userId,
    sessionId: o.sessionId,
    sourceVersion: o.sourceVersion ?? o.source_version,
    sourceEtag: o.sourceEtag ?? o.source_etag,
  });
  try {
    const toolRow = await env.DB.prepare(
      `SELECT id, tool_key, cache_policy_json, updated_at_unix FROM agentsam_tools
        WHERE tool_key = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
    )
      .bind(toolName)
      .first();
    const { writeToolCacheResult } = await import('./tool-cache-bridge.js');
    const writeResult = await writeToolCacheResult(env, {
      toolRow: toolRow || { tool_key: toolName },
      toolInput: o.toolInput ?? {},
      result: o.toolOutput,
      tenantId: cacheOpts.tenantId,
      workspaceId: ws,
      userId: cacheOpts.userId,
      sessionId: cacheOpts.sessionId,
      sourceVersion: cacheOpts.sourceVersion,
      sourceEtag: cacheOpts.sourceEtag,
      originDurationMs: durationMs,
      originCostUsd: Number(o.costUsd) || 0,
      agentRunId: o.agentRunId ?? null,
    });
    warnToolCacheWriteFailure(toolName, writeResult);
    return writeResult;
  } catch (e) {
    console.warn('[agentsam_tool_cache] write', e?.message ?? e);
    return { ok: false, reason: 'threw', error: String(e?.message ?? e) };
  }
}

function newToolCallLogId() {
  return `atcl_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/** Stable id for correlating fire-and-forget execution rows with tool_chain (generate before scheduling). */
export function newMcpToolExecutionId() {
  return newToolCallLogId();
}

/**
 * Non-blocking agentsam_tool_call_log insert — prefer for hot paths with ExecutionContext.
 * @returns {string} execution id (same id passed to D1 insert when insert succeeds)
 */
export function scheduleRecordMcpToolExecution(env, ctx, fields) {
  const id =
    fields?.id != null && String(fields.id).trim() !== ''
      ? String(fields.id).trim()
      : newMcpToolExecutionId();
  const merged = { ...fields, id };

  const skipToolCallLog =
    merged.skip_tool_call_log === true ||
    merged.skip_tool_call_log === 1 ||
    merged.skipToolCallLog === true ||
    merged.skipToolCallLog === 1;
  if (skipToolCallLog) return id;

  const p = recordMcpToolExecution(env, merged)
    .then((execId) => {
      const ws =
        merged.workspace_id != null && String(merged.workspace_id).trim() !== ''
          ? String(merged.workspace_id).trim()
          : '';
      const tid =
        merged.tenant_id != null && String(merged.tenant_id).trim() !== ''
          ? String(merged.tenant_id).trim()
          : '';
      const uid =
        merged.user_id != null && String(merged.user_id).trim() !== ''
          ? String(merged.user_id).trim()
          : '';
      const terminalFail = mcpFieldsTerminalFailure(merged);
      if (
        terminalFail &&
        ctx &&
        ws &&
        tid &&
        uid &&
        merged.skip_tool_chain_row !== true &&
        merged.skip_tool_chain_row !== 1
      ) {
        void fireForgetAgentToolChainRow(env, {
          toolName: merged.tool_name || merged.tool_key || 'mcp_tool',
          agentSessionId: merged.session_id ?? merged.sessionId ?? null,
          workspaceId: ws,
          userId: uid,
          tenantId: tid,
          error: {
            message:
              merged.error_message != null && String(merged.error_message).trim() !== ''
                ? String(merged.error_message).slice(0, 4000)
                : 'mcp_tool_execution_failed',
          },
          mcpToolCallId: execId ?? id,
          durationMs: Math.max(0, Math.floor(Number(merged.duration_ms) || 0)),
          terminalSessionId: merged.terminal_session_id ?? merged.terminalSessionId ?? null,
          agentRunId: merged.agent_run_id ?? merged.agentRunId ?? null,
          conversationId: merged.conversation_id ?? merged.conversationId ?? null,
          toolInputJson:
            merged.input_json != null ? String(merged.input_json).slice(0, 8000) : null,
          ctx,
        });
      }
      return execId ?? id;
    })
    .catch((e) => console.warn('[scheduleRecordMcpToolExecution]', e?.message ?? e));
  if (ctx?.waitUntil) ctx.waitUntil(p);
  else void p;
  return id;
}

/**
 * Structured execution row after policy + tool resolution.
 *
 * @param {any} env
 * @param {{
 *   actor: Record<string, unknown>,
 *   tool?: Record<string, unknown>|null,
 *   decision?: Record<string, unknown>|null,
 *   status: string,
 *   inputJson?: unknown,
 *   outputJson?: unknown,
 *   error?: string | null,
 *   sessionId?: string | null,
 *   agentId?: string | null,
 *   actionType?: string | null,
 *   resourceType?: string | null,
 *   resourceId?: string | null,
 *   id?: string | null,
 *   errorCode?: string | null,
 *   errorFamily?: string | null,
 * }} o
 * @returns {Promise<string|null>}
 */
export async function logMcpExecution(env, o) {
  const actor = o?.actor || {};
  const tool = o?.tool || {};
  const decision = o?.decision || {};
  const toolKey = tool.tool_key != null ? String(tool.tool_key).trim() : '';
  const toolName = tool.tool_name != null ? String(tool.tool_name).trim() : toolKey || 'unknown';

  return recordMcpToolExecution(env, {
    id: o.id,
    tenant_id: actor.tenantId,
    user_id: actor.userId,
    tool_key: toolKey || null,
    tool_name: toolName,
    actor_source: actor.actorSource,
    denial_code: decision.denialCode,
    success: String(o.status || '').toLowerCase() === 'success',
    status: o.status,
    error_message: o.error,
    error_code: o.errorCode,
    resource_ref: o.resourceId || null,
  });
}

/**
 * @param {any} env
 * @param {object} fields
 * @returns {Promise<string|null>} execution id
 */
export async function recordMcpToolExecution(env, fields) {
  if (!env?.DB) return null;

  const id =
    fields?.id != null && String(fields.id).trim() !== ''
      ? String(fields.id).trim()
      : newMcpToolExecutionId();
  const logStatus = resolveToolCallLogStatusFromMcpFields(fields);

  return recordToolCallLog(env, {
    id,
    tenant_id: fields.tenant_id ?? fields.tenantId,
    tenantId: fields.tenant_id ?? fields.tenantId,
    workspace_id: fields.workspace_id ?? fields.workspaceId,
    workspaceId: fields.workspace_id ?? fields.workspaceId,
    user_id: fields.user_id ?? fields.userId ?? fields.invoked_by ?? fields.invokedBy,
    userId: fields.user_id ?? fields.userId ?? fields.invoked_by ?? fields.invokedBy,
    agent_run_id: fields.agent_run_id ?? fields.agentRunId,
    agentRunId: fields.agent_run_id ?? fields.agentRunId,
    conversation_id:
      fields.conversation_id ??
      fields.conversationId ??
      fields.session_id ??
      fields.sessionId,
    conversationId:
      fields.conversation_id ??
      fields.conversationId ??
      fields.session_id ??
      fields.sessionId,
    session_id: fields.session_id ?? fields.sessionId,
    sessionId: fields.session_id ?? fields.sessionId,
    tool_key: fields.tool_key ?? fields.toolKey ?? fields.tool_name ?? fields.toolName,
    toolKey: fields.tool_key ?? fields.toolKey ?? fields.tool_name ?? fields.toolName,
    tool_name: fields.tool_name ?? fields.toolName,
    toolName: fields.tool_name ?? fields.toolName,
    agentsam_tools_id: fields.agentsam_tools_id ?? fields.agentsamToolsId,
    agentsamToolsId: fields.agentsam_tools_id ?? fields.agentsamToolsId,
    agent_id: fields.agent_id ?? fields.agentId,
    agentId: fields.agent_id ?? fields.agentId,
    tool_chain_id: fields.tool_chain_id ?? fields.toolChainId,
    toolChainId: fields.tool_chain_id ?? fields.toolChainId,
    routing_arm_id: fields.routing_arm_id ?? fields.routingArmId,
    routingArmId: fields.routing_arm_id ?? fields.routingArmId,
    mode: fields.mode,
    model_key: fields.model_key ?? fields.modelKey,
    modelKey: fields.model_key ?? fields.modelKey,
    status: logStatus,
    duration_ms: fields.duration_ms ?? fields.durationMs ?? fields.latency_ms ?? fields.latencyMs,
    durationMs: fields.duration_ms ?? fields.durationMs ?? fields.latency_ms ?? fields.latencyMs,
    cost_usd: fields.cost_usd ?? fields.costUsd,
    costUsd: fields.cost_usd ?? fields.costUsd,
    input_tokens: fields.input_tokens ?? fields.inputTokens,
    inputTokens: fields.input_tokens ?? fields.inputTokens,
    output_tokens: fields.output_tokens ?? fields.outputTokens,
    outputTokens: fields.output_tokens ?? fields.outputTokens,
    error_message:
      logStatus === 'pending' ? null : (fields.error_message ?? fields.errorMessage ?? fields.error),
    errorMessage:
      logStatus === 'pending' ? null : (fields.error_message ?? fields.errorMessage ?? fields.error),
    tool_category: fields.tool_category ?? fields.toolCategory ?? 'mcp',
    toolCategory: fields.tool_category ?? fields.toolCategory ?? 'mcp',
    handler_key: fields.handler_key ?? fields.handlerKey,
    handlerKey: fields.handler_key ?? fields.handlerKey,
    source_tool: fields.source_tool ?? fields.sourceTool ?? 'mcp',
    sourceTool: fields.source_tool ?? fields.sourceTool ?? 'mcp',
    actor_source: fields.actor_source ?? fields.actorSource,
    actorSource: fields.actor_source ?? fields.actorSource,
  });
}

/**
 * OTLP span for a single MCP/builtin tool invocation (otlp_traces → daily rollup).
 * @param {any} env
 * @param {any} ctx
 * @param {{ tenant_id?: string, workspace_id?: string, toolName: string, start_time_unix_nano: number, end_time_unix_nano: number, execErr?: Error|null }} p
 */
export function recordMcpToolOtlpSpan(env, ctx, p) {
  const tenantId =
    p?.tenant_id != null && String(p.tenant_id).trim() !== '' ? String(p.tenant_id).trim() : '';
  const workspaceId =
    p?.workspace_id != null && String(p.workspace_id).trim() !== ''
      ? String(p.workspace_id).trim()
      : '';
  if (!tenantId || !workspaceId) return;
  const toolName = String(p.toolName || 'unknown').slice(0, 500);
  const t0 = Number(p.start_time_unix_nano);
  const t1 = Number(p.end_time_unix_nano);
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return;
  const execErr = p.execErr;
  recordSpan(env, ctx, {
    tenant_id: tenantId,
    workspace_id: workspaceId,
    operation_name: `mcp_tool.${toolName}`,
    kind: 'client',
    status_code: execErr ? 'error' : 'ok',
    status_message: execErr?.message ? String(execErr.message).slice(0, 2000) : null,
    start_time_unix_nano: t0,
    end_time_unix_nano: t1,
    attributes_json: JSON.stringify({ tool: toolName, workspace_id: workspaceId }),
  });
}
