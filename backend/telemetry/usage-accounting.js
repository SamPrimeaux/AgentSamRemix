/**
 * Orchestrates agent-chat usage accounting: price → usage event → rollup → spend → alerts.
 */
import { resolveCanonicalUserId } from '../identity/users/index.js';
import { resolveUsageEventCostUsd } from './pricing.js';
import {
  resolveUsageConversationId,
  resolveProviderForModelKey,
  syncUsageTokenColumns,
  usageEventExtraColumnSql,
} from './usage-events.js';
import { incrementAgentsamUsageRollupsDaily } from './usage-rollups.js';
import { recordSpend } from './spend-ledger.js';
import { scheduleSpendAlerts } from './spend-alerts.js';

function resolveTelemetryTenantId(_env, explicitTenantId) {
  const tenantId = explicitTenantId != null ? String(explicitTenantId).trim() : '';
  return tenantId || null;
}

/**
 * Record unified usage + linked spend for an agent chat / model turn.
 * @param {any} env
 * @param {Record<string, unknown>} data
 * @param {Record<string, unknown>|null} [modelRates]
 * @returns {Promise<{ telemetryId: string, estimatedCostUsd: number }|null>}
 */
export async function recordUsage(env, data, modelRates) {
  const {
    sessionId,
    conversationId,
    conversation_id,
    tenantId,
    workspaceId,
    userId,
    provider,
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cacheWriteTtl,
    latencyMs,
    success,
    computedCostUsdOverride,
    routingArmId,
    taskType,
    task_type,
    mode,
  } = data;

  const rawModel = model != null ? String(model).trim() : '';
  const priced = await resolveUsageEventCostUsd(env?.DB, {
    modelKey: rawModel,
    provider,
    modelRates,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cacheWriteTtl: cacheWriteTtl ?? '5m',
    computedCostUsdOverride,
    pricingKind: data.pricingKind ?? 'standard',
  });
  const catalogModelKey = priced.canonicalModelKey || rawModel || 'unknown';
  const estimatedCost = priced.costUsd;
  const costReason = priced.costReason;
  const eventStatus =
    costReason === 'pricing_lookup_failed' ? 'partial' : success ? 'ok' : 'error';

  const telemetryId = `tel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const mid = resolveTelemetryTenantId(env, tenantId);
  const sid = sessionId != null ? String(sessionId) : null;
  const conversationIdValue = resolveUsageConversationId({
    conversationId,
    conversation_id,
    sessionId: sid,
  });

  const tidInsert = mid || 'default';
  const wsInsert =
    (workspaceId != null && String(workspaceId).trim() !== '' ? String(workspaceId).trim() : null) ||
    'system';
  if (!wsInsert) {
    console.warn('[recordUsage] workspace_id missing; skipping agentsam_usage_events insert');
    return null;
  }
  const tokIn = Math.floor(
    (Number(inputTokens) || 0) + (Number(cacheReadTokens) || 0) + (Number(cacheWriteTokens) || 0),
  );
  const tokOut = Math.floor(Number(outputTokens) || 0);
  const tokens = syncUsageTokenColumns(tokIn, tokOut);
  const resolvedTaskType =
    (taskType ?? task_type) != null ? String(taskType ?? task_type).trim() : '';
  const resolvedMode = mode != null ? String(mode).trim() : '';
  let actualProvider = provider;
  try {
    actualProvider = await resolveProviderForModelKey(env, catalogModelKey || rawModel, provider);
  } catch (provErr) {
    console.warn('[recordUsage] provider resolve', provErr?.message ?? provErr);
  }

  try {
    const usageSchema = await env.DB
      .prepare('PRAGMA table_info(agentsam_usage_events)')
      .all()
      .catch(() => ({ results: [] }));
    const usageCols = new Set(
      (usageSchema?.results || [])
        .map((column) => String(column?.name || '').trim().toLowerCase())
        .filter(Boolean),
    );
    let uidUsage = userId != null ? String(userId).trim() : '';
    if (uidUsage) {
      try {
        uidUsage = await resolveCanonicalUserId(uidUsage, env);
      } catch (uidErr) {
        console.warn('[recordUsage] user_id resolve', uidErr?.message ?? uidErr);
      }
    } else {
      uidUsage = null;
    }
    const hasUid = usageCols.has('user_id');
    const uidMid = hasUid ? ', user_id' : '';
    const uidMidPh = hasUid ? ',?' : '';
    const armCol =
      routingArmId != null &&
      String(routingArmId).trim() !== '' &&
      usageCols.has('routing_arm_id');
    const hasReasonCol = usageCols.has('reason');
    const reasonMid = hasReasonCol ? ', reason' : '';
    const reasonMidPh = hasReasonCol ? ',?' : '';
    const extra = usageEventExtraColumnSql(usageCols, {
      tokens_in: tokens.tokens_in,
      tokens_out: tokens.tokens_out,
      task_type: resolvedTaskType,
      mode: resolvedMode,
      reason: hasReasonCol ? undefined : costReason,
      conversation_id: conversationIdValue,
      event_type: 'agent_chat',
      model_key: catalogModelKey || rawModel,
      model: rawModel,
    });
    const extraCols = extra.names.length ? `, ${extra.names.join(', ')}` : '';
    const extraPh = extra.names.length ? `, ${extra.placeholders.join(', ')}` : '';

    if (armCol) {
      await env.DB.prepare(
        `INSERT INTO agentsam_usage_events (
          id, tenant_id, workspace_id${uidMid}, session_id, agent_name, provider, model, model_key,
          tokens_in, tokens_out, total_tokens, cost_usd, status,
          event_type, duration_ms, routing_arm_id${reasonMid}${extraCols},
          created_at
        ) VALUES (?,?,?,?${uidMidPh},?,?,?,?,?,?,?,?,?,?,?,?${reasonMidPh}${extraPh},unixepoch())`,
      )
        .bind(
          telemetryId,
          tidInsert,
          wsInsert,
          ...(hasUid ? [uidUsage] : []),
          sid,
          'agent-sam',
          actualProvider,
          rawModel || 'unknown',
          catalogModelKey || rawModel || 'unknown',
          tokens.tokens_in,
          tokens.tokens_out,
          tokens.total_tokens,
          estimatedCost ?? 0,
          eventStatus,
          'agent_chat',
          latencyMs != null && Number.isFinite(Number(latencyMs))
            ? Math.floor(Number(latencyMs))
            : null,
          String(routingArmId).trim().slice(0, 120),
          ...(hasReasonCol ? [costReason] : []),
          ...extra.binds,
        )
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO agentsam_usage_events (
          id, tenant_id, workspace_id${uidMid}, session_id, agent_name, provider, model, model_key,
          tokens_in, tokens_out, total_tokens, cost_usd, status,
          event_type, duration_ms${reasonMid}${extraCols},
          created_at
        ) VALUES (?,?,?,?${uidMidPh},?,?,?,?,?,?,?,?,?,?,?${reasonMidPh}${extraPh},unixepoch())`,
      )
        .bind(
          telemetryId,
          tidInsert,
          wsInsert,
          ...(hasUid ? [uidUsage] : []),
          sid,
          'agent-sam',
          actualProvider,
          rawModel || 'unknown',
          catalogModelKey || rawModel || 'unknown',
          tokens.tokens_in,
          tokens.tokens_out,
          tokens.total_tokens,
          estimatedCost ?? 0,
          eventStatus,
          'agent_chat',
          latencyMs != null && Number.isFinite(Number(latencyMs))
            ? Math.floor(Number(latencyMs))
            : null,
          ...(hasReasonCol ? [costReason] : []),
          ...extra.binds,
        )
        .run();
    }

    try {
      await incrementAgentsamUsageRollupsDaily(env.DB, {
        tenantId: tidInsert,
        workspaceId: wsInsert,
        provider: String(provider || 'unknown'),
        tokensIn: tokIn,
        tokensOut: tokOut,
        costUsd: estimatedCost || 0,
        rollupSource: 'telemetry',
      });
    } catch (rollupErr) {
      console.warn('[recordUsage] rollup', rollupErr?.message ?? rollupErr);
    }

    if (mid && (estimatedCost ?? 0) > 0) {
      try {
        await recordSpend(env, {
          tenantId: mid,
          workspaceId: wsInsert,
          provider,
          amountUsd: estimatedCost,
          modelKey: catalogModelKey || rawModel,
          inputTokens,
          outputTokens,
          sessionId: sid,
          refId: telemetryId,
        });
      } catch (spendErr) {
        console.warn('[recordUsage] spend', spendErr?.message ?? spendErr);
      }
    }
  } catch (e) {
    console.error('[recordUsage] failed:', e.message);
  }

  const executionCtx = data?.executionCtx ?? data?.execution_ctx ?? null;
  await scheduleSpendAlerts(env, executionCtx, {
    tenantId: tidInsert,
    workspaceId: wsInsert,
    userId: userId != null ? String(userId).trim() : null,
    sessionId: sid,
  });

  return { telemetryId, estimatedCostUsd: estimatedCost ?? 0 };
}

/** @deprecated Prefer {@link recordUsage} — same implementation. */
export const writeTelemetry = recordUsage;
