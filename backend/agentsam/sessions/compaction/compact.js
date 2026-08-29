/**
 * Universal conversation compaction for Agent Sam chat spine.
 *
 * Law:
 *   usable = max(0, contextWindowTokens - reservedOutputToolSystemBudget)
 *   compactAt = floor(usable * 0.85)
 *
 * Default compaction: archive + embed via memory_embed lane (no LLM spend).
 * Optional LLM summarize: params.llmSummary === true only.
 */

import { writeContextToR2, readContextFromR2 } from '../../../services/context/r2-context-store.js';
import { sha256Hex } from '../../../../packages/shared/crypto/sha256.js';
import { dispatchComplete } from '../../runtime/provider-dispatch.js';
import { scheduleCompactionEvent } from '../../../../src/core/agentsam-ops-ledger.js';
import { bumpPromptCacheOnCompaction } from '../../../services/prompt-pattern/economics/observe.js';
import { resolveModelForTask } from '../../../../src/core/resolveModel.js';
import {
  resolveCodeIndexLaneConfig,
  embedSpecFromCodeIndexLaneConfig,
} from '../../codebase/code-index-lane-resolve.js';

/**
 * Compaction digest embeddings use the same Google lane as the codebase indexer
 * (D1 pgvector registry → `code_index_embed` arm → model catalog). No hardcoded
 * text-embedding-3-large.
 *
 * @param {any} env
 * @returns {Promise<{ provider: string, model: string, modelKey: string, dimensions: number, catalogId: string|null, armId: string }>}
 */
export async function resolveCompactionEmbedSpec(env) {
  const config = await resolveCodeIndexLaneConfig(env);
  return embedSpecFromCodeIndexLaneConfig(config);
}

/** Compact when estimate reaches this fraction of usable context. */
export const COMPACTION_USABLE_RATIO = 0.85;
/**
 * Default reserve when max_output_tokens is unknown.
 * Prefer catalog max_output (or assembler-supplied reserve) over this floor.
 */
export const COMPACTION_RESERVED_TOKENS = 16_000;
/**
 * @deprecated Never raise compactAt above usable*0.85. Kept only for callers
 * that still import the symbol; resolveCompactionBudget ignores it.
 */
export const COMPACTION_MIN_TOKENS = 32_000;

/** Recent messages kept verbatim after older history is archived (working copy). */
export const COMPACTION_MESSAGES_TO_RETAIN = 24;

export const ARCHIVE_RECALL_HINT =
  '[Earlier turns archived to memory — use memory_search if you need prior context.]';

function buildDeterministicCompactionArchive(toCompact) {
  return (Array.isArray(toCompact) ? toCompact : [])
    .map((m) => {
      const role = String(m?.role || 'user');
      const body = String(m?.content || '').trim();
      return body ? `### ${role}\n${body}` : '';
    })
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 120_000);
}

const COMPACTION_SYSTEM = `You are a technical context compactor. Summarize the conversation below.
Preserve exactly: all technical decisions made, file names and paths,
migration numbers applied, errors and their resolutions, action items,
model or routing changes, hard constraints stated by the user.
Output plain prose. No markdown. No headers. No bullet points.
Stay under 800 tokens.`;

/**
 * usable = max(0, contextWindow - reserve); compactAt = floor(usable * 0.85).
 * A minimum must never push compactAt past usable space (e.g. 40k window /
 * 16k reserve → compactAt ≈ 20.4k, not 32k).
 *
 * @param {number} contextWindowTokens catalog / turn context window
 * @param {{ reservedTokens?: number }} [opts]
 * @returns {{ usable: number, compactAt: number, contextWindow: number, reserved: number }}
 */
export function resolveCompactionBudget(contextWindowTokens, opts = {}) {
  const contextWindow = Math.max(0, Math.floor(Number(contextWindowTokens) || 0));
  const cw = contextWindow > 0 ? contextWindow : 200_000;
  const reserved =
    Number(opts.reservedTokens) > 0
      ? Math.floor(Number(opts.reservedTokens))
      : COMPACTION_RESERVED_TOKENS;
  const usable = Math.max(0, cw - reserved);
  const compactAt = Math.floor(usable * COMPACTION_USABLE_RATIO);
  return { usable, compactAt, contextWindow: cw, reserved };
}

/** @deprecated use resolveCompactionBudget(contextWindow).compactAt */
export function resolveCompactionThreshold(contextWindow) {
  return resolveCompactionBudget(contextWindow).compactAt;
}

/**
 * @param {any} env
 * @param {string|null|undefined} modelKey
 * @returns {Promise<number>}
 */
export async function loadModelContextWindow(env, modelKey) {
  const mk = String(modelKey || '').trim();
  if (!env?.DB || !mk) return 0;
  try {
    const row = await env.DB.prepare(
      `SELECT context_window FROM agentsam_model_catalog
        WHERE model_key = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
    )
      .bind(mk)
      .first();
    return Math.max(0, Number(row?.context_window) || 0);
  } catch {
    return 0;
  }
}

/**
 * Prefer the turn's own model; else Thompson/resolver for context_compaction.
 * @param {any} env
 * @param {{
 *   modelKey?: string|null,
 *   userId: string,
 *   workspaceId: string,
 *   tenantId?: string|null,
 * }} params
 */
async function resolveCompactionSummaryModel(env, params) {
  const turnKey = String(params.modelKey || '').trim();
  if (turnKey) {
    return { model_key: turnKey, provider: null, source: 'turn_model' };
  }
  const resolved = await resolveModelForTask(env, {
    task_type: 'context_compaction',
    userId: params.userId,
    workspaceId: params.workspaceId,
    tenantId: params.tenantId || null,
  });
  if (!resolved?.model_key) throw new Error('compaction_summary_model_unresolved');
  return {
    model_key: String(resolved.model_key).trim(),
    provider: resolved.provider != null ? String(resolved.provider) : null,
    source: 'context_compaction',
  };
}

function estimateTokensFromMessages(messages) {
  const text = (Array.isArray(messages) ? messages : [])
    .map((m) => {
      try {
        return JSON.stringify(m ?? '');
      } catch {
        return String(m?.content ?? '');
      }
    })
    .join('');
  return Math.max(0, Math.ceil(text.length / 4));
}

export function normalizeMessagesForCompaction(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({
      role: String(m.role || 'user'),
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
    }));
}

function normalizeMessages(messages) {
  return normalizeMessagesForCompaction(messages);
}

export async function hydrateMessagesWithPriorDigest(env, conversationId, messages) {
  const out = normalizeMessages(messages);
  if (!env?.DB || !conversationId) return out;

  try {
    const row = await env.DB.prepare(
      `SELECT digest_text, digest_type FROM agentsam_context_digest
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
      .bind(String(conversationId))
      .first()
      .catch(() => null);

    const digestType = row?.digest_type != null ? String(row.digest_type).trim() : '';
    const stored = row?.digest_text != null ? String(row.digest_text).trim() : '';
    if (!stored) return out;

    // Embed-first conversation compactions store an R2 key — recall via memory_search, not prompt bloat.
    if (digestType === 'conversation' && stored.startsWith('context/')) {
      const hasHint = out.some(
        (m) =>
          m?.role === 'system' &&
          String(m?.content || '').includes('archived to memory'),
      );
      return hasHint ? out : [{ role: 'system', content: ARCHIVE_RECALL_HINT }, ...out];
    }

    if (!stored.startsWith('context/')) return out;

    console.log('[compaction]', 'prior_digest_read', { key: stored });
    const priorSummary = await readContextFromR2(env, stored);
    if (!priorSummary) return out;

    return [{ role: 'system', content: `[Prior context summary]\n${priorSummary}` }, ...out];
  } catch (e) {
    console.warn('[compaction] prior_digest', e?.message ?? e);
    return out;
  }
}

async function insertConversationContextDigest(env, fields) {
  const { insertContextDigestEvent } = await import(
    '../../../services/bootstrap/context-digest.js'
  );
  return insertContextDigestEvent(env, {
    workspaceId: fields.workspaceId,
    digestType: 'conversation',
    digestText: fields.r2Key,
    sourceHash: fields.sourceHash,
    sessionId: fields.sessionId,
    generationModel: fields.summaryModelKey || fields.generationModel,
    embeddingModel: fields.embeddingModel,
    embeddingDimensions: fields.embeddingDimensions,
    compactionEventId: fields.compactionEventId,
    rawSizeBytes: fields.rawSizeBytes,
    reducedSizeBytes: fields.reducedSizeBytes,
    tokenCount: fields.tokenCount,
    sourceUpdatedAtUnix: Math.floor(Date.now() / 1000),
  });
}


async function scheduleCompactionSideEffects(env, ctx, fields) {
  const agentRunId = fields.agentRunId != null ? String(fields.agentRunId).trim() : '';
  const summaryModelKey = String(fields.summaryModelKey || '').trim() || null;
  const compactionEventId =
    fields.compactionEventId != null
      ? String(fields.compactionEventId).trim()
      : `cmp_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  scheduleCompactionEvent(env, ctx, {
    id: compactionEventId,
    tenantId: fields.tenantId,
    workspaceId: fields.workspaceId,
    userId: fields.userId,
    sessionId: fields.sessionId,
    conversationId: fields.sessionId,
    provider: fields.summaryProvider || null,
    modelKey: summaryModelKey,
    tokensBefore: fields.tokensBefore,
    tokensAfter: fields.tokensAfter,
    compactionStrategy: fields.compactionStrategy || 'embed',
    compactionType:
      fields.compactionStrategy === 'summarize' ? 'context_summary' : 'context_embed',
    compactionScope: 'session',
    sourceKind: 'd1',
    sourceTable: agentRunId ? 'agentsam_agent_run' : 'agentsam_chat_sessions',
    reportArtifactUrl: fields.r2Key,
    contextDigestId: fields.contextDigestId || null,
    digestHash: fields.digestHash || null,
    sourceHash: fields.sourceHash || null,
    embeddingModel: fields.embeddingModel || null,
    embeddingDimensions: fields.embeddingDimensions || null,
    metadata: {
      compaction_type: 'conversation',
      compaction_scope: 'session',
      source_kind: 'd1',
      source_table: agentRunId ? 'agentsam_agent_run' : 'agentsam_chat_sessions',
      source_id: agentRunId || fields.sessionId,
      conversation_id: fields.sessionId,
      report_artifact_url: fields.r2Key,
      context_digest_id: fields.contextDigestId || null,
      digest_hash: fields.digestHash || null,
      source_hash: fields.sourceHash || null,
      embedding_model: fields.embeddingModel || null,
      embedding_dimensions: fields.embeddingDimensions || null,
      status: 'completed',
      context_window: fields.contextWindow ?? null,
      compact_at: fields.compactAt ?? null,
      summary_source: fields.summarySource ?? null,
    },
  });
  console.log('[compaction]', 'agentsam_compaction_events', {
    table: 'agentsam_compaction_events',
    scope: 'conversation',
  });
}

async function indexCompactionSummary(env, ctx, fields) {
  const p = (async () => {
    const { embedCompactionDigestSummary } = await import(
      '../../../services/bootstrap/compaction-digest-embed.js'
    );
    const embed = await embedCompactionDigestSummary(env, {
      workspaceId: fields.workspaceId,
      conversationId: fields.conversationId,
      summaryText: fields.summaryText,
      r2Key: fields.r2Key,
      digestId: fields.digestId,
      sourceHash: fields.sourceHash,
      userId: fields.userId,
      tenantId: fields.tenantId,
    });
    console.log('[compaction]', 'embed_policy', {
      ok: embed.ok === true,
      provider: embed.provider || null,
      model: embed.embedding_model || null,
      dimensions: embed.embedding_dimensions || null,
      pgvector_table: embed.pgvector_table || null,
      workspace_id: fields.workspaceId,
      conversation_id: fields.conversationId,
      r2_key: fields.r2Key || null,
      summary_chars: String(fields.summaryText || '').length,
    });
    return embed;
  })().catch((e) => {
    console.warn('[compaction] index_summary', e?.message ?? e);
    return { ok: false };
  });

  if (ctx?.waitUntil) {
    ctx.waitUntil(p);
    return null;
  }
  return p;
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   messages: unknown[],
 *   userId: string,
 *   workspaceId: string,
 *   tenantId: string|null,
 *   conversationId: string,
 *   modelKey?: string|null,
 *   contextWindowTokens?: number|null,
 *   contextWindow?: number|null,
 *   activeTools?: string[],
 *   systemPromptCacheHash?: string|null,
 *   agentRunId?: string|null,
 *   force?: boolean,
 *   llmSummary?: boolean,
 *   promptOverheadTokens?: number|null,
 * }} params
 */
export async function compactConversationMessagesIfNeeded(env, ctx, params) {
  const userId = String(params.userId || '').trim();
  const workspaceId = String(params.workspaceId || '').trim();
  const conversationId = String(params.conversationId || '').trim();
  if (!userId || !workspaceId || !conversationId) {
    throw new Error('compaction requires authenticated userId and resolved workspaceId');
  }

  let messages = normalizeMessages(params.messages);
  messages = await hydrateMessagesWithPriorDigest(env, conversationId, messages);

  const turnModelKey = String(params.modelKey || '').trim() || null;
  const contextWindowTokens =
    Number(params.contextWindowTokens) > 0
      ? Number(params.contextWindowTokens)
      : Number(params.contextWindow) > 0
        ? Number(params.contextWindow)
        : await loadModelContextWindow(env, turnModelKey);
  const budget = resolveCompactionBudget(contextWindowTokens);
  const overhead = Math.max(0, Math.floor(Number(params.promptOverheadTokens) || 0));
  const estimated = estimateTokensFromMessages(messages) + overhead;
  const threshold = budget.compactAt;

  if (
    !params.force &&
    (estimated <= threshold || messages.length <= COMPACTION_MESSAGES_TO_RETAIN + 1)
  ) {
    return {
      messages,
      compacted: false,
      estimated,
      threshold,
      compactAt: threshold,
      usable: budget.usable,
      contextWindow: budget.contextWindow,
    };
  }

  if (messages.length < 2) {
    return {
      messages,
      compacted: false,
      estimated,
      threshold,
      compactAt: threshold,
      usable: budget.usable,
      contextWindow: budget.contextWindow,
      reason: 'min_messages',
    };
  }

  const toCompact = messages.slice(0, -COMPACTION_MESSAGES_TO_RETAIN);
  const toRetain = messages.slice(-COMPACTION_MESSAGES_TO_RETAIN);

  const useLlmSummary = params.llmSummary === true;
  const archiveText = buildDeterministicCompactionArchive(toCompact);
  let summaryModelKey = null;
  let summaryProvider = null;
  let summarySource = null;
  let compactionStrategy = 'embed';
  let summaryText = archiveText;

  if (useLlmSummary) {
    compactionStrategy = 'summarize';
    try {
      const picked = await resolveCompactionSummaryModel(env, {
        modelKey: turnModelKey,
        userId,
        workspaceId,
        tenantId: params.tenantId || null,
      });
      summaryModelKey = picked.model_key;
      summaryProvider = picked.provider;
      summarySource = picked.source;
      const result = await dispatchComplete(env, {
        modelKey: summaryModelKey,
        systemPrompt: COMPACTION_SYSTEM,
        messages: toCompact.map((m) => ({ role: m.role, content: m.content })),
        tools: [],
        userId,
        options: { reasoningEffort: 'none', verbosity: 'low', maxOutputTokens: 1200 },
      });
      const llmText =
        (typeof result?.text === 'string' && result.text) ||
        result?.choices?.[0]?.message?.content ||
        result?.output_text ||
        '';
      summaryText = String(llmText).trim() || archiveText;
    } catch (e) {
      console.warn('[compaction] summary_model', e?.message ?? e);
      summaryText = archiveText;
      compactionStrategy = 'embed';
      summaryModelKey = null;
    }
  }

  if (!summaryText) {
    return {
      messages,
      compacted: false,
      estimated,
      threshold,
      compactAt: threshold,
      usable: budget.usable,
      contextWindow: budget.contextWindow,
    };
  }

  const r2Payload = useLlmSummary && summaryText !== archiveText ? summaryText : archiveText;
  const r2Key = await writeContextToR2(env, {
    tenantId: String(params.tenantId || 'system').trim(),
    userId,
    workspaceId,
    conversationId,
    type: 'digest',
    content: r2Payload,
  });
  console.log('[compaction]', 'r2_write', { key: r2Key });

  if (r2Key && env?.DB) {
    const chatSessionUpdate = env.DB.prepare(
      `UPDATE agentsam_chat_sessions
       SET latest_digest_r2_key = ?,
           digest_count = COALESCE(digest_count, 0) + 1,
           last_compacted_at = unixepoch(),
           updated_at = unixepoch()
       WHERE conversation_id = ?`,
    )
      .bind(r2Key, conversationId)
      .run()
      .catch((e) => console.error('[compaction] chat_sessions update failed', e?.message ?? e));
    if (ctx?.waitUntil) ctx.waitUntil(chatSessionUpdate);
    else void chatSessionUpdate;
  }

  const rawSize = toCompact.map((m) => m.content).join('').length;
  const reducedSize = summaryText.length;
  const tokensAfter =
    Math.ceil(summaryText.length / 4) + COMPACTION_MESSAGES_TO_RETAIN * 150;
  const sourceHash = await sha256Hex(toCompact.map((m) => m.content).join(''));

  const assembled =
    compactionStrategy === 'summarize'
      ? [{ role: 'system', content: `[Prior context summary]\n${summaryText}` }, ...toRetain]
      : [{ role: 'system', content: ARCHIVE_RECALL_HINT }, ...toRetain];

  const sideEffects = async () => {
    const compactionEventId = `cmp_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    let digestRow = null;
    let embedMeta = null;
    try {
      digestRow = await insertConversationContextDigest(env, {
        workspaceId,
        sessionId: conversationId,
        r2Key,
        sourceHash,
        rawSizeBytes: rawSize,
        reducedSizeBytes: reducedSize,
        tokenCount: Math.ceil(summaryText.length / 4),
        summaryModelKey: compactionStrategy === 'summarize' ? summaryModelKey : null,
        compactionEventId,
      });
      console.log('[compaction]', 'agentsam_context_digest', {
        table: 'agentsam_context_digest',
        session_id: conversationId,
        digest_id: digestRow?.id || null,
        append: true,
      });
    } catch (e) {
      console.warn('[compaction] context_digest', e?.message ?? e);
    }
    try {
      embedMeta = await indexCompactionSummary(env, null, {
        workspaceId,
        conversationId,
        r2Key,
        summaryText,
        digestId: digestRow?.id || null,
        sourceHash,
        userId,
        tenantId: params.tenantId || null,
      });
    } catch (e) {
      console.warn('[compaction] index_summary', e?.message ?? e);
    }
    if (digestRow?.id && embedMeta?.embedding_model && env?.DB) {
      await env.DB.prepare(
        `UPDATE agentsam_context_digest
            SET embedding_model = ?,
                embedding_dimensions = ?,
                updated_at_unix = unixepoch()
          WHERE id = ?`,
      )
        .bind(
          String(embedMeta.embedding_model),
          Number(embedMeta.embedding_dimensions) || null,
          digestRow.id,
        )
        .run()
        .catch((e) => console.warn('[compaction] digest embedding metadata', e?.message ?? e));
    }
    try {
      await scheduleCompactionSideEffects(env, null, {
        tenantId: params.tenantId || 'system',
        workspaceId,
        userId,
        sessionId: conversationId,
        agentRunId: params.agentRunId ?? null,
        tokensBefore: estimated,
        tokensAfter,
        r2Key,
        summaryModelKey: compactionStrategy === 'summarize' ? summaryModelKey : null,
        summaryProvider,
        summarySource,
        compactionStrategy,
        contextWindow: budget.contextWindow,
        compactAt: threshold,
        compactionEventId,
        contextDigestId: digestRow?.id || null,
        digestHash: digestRow?.digest_hash || null,
        sourceHash,
        embeddingModel: embedMeta?.embedding_model || null,
        embeddingDimensions: embedMeta?.embedding_dimensions || null,
      });
    } catch (e) {
      console.warn('[compaction] compaction_event', e?.message ?? e);
    }
    if (params.systemPromptCacheHash) {
      try {
        await bumpPromptCacheOnCompaction(env, {
          tenantId: params.tenantId || 'system',
          cacheKeyHash: params.systemPromptCacheHash,
          tokensSaved: Math.max(0, estimated - tokensAfter),
        });
      } catch (e) {
        console.warn('[compaction] prompt_cache_bump', e?.message ?? e);
      }
    }
  };

  if (ctx?.waitUntil) ctx.waitUntil(sideEffects());
  else await sideEffects();

  return {
    messages: assembled,
    compacted: true,
    estimated,
    tokensAfter,
    threshold,
    compactAt: threshold,
    usable: budget.usable,
    contextWindow: budget.contextWindow,
    summaryModelKey,
    summarySource,
    r2Key,
    summaryPreview: summaryText.slice(0, 400),
    retained: COMPACTION_MESSAGES_TO_RETAIN,
  };
}

/**
 * User-triggered /compact — bypasses token threshold; still retains last N turns.
 * @param {any} env
 * @param {any} ctx
 * @param {Parameters<typeof compactConversationMessagesIfNeeded>[2]} params
 */
export async function forceCompactConversationMessages(env, ctx, params) {
  return compactConversationMessagesIfNeeded(env, ctx, { ...params, force: true });
}
