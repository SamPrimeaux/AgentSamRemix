/**
 * Agent Sam operational ledger — fire-and-forget writes to D1 ops tables.
 * INSERT columns are chosen from live PRAGMA table_info (no assumed schemas).
 *
 * Re-exports scheduleAgentsamErrorLog from backend telemetry (canonical).
 * Tool invocation SSOT: agentsam_tool_call_log (in-app + MCP). Does not replace otlp_traces.
 *
 * web_fetch gating: assertFetchDomainAllowed (auth.js) → agentsam_fetch_domain_allowlist.
 * Browser automation: assertBrowserTrustedOrigin → agentsam_browser_trusted_origin.
 * Tool execution: findMcpAllowlistMatch (agent-policy.js) → agentsam_mcp_allowlist.
 */

import { scheduleAgentsamErrorLog, writeErrorLogForToolCall } from '../../backend/telemetry/error-log.js';
import { normalizeCatalogToolErrorMessage } from '../../backend/services/tools/shared.js';
import { assertBrowserOriginTrusted } from './auth.js';
import { resolveCanonicalUserId } from '../api/auth.js';
import { pickRunSpineIds } from './run-spine-ids.js';
import { dualCheckedAtFields } from '../../backend/services/database/d1-time.js';
import {
  buildToolCallReceiptRow,
  resolveCatalogToolIdentityForLog,
} from './tool-call-log-receipt.js';

export { scheduleAgentsamErrorLog };

/** @param {import('@cloudflare/workers-types').D1Database} db */
async function pragmaTableColumnMeta(db, tableName) {
  const safe = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(tableName || '')) ? String(tableName) : '';
  if (!safe || !db) return [];
  try {
    const { results } = await db.prepare(`PRAGMA table_info(${safe})`).all();
    return (results || []).map((r) => ({
      name: String(r.name || '').toLowerCase(),
      notnull: Number(r.notnull) === 1,
      dflt_value: r.dflt_value,
      pk: Number(r.pk) === 1,
    }));
  } catch {
    return [];
  }
}

function hasUsableDefault(col) {
  if (!col.notnull) return true;
  return col.dflt_value != null && String(col.dflt_value).trim() !== '';
}

/**
 * @returns {{ parts: string[]|null, binds: unknown[]|null }}
 */
function buildInsertParts(meta, valuesByCol) {
  const parts = [];
  const binds = [];
  for (const col of meta) {
    const v = valuesByCol[col.name];
    if (v === undefined) {
      if (col.notnull && !hasUsableDefault(col)) {
        return { parts: null, binds: null };
      }
      continue;
    }
    parts.push(col.name);
    binds.push(v);
  }
  return { parts, binds };
}

function safeJson(value, fallback = '{}') {
  try {
    if (value === undefined) return fallback;
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function agentRunUnixNow() {
  return Math.floor(Date.now() / 1000);
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {string} source
 * @param {unknown} err
 * @param {{ tenantId?: string|null, workspaceId?: string|null, sessionId?: string|null }} scope
 */
function reportHelperFailure(env, ctx, source, err, scope = {}) {
  const msg = err != null && typeof err === 'object' && 'message' in err ? String(err.message) : String(err || 'unknown');
  const tid = scope.tenantId != null ? String(scope.tenantId).trim() : '';
  const wid = scope.workspaceId != null ? String(scope.workspaceId).trim() : '';
  if (env?.DB && tid && wid && ctx?.waitUntil) {
    scheduleAgentsamErrorLog(env, ctx, {
      workspaceId: wid,
      tenantId: tid,
      sessionId: scope.sessionId ?? null,
      errorCode: 'ops_ledger_write_failed',
      errorType: source,
      errorMessage: msg.slice(0, 8000),
      source,
      contextJson: safeJson({ ledger: source }),
    });
  } else {
    console.warn(`[ops-ledger:${source}]`, msg);
  }
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   tenantId?: string|null,
 *   workspaceId?: string|null,
 *   sessionId?: string|null,
 *   toolName?: string|null,
 *   tool_name?: string|null,
 *   status?: string|null,
 *   durationMs?: number|null,
 *   duration_ms?: number|null,
 *   costUsd?: number|null,
 *   inputTokens?: number|null,
 *   outputTokens?: number|null,
 *   userId?: string|null,
 *   user_id?: string|null,
 *   errorMessage?: string|null,
 *   inputSummary?: string|null,
 *   traceId?: string|null,
 *   spanId?: string|null,
 *   batchId?: string|null,
 *   toolKey?: string|null,
 *   tool_key?: string|null,
 *   capabilityKey?: string|null,
 *   capability_key?: string|null,
 *   handlerKey?: string|null,
 *   handler_key?: string|null,
 *   routeKey?: string|null,
 *   route_key?: string|null,
 *   agentsamToolsId?: string|null,
 *   agentsam_tools_id?: string|null,
 *   mcpServerId?: string|null,
 *   mcp_server_id?: string|null,
 *   serverKey?: string|null,
 *   server_key?: string|null,
 *   approvalId?: string|null,
 *   approval_id?: string|null,
 *   policyDecisionJson?: string|Record<string, unknown>|null,
 *   policy_decision_json?: string|Record<string, unknown>|null,
 *   inputJson?: string|Record<string, unknown>|null,
 *   input_json?: string|Record<string, unknown>|null,
 *   outputJson?: string|Record<string, unknown>|null,
 *   output_json?: string|Record<string, unknown>|null,
 *   toolCategory?: string|null,
 *   tool_category?: string|null,
 *   inputCostUsd?: number|null,
 *   input_cost_usd?: number|null,
 *   outputCostUsd?: number|null,
 *   output_cost_usd?: number|null,
 *   agent_run_id?: string|null,
 *   agentRunId?: string|null,
 *   conversation_id?: string|null,
 *   conversationId?: string|null,
 *   agentId?: string|null,
 *   agent_id?: string|null,
 *   sourceTool?: string|null,
 *   source_tool?: string|null,
 * }} fields
 */
function jsonColumnValue(raw, maxLen) {
  if (raw === undefined || raw === null) return undefined;
  const text =
    typeof raw === 'string'
      ? raw
      : (() => {
          try {
            return JSON.stringify(raw);
          } catch {
            return null;
          }
        })();
  if (text == null) return undefined;
  return String(text).slice(0, maxLen);
}

function newToolCallLogId() {
  return `atcl_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/**
 * Canonical agentsam_tool_call_log insert (in-app + MCP). Returns row id or null.
 * agent_run_id is optional — MCP OAuth / catalog-invoke may log without a run spine.
 */
export async function recordToolCallLog(env, fields, ctx = null) {
  if (!env?.DB) return null;

  const tid =
    fields?.tenantId != null && String(fields.tenantId).trim() !== ''
      ? String(fields.tenantId).trim()
      : fields?.tenant_id != null && String(fields.tenant_id).trim() !== ''
        ? String(fields.tenant_id).trim()
        : '';
  const ws =
    fields?.workspaceId != null && String(fields.workspaceId).trim() !== ''
      ? String(fields.workspaceId).trim()
      : fields?.workspace_id != null && String(fields.workspace_id).trim() !== ''
        ? String(fields.workspace_id).trim()
        : '';
  if (!tid || !ws) {
    console.error(
      '[tool_call_log] identity_required',
      JSON.stringify({
        tool_name: String(fields.toolName ?? fields.tool_name ?? 'unknown').slice(0, 120),
        status: fields.status != null ? String(fields.status).slice(0, 40) : null,
        has_tenant: Boolean(tid),
        has_workspace: Boolean(ws),
        agent_run_id: fields.agent_run_id ?? fields.agentRunId ?? null,
        conversation_id: fields.conversation_id ?? fields.conversationId ?? fields.sessionId ?? null,
      }),
    );
    return null;
  }

  const pick = (a, b) => (fields[a] !== undefined && fields[a] !== null ? fields[a] : fields[b]);
  const toolName = String(
    pick('toolKey', 'tool_key') ?? fields.toolName ?? fields.tool_name ?? '',
  ).trim();
  if (!toolName) {
    console.error('[tool_call_log] tool_key_required', {
      agent_run_id: fields.agent_run_id ?? fields.agentRunId ?? null,
    });
    return null;
  }

  let stat = 'success';
  if (fields.status === 'error') stat = 'error';
  else if (fields.status === 'blocked') stat = 'blocked';
  else if (fields.status === 'timeout') stat = 'timeout';
  else if (fields.status === 'pending') stat = 'pending';
  else if (fields.status) stat = String(fields.status).slice(0, 40);

  const meta = await pragmaTableColumnMeta(env.DB, 'agentsam_tool_call_log');
  if (!meta.length) return null;

  let uidLog = fields.userId ?? fields.user_id ?? null;
  if (uidLog) {
    uidLog = await resolveCanonicalUserId(String(uidLog).trim(), env);
  }

  const spine = pickRunSpineIds(fields);
  const rowId =
    fields.id != null && String(fields.id).trim() !== ''
      ? String(fields.id).trim()
      : newToolCallLogId();

  const needsCatalog =
    !pick('toolCategory', 'tool_category') ||
    !pick('handlerKey', 'handler_key') ||
    !pick('agentsamToolsId', 'agentsam_tools_id');
  const catalog = needsCatalog ? await resolveCatalogToolIdentityForLog(env, toolName) : null;
  const mergedFields = catalog
    ? {
        ...fields,
        tool_key: fields.tool_key ?? fields.toolKey ?? catalog.tool_key,
        toolKey: fields.toolKey ?? fields.tool_key ?? catalog.tool_key,
        tool_category: fields.tool_category ?? fields.toolCategory ?? catalog.tool_category,
        toolCategory: fields.toolCategory ?? fields.tool_category ?? catalog.tool_category,
        handler_key: fields.handler_key ?? fields.handlerKey ?? catalog.handler_key,
        handlerKey: fields.handlerKey ?? fields.handler_key ?? catalog.handler_key,
        agentsam_tools_id:
          fields.agentsam_tools_id ?? fields.agentsamToolsId ?? catalog.agentsam_tools_id,
        agentsamToolsId:
          fields.agentsamToolsId ?? fields.agentsam_tools_id ?? catalog.agentsam_tools_id,
      }
    : fields;

  const errMsg =
    normalizeCatalogToolErrorMessage(
      mergedFields.errorMessage ?? mergedFields.error_message ?? null,
    ) ?? '';
  const failStat = ['error', 'failed', 'timeout', 'blocked'].includes(String(stat || '').toLowerCase());
  let errorLogId = null;
  if (failStat && errMsg && ws && tid) {
    try {
      const written = await writeErrorLogForToolCall(env, {
        toolCallLogId: rowId,
        workspaceId: ws,
        tenantId: tid,
        errorMessage: errMsg,
        sessionId:
          spine.conversation_id ??
          (mergedFields.sessionId != null ? String(mergedFields.sessionId).trim() : null) ??
          (mergedFields.session_id != null ? String(mergedFields.session_id).trim() : null),
        errorType: 'tool_call_failed',
        contextJson: JSON.stringify({
          tool_key: toolName,
          status: stat,
          agent_run_id: spine.agent_run_id ?? null,
        }),
      });
      if (written.ok && written.id) errorLogId = written.id;
    } catch (_) {}
  }

  const v = buildToolCallReceiptRow(mergedFields, {
    id: rowId,
    tenantId: tid,
    workspaceId: ws,
    userId: uidLog,
    spine,
    stat,
    createdAtUnix: agentRunUnixNow(),
    errorLogId,
  });

  const { parts, binds } = buildInsertParts(meta, v);
  if (!parts?.length || parts.length < 2) return null;

  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_tool_call_log (${parts.join(', ')}) VALUES (${parts.map(() => '?').join(', ')})`,
    )
      .bind(...binds)
      .run();

    const toolCatalogId = v.agentsam_tools_id;
    if (toolCatalogId && toolCatalogId !== 'unknown') {
      const toolCols = await pragmaTableColumnMeta(env.DB, 'agentsam_tools');
      const hasUse = toolCols.some((c) => c.name === 'use_count');
      const hasLast = toolCols.some((c) => c.name === 'last_used_at');
      if (hasUse || hasLast) {
        const sets = [];
        if (hasUse) sets.push('use_count = use_count + 1');
        if (hasLast) sets.push('last_used_at = unixepoch()');
        await env.DB.prepare(`UPDATE agentsam_tools SET ${sets.join(', ')} WHERE id = ?`)
          .bind(String(toolCatalogId).trim().slice(0, 200))
          .run();
      }
    }
    return rowId;
  } catch (e) {
    reportHelperFailure(env, ctx, 'recordToolCallLog', e, {
      tenantId: tid,
      workspaceId: ws,
      sessionId: fields.sessionId ?? fields.session_id ?? null,
    });
    return null;
  }
}

/**
 * Fire-and-forget agentsam_tool_call_log writer (post-1188/1189/1190).
 * Writes: mode, model_key, tool_category, input/output_tokens, tool_chain_id.
 * mode must match agentsam_agent_run.mode (approved composer modes only) — never invent.
 */
export function scheduleToolCallLog(env, ctx, fields) {
  const p = recordToolCallLog(env, fields, ctx);
  if (ctx?.waitUntil) ctx.waitUntil(p);
  else void p;
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {Record<string, unknown>} fields — camelCase or snake_case (deploymentId, workerName, checkType, httpStatusCode, responseTimeMs, etc.)
 */
export function scheduleDeploymentHealth(env, ctx, fields) {
  if (!env?.DB) return;
  const tid = String(fields.tenantId ?? fields.tenant_id ?? '').trim();
  if (!tid) return;

  const p = (async () => {
    const meta = await pragmaTableColumnMeta(env.DB, 'agentsam_deployment_health');
    if (!meta.length) return;

    const dual = dualCheckedAtFields();
    const v = {
      id: `dhc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
      tenant_id: tid,
      deployment_id: String(fields.deploymentId ?? fields.deployment_id ?? 'health_check').slice(0, 500),
      worker_name: String(fields.workerName ?? fields.worker_name ?? 'inneranimalmedia').slice(0, 200),
      environment: String(fields.environment ?? 'production').slice(0, 80),
      check_type: String(fields.checkType ?? fields.check_type ?? 'smoke_test').slice(0, 120),
      check_url: fields.checkUrl ?? fields.check_url ?? null,
      status: String(fields.status ?? 'healthy').slice(0, 80),
      http_status_code:
        fields.httpStatusCode != null || fields.http_status_code != null
          ? Math.floor(Number(fields.httpStatusCode ?? fields.http_status_code))
          : null,
      response_time_ms:
        fields.responseTimeMs != null || fields.response_time_ms != null
          ? Math.max(0, Math.floor(Number(fields.responseTimeMs ?? fields.response_time_ms)))
          : null,
      error_message: fields.errorMessage != null ? String(fields.errorMessage).slice(0, 8000) : null,
      metadata_json: safeJson(fields.metadata ?? fields.metadata_json ?? {}),
      checked_by: String(fields.checkedBy ?? fields.checked_by ?? 'worker').slice(0, 120),
      checked_at: fields.checkedAt ?? fields.checked_at ?? dual.checked_at,
      checked_at_unix:
        fields.checkedAtUnix != null || fields.checked_at_unix != null
          ? Math.floor(Number(fields.checkedAtUnix ?? fields.checked_at_unix))
          : dual.checked_at_unix,
      last_checked_at:
        fields.lastCheckedAt != null || fields.last_checked_at != null
          ? Math.floor(Number(fields.lastCheckedAt ?? fields.last_checked_at))
          : dual.last_checked_at,
      workspace_id: fields.workspaceId ?? fields.workspace_id ?? null,
    };

    const { parts, binds } = buildInsertParts(meta, v);
    if (!parts?.length || parts.length < 2) return;

    try {
      await env.DB.prepare(
        `INSERT INTO agentsam_deployment_health (${parts.join(', ')}) VALUES (${parts.map(() => '?').join(', ')})`,
      )
        .bind(...binds)
        .run();
    } catch (e) {
      const wid = String(fields.workspaceId ?? fields.workspace_id ?? '').trim();
      reportHelperFailure(env, ctx, 'scheduleDeploymentHealth', e, {
        tenantId: tid,
        workspaceId: wid || undefined,
      });
    }
  })();

  if (ctx?.waitUntil) ctx.waitUntil(p);
  else void p;
}

/**
 * Fire-and-forget cron run row (distinct from cron-run-ledger.js start/complete for ad-hoc logging).
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   jobName?: string,
 *   job_name?: string,
 *   cronExpression?: string|null,
 *   status?: string,
 *   tenantId?: string|null,
 *   workspaceId?: string|null,
 *   startedAt?: number|null,
 *   completedAt?: number|null,
 *   durationMs?: number|null,
 *   rowsRead?: number|null,
 *   rowsWritten?: number|null,
 *   errorMessage?: string|null,
 *   metadata?: unknown,
 * }} fields
 */
export function scheduleCronRun(env, ctx, fields) {
  if (!env?.DB) return;
  const jobName = String(fields.jobName ?? fields.job_name ?? '').trim();
  if (!jobName) return;

  const p = (async () => {
    const meta = await pragmaTableColumnMeta(env.DB, 'agentsam_cron_runs');
    if (!meta.length) return;

    const tid = fields.tenantId != null ? String(fields.tenantId).trim() : null;
    const ws = fields.workspaceId != null ? String(fields.workspaceId).trim() : null;

    const nowSec = Math.floor(Date.now() / 1000);
    const startedSec =
      fields.startedAt != null
        ? Math.floor(Number(fields.startedAt) > 1e12 ? Number(fields.startedAt) / 1000 : Number(fields.startedAt)) || nowSec
        : nowSec;
    const completedSec =
      fields.completedAt != null
        ? Math.floor(Number(fields.completedAt) > 1e12 ? Number(fields.completedAt) / 1000 : Number(fields.completedAt))
        : fields.status === 'running'
          ? null
          : nowSec;

    const v = {
      id: `acr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
      job_name: jobName.slice(0, 500),
      cron_expression: fields.cronExpression != null ? String(fields.cronExpression).slice(0, 500) : null,
      status: String(fields.status ?? 'completed').slice(0, 40),
      tenant_id: tid,
      workspace_id: ws,
      started_at: startedSec,
      completed_at: completedSec,
      duration_ms: Math.max(0, Math.floor(Number(fields.durationMs) || 0)),
      rows_read: Math.max(0, Math.floor(Number(fields.rowsRead) || 0)),
      rows_written: Math.max(0, Math.floor(Number(fields.rowsWritten) || 0)),
      error_message: fields.errorMessage != null ? String(fields.errorMessage).slice(0, 4000) : null,
      metadata_json: safeJson(fields.metadata ?? {}),
    };

    const { parts, binds } = buildInsertParts(meta, v);
    if (!parts?.length || parts.length < 2) return;

    try {
      await env.DB.prepare(
        `INSERT INTO agentsam_cron_runs (${parts.join(', ')}) VALUES (${parts.map(() => '?').join(', ')})`,
      )
        .bind(...binds)
        .run();
    } catch (e) {
      reportHelperFailure(env, ctx, 'scheduleCronRun', e, { tenantId: tid || undefined, workspaceId: ws || undefined });
    }
  })();

  if (ctx?.waitUntil) ctx.waitUntil(p);
  else void p;
}

/**
 * Retired: agentsam_bootstrap v2 is a materialized auth cache (resolveAgentSamBootstrap).
 * Ops telemetry must not write runtime/session fields into bootstrap.
 */
export function scheduleBootstrapEvent(env, ctx, fields) {
  void env;
  void ctx;
  void fields;
}

export function scheduleCompactionEvent(env, ctx, fields) {
  if (!env?.DB) return;
  const tid = String(fields.tenantId ?? fields.tenant_id ?? '').trim();
  if (!tid) return;
  const provider = String(fields.provider ?? 'unknown').slice(0, 120);
  const modelKey = String(fields.modelKey ?? fields.model_key ?? 'unknown').slice(0, 200);
  const tokensBefore = Math.max(0, Math.floor(Number(fields.tokensBefore ?? fields.tokens_before) || 0));
  const tokensAfter = Math.max(0, Math.floor(Number(fields.tokensAfter ?? fields.tokens_after) || 0));

  const p = (async () => {
    const meta = await pragmaTableColumnMeta(env.DB, 'agentsam_compaction_events');
    if (!meta.length) return;

    const v = {
      id: String(fields.id ?? fields.compactionEventId ?? `cmp_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`),
      tenant_id: tid,
      session_id: fields.sessionId ?? fields.session_id ?? fields.conversationId ?? null,
      conversation_id: fields.conversationId ?? fields.sessionId ?? fields.session_id ?? null,
      provider,
      model_key: modelKey,
      tokens_before: tokensBefore,
      tokens_after: tokensAfter,
      cost_saved_usd: Number(fields.costSavedUsd ?? fields.cost_saved_usd) || 0,
      compaction_strategy: String(
        fields.compactionStrategy ?? fields.compaction_strategy ?? 'summarize',
      ).slice(0, 80),
      compaction_type: String(fields.compactionType ?? fields.compaction_type ?? 'context_summary').slice(
        0,
        80,
      ),
      compaction_scope: String(fields.compactionScope ?? fields.compaction_scope ?? 'session').slice(
        0,
        80,
      ),
      source_kind: String(fields.sourceKind ?? fields.source_kind ?? 'd1').slice(0, 40),
      source_table: String(fields.sourceTable ?? fields.source_table ?? '').slice(0, 120),
      workspace_id: fields.workspaceId ?? fields.workspace_id ?? '',
      user_id: fields.userId ?? fields.user_id ?? '',
      summary_text: String(fields.summaryText ?? fields.summary_text ?? '').slice(0, 4000),
      report_artifact_url: String(fields.reportArtifactUrl ?? fields.report_artifact_url ?? '').slice(
        0,
        2048,
      ),
      status: String(fields.status ?? 'completed').slice(0, 40),
      metadata_json: safeJson(fields.metadata ?? {}),
      content_hash: String(fields.digestHash ?? fields.content_hash ?? fields.sourceHash ?? '').slice(
        0,
        128,
      ),
      source_query_hash: String(fields.sourceHash ?? fields.source_query_hash ?? '').slice(0, 128),
      compacted_at_epoch: Math.floor(Date.now() / 1000),
      created_at_epoch: Math.floor(Date.now() / 1000),
      updated_at_epoch: Math.floor(Date.now() / 1000),
    };

    const { parts, binds } = buildInsertParts(meta, v);
    if (!parts?.length || parts.length < 2) return;

    try {
      await env.DB.prepare(
        `INSERT INTO agentsam_compaction_events (${parts.join(', ')}) VALUES (${parts.map(() => '?').join(', ')})`,
      )
        .bind(...binds)
        .run();
    } catch (e) {
      reportHelperFailure(env, ctx, 'scheduleCompactionEvent', e, {
        tenantId: tid,
        workspaceId: String(fields.workspaceId ?? fields.workspace_id ?? '').trim() || undefined,
      });
    }
  })();

  if (ctx?.waitUntil) ctx.waitUntil(p);
  else void p;
}

/** Dynamic import avoids static cycle (mcp-tool-execution → tracer). */
export async function getCachedToolResult(env, o) {
  const mod = await import('./mcp-tool-execution.js');
  return mod.tryReadAgentsamToolCache(env, o);
}

export async function setCachedToolResult(env, o) {
  const mod = await import('./mcp-tool-execution.js');
  return mod.writeAgentsamToolCacheAfterSuccess(env, o);
}

/** @param {any} env @param {{ userId: string, workspaceId?: string|null, origin: string }} opts */
export async function assertBrowserTrustedOrigin(env, opts) {
  return assertBrowserOriginTrusted(env, opts);
}
