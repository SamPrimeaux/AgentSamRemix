/**
 * agentsam_tool_call_log — strict factual atomic receipt normalizer.
 * Required ≠ invented: use explicit sentinels (unknown, '') instead of NULL ambiguity.
 */

import { parseRequiredAgentRuntimeMode } from '../../backend/agentsam/runtime/mode.js';
import { pickRunSpineIds } from './run-spine-ids.js';
import {
  costBasisForSourceClient,
  resolveSourceClientForToolLog,
} from './tool-stats-source-client.js';
import { resolveToolCallLogProvenance } from '../../shared/agent-runtime/tool-call-log-provenance.js';

export const RECEIPT_UNKNOWN = 'unknown';
export const RECEIPT_EMPTY = '';

const MODEL_KEY_SOURCES = new Set([
  'client_reported',
  'request_context',
  'agent_run',
  'server_default',
  'subscription_default',
  'unknown',
]);

/**
 * @param {unknown} raw
 */
function trimOrUnknown(raw) {
  if (raw == null) return RECEIPT_UNKNOWN;
  const s = String(raw).trim();
  return s || RECEIPT_UNKNOWN;
}

/**
 * @param {unknown} raw
 */
function trimOrEmpty(raw) {
  if (raw == null) return RECEIPT_EMPTY;
  return String(raw).trim().slice(0, 8000);
}

/**
 * @param {string} msg
 */
function errorCodeFromMessage(msg) {
  const s = String(msg || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return s || 'tool_call_failed';
}

/**
 * @param {Record<string, unknown>} fields
 */
export function resolveObservedModelKey(fields = {}) {
  const explicit =
    fields.modelKey ??
    fields.model_key ??
    fields.modelUsed ??
    fields.model_used ??
    null;
  const sourceRaw = fields.modelKeySource ?? fields.model_key_source ?? null;
  const source =
    sourceRaw != null && MODEL_KEY_SOURCES.has(String(sourceRaw).trim())
      ? String(sourceRaw).trim()
      : null;

  if (explicit != null && String(explicit).trim() !== '' && String(explicit).trim() !== RECEIPT_UNKNOWN) {
    return {
      model_key: String(explicit).trim().slice(0, 200),
      model_key_source: source || 'client_reported',
    };
  }
  return { model_key: RECEIPT_UNKNOWN, model_key_source: source || 'unknown' };
}

/**
 * @param {Record<string, unknown>} fields
 * @param {string} sourceClient
 * @param {number} costUsd
 */
export function resolveReceiptCostBasis(fields, sourceClient, costUsd) {
  const explicit = fields.costBasis ?? fields.cost_basis;
  if (explicit != null && String(explicit).trim() !== '') {
    return String(explicit).trim().slice(0, 40);
  }
  if (costUsd > 0) return 'api_metered';
  return costBasisForSourceClient(sourceClient);
}

/**
 * @param {any} env
 * @param {string} toolName
 */
export async function resolveCatalogToolIdentityForLog(env, toolName) {
  const tk = String(toolName || '').trim().slice(0, 200);
  if (!tk) {
    return {
      tool_key: RECEIPT_UNKNOWN,
      tool_category: RECEIPT_UNKNOWN,
      handler_key: RECEIPT_UNKNOWN,
      agentsam_tools_id: RECEIPT_UNKNOWN,
    };
  }
  if (!env?.DB) {
    return {
      tool_key: tk,
      tool_category: RECEIPT_UNKNOWN,
      handler_key: RECEIPT_UNKNOWN,
      agentsam_tools_id: RECEIPT_UNKNOWN,
    };
  }
  try {
    const row = await env.DB.prepare(
      `SELECT id, tool_key, tool_category, handler_key
         FROM agentsam_tools
        WHERE (tool_key = ? OR tool_name = ?)
          AND COALESCE(is_active, 1) = 1
        LIMIT 1`,
    )
      .bind(tk, tk)
      .first();
    if (!row) {
      return {
        tool_key: tk,
        tool_category: RECEIPT_UNKNOWN,
        handler_key: RECEIPT_UNKNOWN,
        agentsam_tools_id: RECEIPT_UNKNOWN,
      };
    }
    return {
      tool_key: String(row.tool_key || tk).slice(0, 200),
      tool_category: row.tool_category ? String(row.tool_category).slice(0, 80) : RECEIPT_UNKNOWN,
      handler_key: row.handler_key ? String(row.handler_key).slice(0, 200) : RECEIPT_UNKNOWN,
      agentsam_tools_id: row.id ? String(row.id).slice(0, 200) : RECEIPT_UNKNOWN,
    };
  } catch {
    return {
      tool_key: tk,
      tool_category: RECEIPT_UNKNOWN,
      handler_key: RECEIPT_UNKNOWN,
      agentsam_tools_id: RECEIPT_UNKNOWN,
    };
  }
}

/**
 * Build a complete column map for agentsam_tool_call_log (writers merge catalog + caller fields).
 * @param {Record<string, unknown>} fields
 * @param {{ id: string, tenantId: string, workspaceId: string, userId?: string|null, spine: ReturnType<typeof pickRunSpineIds>, stat: string, createdAtUnix: number, errorLogId?: string|null }} ctx
 */
export function buildToolCallReceiptRow(fields, ctx) {
  const pick = (a, b) => (fields[a] !== undefined && fields[a] !== null ? fields[a] : fields[b]);

  const toolKeyRaw =
    pick('toolKey', 'tool_key') ?? fields.toolName ?? fields.tool_name ?? RECEIPT_UNKNOWN;
  const toolKey = String(toolKeyRaw).trim().slice(0, 200) || RECEIPT_UNKNOWN;

  const durationMs = Math.max(0, Math.floor(Number(fields.durationMs ?? fields.duration_ms) || 0));
  const costUsd = Math.max(0, Number(fields.costUsd ?? fields.cost_usd) || 0);
  const inTok = Math.max(0, Math.floor(Number(fields.inputTokens ?? fields.input_tokens) || 0));
  const outTok = Math.max(0, Math.floor(Number(fields.outputTokens ?? fields.output_tokens) || 0));

  const modeRaw = fields.mode ?? fields.agent_mode ?? null;
  let mode = RECEIPT_UNKNOWN;
  if (modeRaw != null && String(modeRaw).trim() !== '') {
    const parsed = parseRequiredAgentRuntimeMode(modeRaw);
    mode = parsed.ok ? parsed.mode : String(modeRaw).trim().slice(0, 40);
  }

  const { model_key, model_key_source } = resolveObservedModelKey(fields);
  const sourceClient =
    resolveSourceClientForToolLog({
      source_client: pick('sourceClient', 'source_client'),
      client_surface: pick('client_surface', 'clientSurface'),
      clientSurface: pick('clientSurface', 'client_surface'),
      actor_source: pick('actor_source', 'actorSource'),
      mode,
    }) || RECEIPT_UNKNOWN;

  const failStat = ['error', 'failed', 'timeout', 'blocked'].includes(
    String(ctx.stat || '').toLowerCase(),
  );
  const errMsg =
    fields.errorMessage != null
      ? String(fields.errorMessage).slice(0, 8000)
      : fields.error_message != null
        ? String(fields.error_message).slice(0, 8000)
        : RECEIPT_EMPTY;
  const errorCode =
    pick('errorCode', 'error_code') != null
      ? String(pick('errorCode', 'error_code')).trim().slice(0, 120)
      : failStat && errMsg
        ? errorCodeFromMessage(errMsg)
        : RECEIPT_EMPTY;

  const toolChainIdRaw = pick('toolChainId', 'tool_chain_id');
  const routingArmIdRaw = pick('routingArmId', 'routing_arm_id');

  return {
    id: ctx.id,
    tenant_id: ctx.tenantId,
    workspace_id: ctx.workspaceId,
    user_id: ctx.userId ?? RECEIPT_UNKNOWN,
    agent_id:
      pick('agentId', 'agent_id') != null
        ? String(pick('agentId', 'agent_id')).slice(0, 200)
        : RECEIPT_UNKNOWN,
    conversation_id:
      ctx.spine.conversation_id ??
      (fields.sessionId != null ? String(fields.sessionId).trim() : null) ??
      (fields.session_id != null ? String(fields.session_id).trim() : null) ??
      RECEIPT_UNKNOWN,
    agent_run_id: ctx.spine.agent_run_id ?? RECEIPT_UNKNOWN,
    routing_arm_id:
      routingArmIdRaw != null && String(routingArmIdRaw).trim() !== ''
        ? String(routingArmIdRaw).trim().slice(0, 120)
        : RECEIPT_UNKNOWN,
    tool_chain_id:
      toolChainIdRaw != null && String(toolChainIdRaw).trim() !== ''
        ? String(toolChainIdRaw).trim().slice(0, 120)
        : RECEIPT_UNKNOWN,
    mode,
    model_key,
    model_key_source,
    tool_key: toolKey,
    tool_category:
      pick('toolCategory', 'tool_category') != null
        ? String(pick('toolCategory', 'tool_category')).slice(0, 80)
        : RECEIPT_UNKNOWN,
    handler_key:
      pick('handlerKey', 'handler_key') != null
        ? String(pick('handlerKey', 'handler_key')).slice(0, 200)
        : RECEIPT_UNKNOWN,
    source_tool:
      pick('sourceTool', 'source_tool') != null
        ? String(pick('sourceTool', 'source_tool')).slice(0, 120)
        : RECEIPT_UNKNOWN,
    agentsam_tools_id:
      pick('agentsamToolsId', 'agentsam_tools_id') != null
        ? String(pick('agentsamToolsId', 'agentsam_tools_id')).slice(0, 200)
        : RECEIPT_UNKNOWN,
    status: ctx.stat,
    duration_ms: durationMs,
    error_message: failStat && !ctx.errorLogId ? errMsg : RECEIPT_EMPTY,
    error_code: errorCode,
    error_log_id: ctx.errorLogId ? String(ctx.errorLogId) : RECEIPT_EMPTY,
    cost_usd: costUsd,
    cost_basis: resolveReceiptCostBasis(fields, sourceClient, costUsd),
    input_tokens: inTok,
    output_tokens: outTok,
    source_client: sourceClient,
    created_at_unix: ctx.createdAtUnix,
    ...resolveToolCallLogProvenance(fields),
  };
}
