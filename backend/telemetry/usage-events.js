/**
 * usage-events.js (backend/telemetry)
 * Single canonical writer for agentsam_usage_events.
 * Call once per AI model invocation after streaming completes.
 * One row = one model call.
 */
import { resolveUsageEventCostUsd } from './pricing.js';
import {
  resolveUsageConversationId,
  syncUsageTokenColumns,
  usageEventExtraColumnSql,
} from './usage-event-columns.js';

export {
  resolveUsageConversationId,
  syncUsageTokenColumns,
  usageEventExtraColumnSql,
} from './usage-event-columns.js';

/**
 * Resolve billing provider for a dispatched model_key (catalog SSOT), not routing arm default.
 * @param {any} env
 * @param {string|null|undefined} modelKey
 * @param {string|null|undefined} armProvider
 */
export async function resolveProviderForModelKey(env, modelKey, armProvider = null) {
  const mk = modelKey != null ? String(modelKey).trim() : '';
  if (!mk || !env?.DB) {
    return armProvider != null ? String(armProvider).trim() : 'unknown';
  }
  try {
    const catRow = await env.DB.prepare(
      `SELECT provider FROM agentsam_model_catalog WHERE model_key = ? AND is_active = 1 LIMIT 1`,
    )
      .bind(mk)
      .first();
    if (catRow?.provider) return String(catRow.provider).trim();
  } catch (_) {}
  return armProvider != null ? String(armProvider).trim() : 'unknown';
}

/**
 * @param {Object} env - Worker env bindings (env.DB required)
 * @param {Object} params
 * @param {string} params.model          - model name e.g. "gemini-2.5-flash"
 * @param {string} params.model_key      - routing key e.g. "gemini-2.5-flash-lite"
 * @param {string} params.provider       - "google" | "openai" | "anthropic" | "workers_ai" | "ollama"
 * @param {string} params.workspace_id
 * @param {string} params.tenant_id
 * @param {string} [params.user_id]
 * @param {string} [params.session_id]
 * @param {string} [params.conversation_id]
 * @param {string} [params.routing_arm_id]
 * @param {string} [params.event_type]   - "chat" | "tool_call" | "embed" | "eval" | "cron"
 * @param {number} [params.tokens_in]    - input tokens
 * @param {number} [params.tokens_out]   - output tokens
 * @param {number} [params.cost_usd]     - estimated cost
 * @param {number} [params.duration_ms]  - wall clock ms
 * @param {string} [params.ref_table]    - originating table e.g. "agentsam_workflow_runs"
 * @param {string} [params.ref_id]       - originating row id
 * @param {string} [params.tool_name]    - if event_type=tool_call
 * @param {string} [params.status]       - "ok" | "error" | "timeout"
 * @param {string} [params.reason]       - error message if status=error
 * @param {string} [params.task_type]    - canonical task type from classifyIntent
 * @param {string} [params.mode]         - execution mode (ask, agent, auto, …)
 */
export async function writeUsageEvent(env, params, ctx = null) {
  const {
    model        = 'unknown',
    model_key    = null,
    provider     = 'unknown',
    workspace_id,
    tenant_id,
    user_id      = null,
    session_id   = null,
    conversation_id = null,
    routing_arm_id = null,
    plan_id      = null,
    event_type   = 'chat',
    tokens_in    = 0,
    tokens_out   = 0,
    cost_usd     = 0,
    duration_ms  = null,
    ref_table    = null,
    ref_id       = null,
    tool_name    = null,
    status       = 'ok',
    reason       = null,
    task_type    = null,
    mode         = null,
  } = params;

  // hard requirement — skip silently rather than throw
  if (!workspace_id || !tenant_id) {
    console.warn('[writeUsageEvent] missing workspace_id or tenant_id — skipped');
    return null;
  }

  const tokens = syncUsageTokenColumns(tokens_in, tokens_out);
  const usageConversationId = resolveUsageConversationId({
    conversation_id,
    session_id,
  });
  const taskTypeVal = task_type != null ? String(task_type).trim().slice(0, 120) : null;
  const modeVal = mode != null ? String(mode).trim().slice(0, 64) : null;
  let resolvedModelKey = model_key != null ? String(model_key).trim() : '';
  let costUsdIns = Number(cost_usd) || 0;
  let costReason = reason != null ? String(reason).trim() : null;

  if (!Number.isFinite(costUsdIns) || (costUsdIns === 0 && !costReason)) {
    // Never pass cost_usd=0 as an override — that short-circuits pricing lookup
    // and permanently writes free embeds when the first estimate missed rates.
    const priced = await resolveUsageEventCostUsd(env.DB, {
      modelKey: resolvedModelKey || model,
      provider,
      inputTokens: tokens_in,
      outputTokens: tokens_out,
      pricingKind:
        String(event_type || '').toLowerCase() === 'embed' ||
        /embedding/i.test(String(resolvedModelKey || model || ''))
          ? 'embedding'
          : 'standard',
      computedCostUsdOverride:
        Number.isFinite(Number(cost_usd)) && Number(cost_usd) > 0 ? Number(cost_usd) : null,
    });
    costUsdIns = priced.costUsd;
    if (priced.costReason) costReason = priced.costReason;
    if (priced.canonicalModelKey) resolvedModelKey = priced.canonicalModelKey;
  }

  const actualProvider = await resolveProviderForModelKey(
    env,
    resolvedModelKey || model,
    provider,
  );
  const statusRaw = String(status || 'ok').toLowerCase();
  const statusVal =
    costReason === 'pricing_lookup_failed'
      ? 'partial'
      : statusRaw === 'error' || statusRaw === 'timeout' || statusRaw === 'blocked'
        ? statusRaw
        : 'ok';

  const usageSchema = await env.DB
    .prepare('PRAGMA table_info(agentsam_usage_events)')
    .all()
    .catch(() => ({ results: [] }));
  const usageCols = new Set(
    (usageSchema?.results || [])
      .map((column) => String(column?.name || '').trim().toLowerCase())
      .filter(Boolean),
  );
  const extra = usageEventExtraColumnSql(usageCols, {
    tokens_in: tokens.tokens_in,
    tokens_out: tokens.tokens_out,
    task_type: taskTypeVal,
    mode: modeVal,
    conversation_id: usageConversationId,
    event_type,
    model_key: resolvedModelKey || model,
    model,
  });
  const extraCols = extra.names.length ? `, ${extra.names.join(', ')}` : '';
  const extraPh = extra.names.length ? `, ${extra.placeholders.join(', ')}` : '';

  try {
    const result = await env.DB.prepare(`
      INSERT INTO agentsam_usage_events (
        tenant_id, workspace_id, user_id, session_id,
        provider, model, model_key,
        tokens_in, tokens_out, input_tokens, output_tokens, total_tokens, cost_usd, duration_ms,
        event_type, tool_name, status, reason,
        ref_table, ref_id, routing_arm_id, plan_id,
        task_type, mode,
        agent_name, created_at${extraCols}
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        'agent-sam', unixepoch()${extraPh}
      )
    `).bind(
      tenant_id, workspace_id, user_id, session_id,
      actualProvider, model, model_key || resolvedModelKey || model,
      tokens.tokens_in, tokens.tokens_out, tokens.input_tokens, tokens.output_tokens,
      tokens.total_tokens, costUsdIns, duration_ms,
      event_type, tool_name, statusVal, costReason,
      ref_table, ref_id, routing_arm_id, plan_id,
      taskTypeVal, modeVal,
      ...extra.binds,
    ).run();

    return result?.meta?.last_row_id ?? null;
  } catch (e) {
    // never throw — telemetry must not break the main path
    console.warn('[writeUsageEvent] insert failed:', e.message);
    return null;
  }
}

/**
 * Chat SSE usage row — explicit column list; delegates to writeUsageEvent.
 * @param {any} env
 * @param {any} ctx
 * @param {Record<string, unknown>} opts
 */
export function writeUsageEventFromChat(env, ctx, opts = {}) {
  const tenant_id = opts.tenant_id ?? opts.tenantId ?? null;
  const workspace_id = opts.workspace_id ?? opts.workspaceId ?? null;
  if (!tenant_id || !workspace_id) return;

  const inputTokens = Math.floor(Number(opts.input_tokens ?? opts.inputTokens) || 0);
  const outputTokens = Math.floor(Number(opts.output_tokens ?? opts.outputTokens) || 0);
  const model_key = opts.model_key ?? opts.modelKey ?? 'unknown';
  const routing_arm_id = opts.routing_arm_id ?? opts.routingArmId ?? null;
  const usageConversationId = resolveUsageConversationId(opts);

  const payload = {
    tenant_id,
    workspace_id,
    user_id: opts.user_id ?? opts.userId ?? null,
    session_id: opts.session_id ?? opts.sessionId ?? usageConversationId,
    conversation_id: usageConversationId,
    provider: opts.provider ?? opts.resolvedProvider ?? 'unknown',
    model: model_key,
    model_key,
    routing_arm_id,
    event_type: opts.event_type ?? 'chat_completion',
    tokens_in: inputTokens,
    tokens_out: outputTokens,
    cost_usd: Number(opts.cost_usd ?? opts.costUsd) || 0,
    duration_ms: opts.duration_ms ?? opts.durationMs ?? null,
    status: opts.streamFailed || opts.status === 'error' ? 'error' : 'ok',
    ref_table: 'agentsam_agent_run',
    ref_id: opts.ref_id ?? opts.refId ?? null,
    task_type: opts.task_type ?? opts.taskType ?? null,
    mode: opts.mode ?? null,
    reason: opts.streamFailed ? 'stream_failed' : null,
  };

  const run = () =>
    writeUsageEvent(env, payload, ctx).catch((e) => {
      console.warn('[writeUsageEventFromChat] insert failed:', e?.message);
    });

  if (ctx?.waitUntil) ctx.waitUntil(run());
  else void run();
}

/**
 * Convenience: call after an SSE stream completes.
 * Pulls values from the standard streaming response context.
 */
export async function writeUsageEventFromStream(env, {
  workspace_id, tenant_id, user_id, session_id,
  model, model_key, provider, routing_arm_id, plan_id,
  usage,          // { input_tokens, output_tokens } from provider response
  cost_usd,       // pre-calculated by your cost estimator
  duration_ms,    // Date.now() - start_time
  ref_table, ref_id,
  task_type,
  mode,
}, ctx = null) {
  return writeUsageEvent(env, {
    workspace_id, tenant_id, user_id, session_id,
    model, model_key, provider, routing_arm_id, plan_id,
    event_type:  'chat',
    tokens_in:   usage?.input_tokens  ?? usage?.tokens_in  ?? 0,
    tokens_out:  usage?.output_tokens ?? usage?.tokens_out ?? 0,
    cost_usd:    cost_usd ?? 0,
    duration_ms,
    ref_table,
    ref_id,
    task_type,
    mode,
    status: 'ok',
  }, ctx);
}
