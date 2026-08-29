/**
 * agent_costs — cost rows bound to session + optional routing arm (fire-and-forget).
 */

import { scheduleCompactionEvent } from './agentsam-ops-ledger.js';
import { pragmaTableInfo } from '../../backend/services/retention.js';
export { aggregateOpenAiCompatibleUsageTokens } from './openai-usage-tokens.js';

/**
 * Anthropic message usage with compaction exposes per-iteration token counts; top-level
 * input_tokens / output_tokens only reflect the final iteration unless aggregated.
 * @param {any} usage
 * @returns {{ input_tokens: number, output_tokens: number, cache_read_input_tokens: number, cache_creation_input_tokens: number }}
 */
export function aggregateAnthropicUsageTokens(usage) {
  if (!usage || typeof usage !== 'object') {
    return {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };
  }
  const iterations = usage.iterations;
  if (Array.isArray(iterations) && iterations.length) {
    return iterations.reduce(
      (acc, iter) => ({
        input_tokens: acc.input_tokens + (Number(iter?.input_tokens) || 0),
        output_tokens: acc.output_tokens + (Number(iter?.output_tokens) || 0),
        cache_read_input_tokens: acc.cache_read_input_tokens + (Number(iter?.cache_read_input_tokens) || 0),
        cache_creation_input_tokens:
          acc.cache_creation_input_tokens + (Number(iter?.cache_creation_input_tokens) || 0),
      }),
      {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    );
  }
  return {
    input_tokens: Number(usage.input_tokens) || 0,
    output_tokens: Number(usage.output_tokens) || 0,
    cache_read_input_tokens: Number(usage.cache_read_input_tokens) || 0,
    cache_creation_input_tokens: Number(usage.cache_creation_input_tokens) || 0,
  };
}

/**
 * OpenAI / DeepSeek chat.completions usage (incl. DeepSeek disk cache hit/miss).
 * @param {any} usage
 */
/**
 * Anthropic compaction beta: usage.iterations includes type `compaction` then `message`.
 * @param {any} usage
 * @returns {{ tokens_before: number, tokens_after: number, compaction_output_tokens: number } | null}
 */
export function extractCompactionFromAnthropicUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const iterations = usage.iterations;
  if (!Array.isArray(iterations) || !iterations.length) return null;
  const compactionIter = iterations.find((i) => i && String(i.type) === 'compaction');
  if (!compactionIter) return null;
  const messageIter = iterations.find((i) => i && String(i.type) === 'message');
  const tokensBefore = Math.max(0, Math.floor(Number(compactionIter.input_tokens) || 0));
  const tokensAfter = messageIter
    ? Math.max(0, Math.floor(Number(messageIter.input_tokens) || 0))
    : Math.max(0, Math.floor(Number(usage.input_tokens) || 0));
  return {
    tokens_before: tokensBefore,
    tokens_after: tokensAfter,
    compaction_output_tokens: Math.max(0, Math.floor(Number(compactionIter.output_tokens) || 0)),
  };
}

/**
 * Fire-and-forget D1 row when Anthropic server-side compaction ran this turn.
 * @returns {boolean} true when a compaction iteration was recorded
 */
export function scheduleCompactionFromAnthropicUsage(env, ctx, usage, meta = {}) {
  const extracted = extractCompactionFromAnthropicUsage(usage);
  if (!extracted) return false;
  const tid = meta.tenantId ?? meta.tenant_id;
  if (tid == null || String(tid).trim() === '') return false;
  scheduleCompactionEvent(env, ctx, {
    tenantId: tid,
    workspaceId: meta.workspaceId ?? meta.workspace_id ?? null,
    userId: meta.userId ?? meta.user_id ?? null,
    sessionId: meta.sessionId ?? meta.session_id ?? null,
    provider: meta.provider ?? 'anthropic',
    modelKey: meta.modelKey ?? meta.model_key ?? 'unknown',
    tokensBefore: extracted.tokens_before,
    tokensAfter: extracted.tokens_after,
    compactionStrategy: meta.compactionStrategy ?? meta.compaction_strategy ?? 'summarize',
    metadata: {
      source: 'agent_chat',
      compaction_output_tokens: extracted.compaction_output_tokens,
      ...(meta.metadata && typeof meta.metadata === 'object' ? meta.metadata : {}),
    },
  });
  return true;
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   workspaceId: string,
 *   tenantId: string,
 *   sessionId?: string | null,
 *   routingArmId?: string | null,
 *   modelUsed: string,
 *   tokensIn?: number,
 *   tokensOut?: number,
 *   costUsd?: number,
 *   taskType?: string,
 *   userId?: string | null,
 *   isStreaming?: boolean,
 *   errorType?: string | null,
 * }} o
 */
export function scheduleInsertAgentCost(env, ctx, o) {
  if (!env?.DB || !ctx?.waitUntil) return;
  const ws = o.workspaceId != null ? String(o.workspaceId).trim() : '';
  const tid = o.tenantId != null ? String(o.tenantId).trim() : '';
  if (!ws || !tid) return;

  ctx.waitUntil(
    (async () => {
      const cols = await pragmaTableInfo(env.DB, 'agent_costs');
      if (!cols.size) return;
      const parts = [];
      const binds = [];
      const add = (name, val) => {
        if (!cols.has(name)) return;
        parts.push(name);
        binds.push(val);
      };

      if (cols.has('model_used')) add('model_used', String(o.modelUsed || 'unknown').slice(0, 500));
      if (cols.has('tokens_in')) add('tokens_in', Math.max(0, Math.floor(Number(o.tokensIn) || 0)));
      if (cols.has('tokens_out')) add('tokens_out', Math.max(0, Math.floor(Number(o.tokensOut) || 0)));
      if (cols.has('cost_usd')) add('cost_usd', Number(o.costUsd) || 0);
      if (cols.has('task_type')) add('task_type', String(o.taskType || 'chat').slice(0, 120));
      if (cols.has('user_id')) add('user_id', o.userId != null ? String(o.userId).slice(0, 120) : null);
      add('workspace_id', ws);
      add('tenant_id', tid);
      add('session_id', o.sessionId != null ? String(o.sessionId).slice(0, 200) : null);
      add('routing_arm_id', o.routingArmId != null ? String(o.routingArmId).slice(0, 120) : null);
      if (cols.has('is_streaming')) add('is_streaming', o.isStreaming ? 1 : 0);
      add('error_type', o.errorType != null ? String(o.errorType).slice(0, 120) : null);
      if (cols.has('created_at')) {
        parts.push('created_at');
        binds.push(new Date().toISOString().replace('T', ' ').slice(0, 19));
      }

      if (parts.length < 2) return;
      try {
        await env.DB.prepare(
          `INSERT INTO agent_costs (${parts.join(', ')}) VALUES (${parts.map(() => '?').join(', ')})`,
        )
          .bind(...binds)
          .run();
      } catch (e) {
        console.warn('[agent_costs]', e?.message ?? e);
      }
    })(),
  );
}
