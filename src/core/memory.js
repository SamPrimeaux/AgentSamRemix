/**
 * src/core/memory.js
 *
 * Agent memory helpers (routing priors, D1 facts). Do not wire
 * loadAgentMemoryForPrompt back into chat prompt build — that path still
 * Hyperdrive-queries agentsam.agentsam_memory. Chat recall later:
 * Vectorize AGENTSAM_VECTORIZE_MEMORY (tkt_chat_memory_vectorize_not_hyperdrive_2026_08).
 *
 * Thompson routing:
 *  writeRoutingMemoryPrior — called by applyRoutingArmUsageFeedback after each run
 *  to keep agentsam_model_routing_memory populated for cold-start priors.
 */

import { logSemanticSearch, createEmbedding } from '../../backend/http/agentsam/routes/memory-legacy.js';
import { isHyperdriveUsable, runHyperdriveQuery } from '../../backend/services/database/hyperdrive.js';
import { agentsamMemoryActiveSqlOrEmpty } from '../../backend/http/agentsam/routes/memory-resolve-runtime.js';

const MEMORY_KV_TTL_SEC   = 180;   // 3 minutes
const MEMORY_TIMEOUT_MS   = 2000;  // hard cap — never blocks model call
const MIN_WORDS_FOR_RAG   = 6;     // skip semantic search for short messages
const SUPABASE_REST_FALLBACK = null; // read from env.SUPABASE_URL at call time

// ─── Helpers ──────────────────────────────────────────────────────────────────

function supabaseOrigin(env) {
  const raw = env?.SUPABASE_URL && String(env.SUPABASE_URL).trim();
  return raw ? raw.replace(/\/$/, '') : SUPABASE_REST_FALLBACK;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function wordCount(s) {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function isSimpleCommand(msg) {
  return /^(pong|ping|hi|hello|hey|yes|no|ok|okay|sure|thanks|thx|test|help)[\s!?.]*$/i.test(
    msg.trim(),
  );
}

function formatD1MemoryBlock(rows) {
  if (!rows?.length) return '';
  const lines = rows.map((r) => {
    const t = String(r.memory_type || 'fact').toUpperCase();
    return `[${t}] ${r.key}: ${r.value}`;
  });
  return `\n## Agent Memory (${lines.length} items)\n${lines.join('\n')}\n`;
}

function formatSemanticBlock(rows) {
  if (!rows?.length) return '';
  const lines = rows
    .map((r) => {
      const sim = r.similarity != null ? `[${Number(r.similarity).toFixed(2)}] ` : '';
      const text = r.content ?? r.text ?? r.value ?? '';
      return text ? `- ${sim}${text}` : null;
    })
    .filter(Boolean);
  if (!lines.length) return '';
  return `\n## Semantic Context (${lines.length} items)\n${lines.join('\n')}\n`;
}

// ─── KV cache ─────────────────────────────────────────────────────────────────

function memoryKvKey(tenantId, workspaceId) {
  return `agentsam_memory:${tenantId}:${workspaceId || 'global'}`;
}

async function getCachedMemory(env, tenantId, workspaceId) {
  if (!env?.SESSION_CACHE) return null;
  try {
    const val = await env.SESSION_CACHE.get(memoryKvKey(tenantId, workspaceId));
    return val ?? null;
  } catch {
    return null;
  }
}

async function setCachedMemory(env, tenantId, workspaceId, value) {
  if (!env?.SESSION_CACHE || !value) return;
  try {
    await env.SESSION_CACHE.put(memoryKvKey(tenantId, workspaceId), value, {
      expirationTtl: MEMORY_KV_TTL_SEC,
    });
  } catch {
    // KV write failure must never break chat
  }
}

// ─── D1 agentsam_memory (keyword path, no embedding) ─────────────────────────

async function loadD1Memory(env, tenantId, workspaceId) {
  if (!env?.DB || !tenantId) return '';
  try {
    const { memoryExcludeNoiseSourcesSql } = await import('./agentsam-memory-curation.js');
    const noiseSql = memoryExcludeNoiseSourcesSql('source');
    const wsClause = workspaceId
      ? `AND (workspace_id = ? OR workspace_id IS NULL OR TRIM(COALESCE(workspace_id,'')) = '')`
      : `AND (workspace_id IS NULL OR TRIM(COALESCE(workspace_id,'')) = '')`;
    const binds = workspaceId
      ? [String(tenantId), String(workspaceId)]
      : [String(tenantId)];

    const activeSql = await agentsamMemoryActiveSqlOrEmpty(env.DB);
    const { results } = await env.DB.prepare(
      `SELECT id, key, value, memory_type, confidence, decay_score
       FROM agentsam_memory
       WHERE tenant_id = ? ${wsClause}
         AND ${activeSql}
         AND ${noiseSql}
         AND decay_score > 0.3
         AND (expires_at IS NULL OR expires_at > unixepoch())
         AND value NOT LIKE '[STALE%'
       ORDER BY
         CASE memory_type
           WHEN 'error'      THEN 1
           WHEN 'decision'   THEN 2
           WHEN 'fact'       THEN 3
           WHEN 'skill'      THEN 4
           WHEN 'preference' THEN 5
           WHEN 'project'    THEN 6
           ELSE 7
         END,
         confidence DESC, decay_score DESC
       LIMIT 20`,
    )
      .bind(...binds)
      .all();

    const list = results || [];
    if (!list.length) return '';

    // Fire-and-forget recall count update
    const ids = list.map((r) => r.id).filter(Boolean);
    if (ids.length && env.DB) {
      const ph = ids.map(() => '?').join(',');
      env.DB.prepare(
        `UPDATE agentsam_memory
         SET recall_count    = recall_count + 1,
             last_recalled_at = unixepoch(),
             updated_at       = unixepoch()
         WHERE id IN (${ph})`,
      )
        .bind(...ids)
        .run()
        .catch(() => {});
    }

    return formatD1MemoryBlock(list);
  } catch (e) {
    console.warn('[memory] d1_load', e?.message ?? e);
    return '';
  }
}

// ─── Supabase search_all_context_logged (semantic, Hyperdrive) ────────────────

async function searchSupabaseContext(env, userMessage, tenantId, workspaceId, sessionId) {
  const q = userMessage.slice(0, 1000);
  const tid = String(tenantId || '').trim();
  if (!tid) return '';

  if (isHyperdriveUsable(env)) {
    try {
      const { embedding } = await createEmbedding(env, q);
      if (!Array.isArray(embedding) || !embedding.length) throw new Error('empty_embedding');
      const embeddingStr = `[${embedding.join(',')}]`;
      const queryPreview = String(userMessage || '').slice(0, 120);
      const dim = embedding.length;
      const vecSqlType = `vector(${dim})`;
      const filterAgent = String(env.RAG_AGENT_ID || 'agent-sam').trim();
      const ws =
        workspaceId != null && String(workspaceId).trim() !== '' ? String(workspaceId).trim() : null;

      const sql = `SELECT * FROM public.search_all_context_logged(
        $1::${vecSqlType}, $2::text, $3::float8, $4::int,
        $5::text, $6::text, $7::text, $8::text
      )`;
      const r = await runHyperdriveQuery(env, sql, [
        embeddingStr,
        queryPreview,
        0.7,
        10,
        filterAgent,
        tid || null,
        ws,
        null,
      ]);
      if (r.ok && Array.isArray(r.rows) && r.rows.length) {
        return formatSemanticBlock(r.rows);
      }
    } catch (e) {
      console.warn('[memory] search_all_context_logged hyperdrive', e?.message ?? e);
    }
  }

  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return '';
  try {
    const url = `${supabaseOrigin(env)}/rest/v1/rpc/search_all_context_logged`;
    const body = JSON.stringify({
      p_query:        userMessage.slice(0, 1000),
      p_tenant_id:    tenantId,
      p_workspace_id: workspaceId || null,
      p_session_id:   sessionId   || null,
      p_match_count:  8,
      p_threshold:    0.72,
    });
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${key}`,
        apikey:         key,
        Prefer:         'return=representation',
      },
      body,
    });
    if (!res.ok) return '';
    const json = await res.json().catch(() => []);
    return formatSemanticBlock(Array.isArray(json) ? json : []);
  } catch {
    return '';
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Primary entry point called by agent.js before every model dispatch.
 *
 * Returns a markdown block to append to the system prompt, or '' to skip.
 * Never throws. Never blocks longer than MEMORY_TIMEOUT_MS.
 */
export async function loadAgentMemoryForPrompt(env, tenantId, ctx = {}) {
  const userMessage  = ctx?.userMessage != null ? String(ctx.userMessage).trim() : '';
  const workspaceId  = ctx?.workspaceId  != null && String(ctx.workspaceId).trim()  !== '' ? String(ctx.workspaceId).trim()  : null;
  const sessionId    = ctx?.sessionId    != null && String(ctx.sessionId).trim()    !== '' ? String(ctx.sessionId).trim()    : null;

  // Fast exits — don't touch any DB
  if (!tenantId) return '';
  if (!userMessage || isSimpleCommand(userMessage)) return '';

  const isLongMessage = wordCount(userMessage) >= MIN_WORDS_FOR_RAG;

  // KV cache hit — one read, no D1 or Supabase
  const cached = await withTimeout(
    getCachedMemory(env, tenantId, workspaceId),
    300,
  );
  if (cached != null) return cached;

  // Race both sources against the hard timeout
  const userId =
    ctx?.userId != null && String(ctx.userId).trim() !== ''
      ? String(ctx.userId).trim()
      : ctx?.user_id != null && String(ctx.user_id).trim() !== ''
        ? String(ctx.user_id).trim()
        : null;

  const work = async () => {
    const parts = await Promise.all([
      // D1 key/value facts — always fast
      loadD1Memory(env, tenantId, workspaceId),
      // Private agentsam.agentsam_memory — no public.search_all_context / no Vectorize required
      isLongMessage
        ? import('../../backend/http/agentsam/routes/private-memory.js').then(({ loadPrivateMemoryForPrompt }) =>
            loadPrivateMemoryForPrompt(env, {
              tenantId,
              workspaceId,
              userId,
              userMessage,
              limit: 12,
            }),
          )
        : Promise.resolve(''),
    ]);

    const d1Block   = parts[0] || '';
    const semBlock  = parts[1] || '';
    const combined  = [d1Block, semBlock].filter(Boolean).join('\n');

    // Write back to KV for next request (fire-and-forget)
    if (combined) {
      setCachedMemory(env, tenantId, workspaceId, combined).catch(() => {});
    }

    return combined || '';
  };

  try {
    return (await withTimeout(work(), MEMORY_TIMEOUT_MS)) || '';
  } catch {
    return '';
  }
}

/**
 * Raw D1-only memory load (no embedding, no timeout) — used by crons and non-chat paths.
 */
export async function loadAgentMemory(env, tenantId) {
  return loadD1Memory(env, tenantId, null);
}

// ─── Supabase recallSemanticMemory (kept for backward compat, non-chat paths) ─

export async function recallSemanticMemory(env, embedding, sessionId, agentId, workspaceId) {
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !Array.isArray(embedding) || !embedding.length) return [];
  try {
    const res = await fetch(`${supabaseOrigin(env)}/rest/v1/rpc/match_agent_memory`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${key}`,
        apikey:         key,
      },
      body: JSON.stringify({
        query_embedding: embedding,
        p_session_id:    sessionId   || null,
        p_agent_id:      agentId     || null,
        p_workspace_id:  workspaceId || null,
        p_limit:         10,
        p_threshold:     0.75,
      }),
    });
    if (!res.ok) return [];
    const json = await res.json().catch(() => []);
    return Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
}

// ─── Thompson routing memory write-back ───────────────────────────────────────

/** Derive provider from model_key when arm/catalog provider is missing. */
export function deriveProvider(modelKey, fallback = null) {
  if (!modelKey) return fallback;
  const k = modelKey.toLowerCase();
  if (k.startsWith('gpt-') || k.startsWith('o1')) return 'openai';
  if (k.startsWith('claude-')) return 'anthropic';
  if (k.startsWith('gemini-')) return 'google';
  if (k.startsWith('llama') || k.startsWith('wai-') || k.startsWith('@cf/')) return 'workers_ai';
  if (k.startsWith('deepseek-') || k === 'deepseek-r1' || k === 'deepseek-v3') return 'deepseek';
  if (k.startsWith('qwen') || k.includes('deepseek')) return 'ollama';
  return fallback;
}

/**
 * Called after each training-eligible outcome to keep agentsam_model_routing_memory
 * populated for cold-start Thompson priors (applyRoutingArmUsageFeedback when ETO
 * table is absent; agentsam_performance_eto_events → syncRoutingMemoryPriorFromEto when present).
 *
 * Uses INSERT OR REPLACE with an Welford running average so each row stays
 * lightweight and never grows unbounded.
 */
export async function writeRoutingMemoryPrior(env, {
  workspaceId,
  taskType,
  modelKey,
  provider,
  success,
  latencyMs,
  costUsd,
}) {
  if (!env?.DB || !workspaceId || !taskType || !modelKey) return;
  try {
    const ws  = String(workspaceId).trim();
    const tt  = String(taskType).trim();
    const mk  = String(modelKey).trim();
    const pv =
      provider != null && String(provider).trim() !== ''
        ? String(provider).trim()
        : deriveProvider(mk) ?? 'unknown';

    // Read existing row
    const existing = await env.DB.prepare(
      `SELECT success_rate, avg_latency_ms, avg_cost_usd, sample_n
       FROM agentsam_model_routing_memory
       WHERE workspace_id = ? AND task_type = ? AND model_key = ?
       LIMIT 1`,
    ).bind(ws, tt, mk).first().catch(() => null);

    const n         = Number(existing?.sample_n ?? 0);
    const newN      = n + 1;
    const successVal = success ? 1.0 : 0.0;

    // Welford incremental mean
    const prevSr  = Number(existing?.success_rate   ?? 0.5);
    const prevLat = Number(existing?.avg_latency_ms ?? latencyMs ?? 0);
    const prevCost= Number(existing?.avg_cost_usd   ?? costUsd   ?? 0);

    const newSr   = prevSr   + (successVal                   - prevSr)   / newN;
    const newLat  = latencyMs != null ? prevLat + (latencyMs - prevLat) / newN : prevLat;
    const newCost = costUsd   != null ? prevCost + (costUsd  - prevCost) / newN : prevCost;

    await env.DB.prepare(
      `INSERT INTO agentsam_model_routing_memory
         (workspace_id, task_type, model_key, provider,
          success_rate, avg_latency_ms, avg_cost_usd, sample_n,
          last_evaluated_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(task_type, model_key, workspace_id) DO UPDATE SET
         provider          = excluded.provider,
         success_rate      = excluded.success_rate,
         avg_latency_ms    = excluded.avg_latency_ms,
         avg_cost_usd      = excluded.avg_cost_usd,
         sample_n          = excluded.sample_n,
         last_evaluated_at = excluded.last_evaluated_at,
         updated_at        = excluded.updated_at`,
    ).bind(ws, tt, mk, pv, newSr, newLat, newCost, newN).run();
  } catch (e) {
    // Routing memory write must never break chat
    console.warn('[memory] writeRoutingMemoryPrior', e?.message ?? e);
  }
}

// ─── Cron / rollup exports (unchanged) ────────────────────────────────────────

/**
 * Cron alias for 1 AM `tool_call_log_compact`.
 * Preferred source: agentsam_tool_call_log (not agentsam_mcp_tool_execution).
 */
export async function compactAgentsamToolCallLogToStats(env) {
  if (!env?.DB) return { ok: false, skipped: true, reason: 'no_db' };
  const { rollupToolCallLogDaily } = await import('./one-am-table-compaction.js');
  return rollupToolCallLogDaily(env);
}

const EPM_ON_CONFLICT = `ON CONFLICT(
       tenant_id,
       workspace_id,
       metric_date,
       metric_grain,
       source_table,
       command_id,
       command_slug,
       tool_name,
       tool_category,
       workflow_id,
       task_type,
       intent_category,
       model_key,
       provider,
       trigger_key
     ) DO UPDATE SET
       execution_count = excluded.execution_count,
       success_count = excluded.success_count,
       failure_count = excluded.failure_count,
       timeout_count = COALESCE(excluded.timeout_count, timeout_count),
       avg_duration_ms = excluded.avg_duration_ms,
       min_duration_ms = excluded.min_duration_ms,
       max_duration_ms = excluded.max_duration_ms,
       success_rate_percent = excluded.success_rate_percent,
       failure_rate_percent = COALESCE(excluded.failure_rate_percent, failure_rate_percent),
       total_tokens_consumed = excluded.total_tokens_consumed,
       input_tokens = COALESCE(excluded.input_tokens, input_tokens),
       output_tokens = COALESCE(excluded.output_tokens, output_tokens),
       total_cost_usd = excluded.total_cost_usd,
       avg_cost_usd = COALESCE(excluded.avg_cost_usd, avg_cost_usd),
       total_cost_cents = excluded.total_cost_cents,
       sla_breach_count = COALESCE(excluded.sla_breach_count, sla_breach_count),
       sla_breach_rate_percent = COALESCE(excluded.sla_breach_rate_percent, sla_breach_rate_percent),
       last_computed_at = unixepoch()`;

/** Daily grain: command runs (scoped), agent runs, and unscoped command runs → execution_performance_metrics. */
export async function rollupExecutionPerformanceMetrics(env) {
  if (!env?.DB) return;
  const dayStart = `unixepoch('now', '-1 day')`;
  const dayEnd = `unixepoch('now')`;
  const metricDate = `date('now', '-1 day')`;

  const statements = [
    env.DB.prepare(
      `INSERT INTO agentsam_execution_performance_metrics
      (id, tenant_id, workspace_id, metric_date, metric_grain, source_table,
       command_id, command_slug,
       execution_count, success_count, failure_count,
       avg_duration_ms, min_duration_ms, max_duration_ms,
       success_rate_percent, total_tokens_consumed, total_cost_usd, total_cost_cents,
       last_computed_at)
     SELECT
       'epm_' || lower(hex(randomblob(8))),
       w.tenant_id,
       acr.workspace_id,
       ${metricDate},
       'daily',
       'agentsam_command_run',
       acr.selected_command_id,
       acr.selected_command_slug,
       COUNT(*),
       SUM(CASE WHEN acr.success=1 THEN 1 ELSE 0 END),
       SUM(CASE WHEN acr.success=0 THEN 1 ELSE 0 END),
       AVG(acr.duration_ms),
       MIN(acr.duration_ms),
       MAX(acr.duration_ms),
       ROUND(AVG(acr.success)*100, 2),
       SUM(COALESCE(acr.input_tokens, 0) + COALESCE(acr.output_tokens, 0)),
       SUM(COALESCE(acr.cost_usd, 0)),
       SUM(COALESCE(acr.cost_usd, 0) * 100),
       unixepoch()
     FROM agentsam_command_run acr
     INNER JOIN agentsam_workspace w ON w.id = acr.workspace_id
     WHERE acr.selected_command_id IS NOT NULL
       AND acr.created_at >= ${dayStart}
       AND acr.created_at < ${dayEnd}
     GROUP BY w.tenant_id, acr.workspace_id, acr.selected_command_id, acr.selected_command_slug
     ${EPM_ON_CONFLICT}`,
    ),
    env.DB.prepare(
      `INSERT INTO agentsam_execution_performance_metrics
      (id, tenant_id, workspace_id, metric_date, metric_grain, source_table,
       model_key, intent_category,
       execution_count, success_count, failure_count, timeout_count,
       avg_duration_ms, min_duration_ms, max_duration_ms,
       total_tokens_consumed, input_tokens, output_tokens,
       total_cost_usd, avg_cost_usd, total_cost_cents,
       success_rate_percent, failure_rate_percent,
       sla_breach_count, sla_breach_rate_percent,
       last_computed_at)
     SELECT
       'epm_' || lower(hex(randomblob(8))),
       COALESCE(NULLIF(trim(ar.tenant_id), ''), 'platform'),
       COALESCE(ar.workspace_id, ''),
       ${metricDate},
       'daily',
       'mixed',
       COALESCE(ar.model_id, ''),
       COALESCE(ar.task_type, ''),
       COUNT(*),
       SUM(CASE WHEN ar.status = 'completed' THEN 1 ELSE 0 END),
       SUM(CASE WHEN ar.status = 'failed' THEN 1 ELSE 0 END),
       SUM(COALESCE(ar.timed_out, 0)),
       ROUND(AVG(
         CASE WHEN ar.completed_at IS NOT NULL AND ar.started_at IS NOT NULL
           THEN (julianday(ar.completed_at) - julianday(ar.started_at)) * 86400000
           ELSE NULL END
       )),
       CAST(MIN(
         CASE WHEN ar.completed_at IS NOT NULL AND ar.started_at IS NOT NULL
           THEN (julianday(ar.completed_at) - julianday(ar.started_at)) * 86400000
           ELSE NULL END
       ) AS INTEGER),
       CAST(MAX(
         CASE WHEN ar.completed_at IS NOT NULL AND ar.started_at IS NOT NULL
           THEN (julianday(ar.completed_at) - julianday(ar.started_at)) * 86400000
           ELSE NULL END
       ) AS INTEGER),
       SUM(COALESCE(ar.input_tokens, 0) + COALESCE(ar.output_tokens, 0)),
       SUM(COALESCE(ar.input_tokens, 0)),
       SUM(COALESCE(ar.output_tokens, 0)),
       ROUND(SUM(COALESCE(ar.cost_usd, 0)), 6),
       ROUND(AVG(COALESCE(ar.cost_usd, 0)), 6),
       ROUND(SUM(COALESCE(ar.cost_usd, 0)) * 100, 4),
       ROUND(100.0 * SUM(CASE WHEN ar.status = 'completed' THEN 1 ELSE 0 END) / COUNT(*), 2),
       ROUND(100.0 * SUM(CASE WHEN ar.status = 'failed' THEN 1 ELSE 0 END) / COUNT(*), 2),
       SUM(COALESCE(ar.sla_breach, 0)),
       ROUND(100.0 * SUM(COALESCE(ar.sla_breach, 0)) / COUNT(*), 2),
       unixepoch()
     FROM agentsam_agent_run ar
     WHERE date(ar.created_at) = ${metricDate}
     GROUP BY
       COALESCE(NULLIF(trim(ar.tenant_id), ''), 'platform'),
       COALESCE(ar.workspace_id, ''),
       COALESCE(ar.model_id, ''),
       COALESCE(ar.task_type, '')
     ${EPM_ON_CONFLICT}`,
    ),
    env.DB.prepare(
      `INSERT INTO agentsam_execution_performance_metrics
      (id, tenant_id, workspace_id, metric_date, metric_grain, source_table,
       model_key, intent_category,
       execution_count, success_count, failure_count,
       avg_duration_ms, min_duration_ms, max_duration_ms,
       total_tokens_consumed, total_cost_usd, avg_cost_usd, total_cost_cents,
       success_rate_percent, failure_rate_percent,
       last_computed_at)
     SELECT
       'epm_' || lower(hex(randomblob(8))),
       COALESCE(NULLIF(trim(w.tenant_id), ''), 'platform'),
       acr.workspace_id,
       ${metricDate},
       'daily',
       'mixed',
       COALESCE(acr.model_id, ''),
       COALESCE(acr.intent_category, acr.normalized_intent, ''),
       COUNT(*),
       SUM(CASE WHEN acr.success = 1 THEN 1 ELSE 0 END),
       SUM(CASE WHEN acr.success = 0 THEN 1 ELSE 0 END),
       ROUND(AVG(acr.duration_ms)),
       MIN(acr.duration_ms),
       MAX(acr.duration_ms),
       SUM(COALESCE(acr.input_tokens, 0) + COALESCE(acr.output_tokens, 0)),
       ROUND(SUM(COALESCE(acr.cost_usd, 0)), 6),
       ROUND(AVG(COALESCE(acr.cost_usd, 0)), 6),
       ROUND(SUM(COALESCE(acr.cost_usd, 0)) * 100, 4),
       ROUND(100.0 * SUM(CASE WHEN acr.success = 1 THEN 1 ELSE 0 END) / COUNT(*), 2),
       ROUND(100.0 * SUM(CASE WHEN acr.success = 0 THEN 1 ELSE 0 END) / COUNT(*), 2),
       unixepoch()
     FROM agentsam_command_run acr
     INNER JOIN agentsam_workspace w ON w.id = acr.workspace_id
     WHERE acr.selected_command_id IS NULL
       AND acr.created_at >= ${dayStart}
       AND acr.created_at < ${dayEnd}
     GROUP BY
       COALESCE(NULLIF(trim(w.tenant_id), ''), 'platform'),
       acr.workspace_id,
       COALESCE(acr.model_id, ''),
       COALESCE(acr.intent_category, acr.normalized_intent, '')
     ${EPM_ON_CONFLICT}`,
    ),
  ];

  for (const stmt of statements) {
    await stmt.run().catch((e) => console.warn('[cron] agentsam_execution_performance_metrics', e?.message ?? e));
  }

  // Batch 2 — compact tool_chain → EPM + usage_rollups (fail loud if summaries missing).
  try {
    const { runExecutionJournalLearningFeed } = await import('./execution-journal-learning-feed.js');
    await runExecutionJournalLearningFeed(env, {});
  } catch (e) {
    console.error('[cron] execution_journal_learning_feed', e?.message ?? e);
    throw e;
  }
}

/** @deprecated Use runMidnightUsageRollupPipeline — retained for imports/tests. */
export async function rollupUsageEventsDaily(env) {
  const { runMidnightUsageRollupPipeline } = await import('./agentsam-midnight-rollup-pipeline.js');
  return runMidnightUsageRollupPipeline(env);
}

/**
 * Roll up otlp_traces into agentsam_execution_performance_metrics (daily).
 *
 * Dimension mapping:
 * - tool_name: operation_name
 * - tool_category: 'tracing'
 * - trigger_key: worker_name (so uniqueness key can separate workers)
 * - source_table: 'otlp_traces'
 *
 * Percentiles are computed via row_number() (discrete percentile).
 */
export async function rollupOtlpTracesDaily(env) {
  if (!env?.DB) return;
  try {
    const traceCols = await env.DB.prepare(`PRAGMA table_info('otlp_traces')`).all().catch(() => null);
    const hasOtlp = Array.isArray(traceCols?.results) && traceCols.results.length > 0;
    if (!hasOtlp) return;
  } catch {
    return;
  }

  // Yesterday in UTC (matches other D1 rollups which use DATE('now','-1 day')).
  const metricDateExpr = `DATE('now','-1 day')`;

  await env.DB.prepare(
    `
    WITH base AS (
      SELECT
        tenant_id,
        workspace_id,
        COALESCE(NULLIF(TRIM(operation_name), ''), 'unknown') AS operation_name,
        COALESCE(NULLIF(TRIM(worker_name), ''), 'unknown') AS worker_name,
        COALESCE(
          CAST((end_time_unix_nano - start_time_unix_nano) / 1000000 AS INTEGER),
          0
        ) AS duration_ms,
        COALESCE(status_code, 'unset') AS status_code,
        COALESCE(d1_rows_read, 0) AS d1_rows_read,
        COALESCE(d1_rows_written, 0) AS d1_rows_written,
        start_time_unix_nano
      FROM otlp_traces
      WHERE DATE(start_time_unix_nano / 1000000000, 'unixepoch') = ${metricDateExpr}
        AND tenant_id IS NOT NULL AND TRIM(tenant_id) != ''
        AND workspace_id IS NOT NULL AND TRIM(workspace_id) != ''
    ),
    ranked AS (
      SELECT
        *,
        ROW_NUMBER() OVER (
          PARTITION BY tenant_id, workspace_id, operation_name, worker_name
          ORDER BY duration_ms ASC
        ) AS rn,
        COUNT(*) OVER (
          PARTITION BY tenant_id, workspace_id, operation_name, worker_name
        ) AS n
      FROM base
    ),
    pct AS (
      SELECT
        tenant_id,
        workspace_id,
        operation_name,
        worker_name,
        MAX(CASE WHEN rn = ((n + 1) / 2) THEN duration_ms END) AS median_ms,
        MAX(CASE WHEN rn = CAST(((n - 1) * 0.95) AS INT) + 1 THEN duration_ms END) AS p95_ms,
        MAX(CASE WHEN rn = CAST(((n - 1) * 0.99) AS INT) + 1 THEN duration_ms END) AS p99_ms
      FROM ranked
      GROUP BY tenant_id, workspace_id, operation_name, worker_name
    ),
    agg AS (
      SELECT
        tenant_id,
        workspace_id,
        operation_name,
        worker_name,
        COUNT(*) AS execution_count,
        SUM(CASE WHEN LOWER(COALESCE(status_code,'')) = 'ok' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN LOWER(COALESCE(status_code,'')) = 'error' THEN 1 ELSE 0 END) AS failure_count,
        AVG(duration_ms) AS avg_duration_ms,
        MIN(duration_ms) AS min_duration_ms,
        MAX(duration_ms) AS max_duration_ms,
        SUM(COALESCE(d1_rows_read, 0)) AS total_d1_rows_read,
        SUM(COALESCE(d1_rows_written, 0)) AS total_d1_rows_written
      FROM base
      GROUP BY tenant_id, workspace_id, operation_name, worker_name
    )
    INSERT INTO agentsam_execution_performance_metrics
      (id, tenant_id, workspace_id, metric_date, metric_grain, source_table,
       tool_name, tool_category, trigger_key,
       execution_count, success_count, failure_count,
       avg_duration_ms, min_duration_ms, max_duration_ms,
       median_duration_ms, p95_duration_ms, p99_duration_ms,
       success_rate_percent, failure_rate_percent,
       metadata_json, last_computed_at)
    SELECT
      'epm_' || lower(hex(randomblob(8))),
      a.tenant_id,
      a.workspace_id,
      ${metricDateExpr},
      'daily',
      'otlp_traces',
      a.operation_name,
      'tracing',
      a.worker_name,
      a.execution_count,
      a.success_count,
      a.failure_count,
      a.avg_duration_ms,
      a.min_duration_ms,
      a.max_duration_ms,
      COALESCE(p.median_ms, 0),
      COALESCE(p.p95_ms, 0),
      COALESCE(p.p99_ms, 0),
      CASE WHEN a.execution_count > 0 THEN ROUND(100.0 * a.success_count / a.execution_count, 2) ELSE 0 END,
      CASE WHEN a.execution_count > 0 THEN ROUND(100.0 * a.failure_count / a.execution_count, 2) ELSE 0 END,
      json_object(
        'worker_name', a.worker_name,
        'operation_name', a.operation_name,
        'd1_rows_read_total', a.total_d1_rows_read,
        'd1_rows_written_total', a.total_d1_rows_written
      ),
      unixepoch()
    FROM agg a
    LEFT JOIN pct p
      ON p.tenant_id = a.tenant_id
     AND p.workspace_id = a.workspace_id
     AND p.operation_name = a.operation_name
     AND p.worker_name = a.worker_name
    ON CONFLICT(
      tenant_id,
      workspace_id,
      metric_date,
      metric_grain,
      source_table,
      command_id,
      command_slug,
      tool_name,
      tool_category,
      workflow_id,
      task_type,
      intent_category,
      model_key,
      provider,
      trigger_key
    ) DO UPDATE SET
      execution_count = excluded.execution_count,
      success_count = excluded.success_count,
      failure_count = excluded.failure_count,
      avg_duration_ms = excluded.avg_duration_ms,
      min_duration_ms = excluded.min_duration_ms,
      max_duration_ms = excluded.max_duration_ms,
      median_duration_ms = excluded.median_duration_ms,
      p95_duration_ms = excluded.p95_duration_ms,
      p99_duration_ms = excluded.p99_duration_ms,
      success_rate_percent = excluded.success_rate_percent,
      failure_rate_percent = excluded.failure_rate_percent,
      metadata_json = excluded.metadata_json,
      last_computed_at = unixepoch()
  `,
  )
    .run()
    .catch((e) => console.warn('[cron] otlp_traces rollup', e?.message ?? e));
}

export async function runAgentsamMemoryDecay(env) {
  let d1Changes = 0;
  let pgChanges = 0;

  if (env?.DB) {
    try {
      const r1 = await env.DB.prepare(
        `UPDATE agentsam_memory
         SET decay_score = MAX(0, decay_score - 0.1),
             updated_at = unixepoch()
         WHERE COALESCE(is_pinned, 0) = 0
           AND (
             (last_recalled_at IS NOT NULL AND last_recalled_at < unixepoch('now', '-14 days'))
             OR (last_recalled_at IS NULL AND created_at < unixepoch('now', '-14 days'))
           )`,
      ).run();
      const n1 = r1.meta?.changes ?? r1.changes ?? 0;
      d1Changes += n1;
      if (n1 > 0) console.log('[cron] agentsam_memory decay_score adjusted:', n1);

      const r2 = await env.DB.prepare(
        `UPDATE agentsam_memory
         SET expires_at = unixepoch('now', '+7 days'),
             updated_at = unixepoch()
         WHERE decay_score <= 0
           AND expires_at IS NULL
           AND COALESCE(is_pinned, 0) = 0`,
      ).run();
      const n2 = r2.meta?.changes ?? r2.changes ?? 0;
      d1Changes += n2;
      if (n2 > 0) console.log('[cron] agentsam_memory expires_at set for decayed rows:', n2);
    } catch (e) {
      console.warn('[cron] agentsam_memory D1 decay failed', e?.message ?? e);
    }
  }

  // Canonical scored memory lives in Supabase — age confidence/importance for non-pinned rows.
  try {
    const { isHyperdriveUsable, runHyperdriveQuery } = await import('../../backend/services/database/hyperdrive.js');
    if (isHyperdriveUsable(env)) {
      const conf = await runHyperdriveQuery(
        env,
        `UPDATE agentsam.agentsam_memory
         SET confidence = GREATEST(0.05, confidence - 0.05),
             importance = CASE
               WHEN is_pinned = true THEN importance
               ELSE GREATEST(1, importance - 1)
             END,
             updated_at = now()
         WHERE is_archived = false
           AND is_pinned = false
           AND updated_at < now() - interval '14 days'
           AND (expires_at IS NULL OR expires_at > now())`,
        [],
      );
      if (conf.ok) {
        pgChanges = Number(conf.rowCount ?? conf.rows?.length ?? 0) || 0;
        if (pgChanges > 0) console.log('[cron] agentsam.agentsam_memory decayed:', pgChanges);
      } else {
        console.warn('[cron] pg memory decay failed', conf.error);
      }

      // Soft-archive very stale low-value facts (not pinned, confidence bottomed out).
      await runHyperdriveQuery(
        env,
        `UPDATE agentsam.agentsam_memory
         SET is_archived = true, updated_at = now()
         WHERE is_archived = false
           AND is_pinned = false
           AND confidence <= 0.1
           AND importance <= 3
           AND updated_at < now() - interval '45 days'`,
        [],
      );
    }
  } catch (e) {
    console.warn('[cron] supabase memory decay failed', e?.message ?? e);
  }

  return {
    rowsRead: 0,
    rowsWritten: d1Changes + pgChanges,
    metadata: { d1_changes: d1Changes, pg_changes: pgChanges },
  };
}

/** Upsert a row; mirrors to private agentsam.agentsam_memory when Hyperdrive is available. */
export async function upsertAgentsamMemory(env, row, opts = {}) {
  if (!env?.DB) return { ok: false, error: 'no_d1' };
  const tenantId = row.tenantId != null ? String(row.tenantId) : null;
  const userId = row.userId != null ? String(row.userId) : null;
  const workspaceId =
    row.workspaceId != null && String(row.workspaceId).trim() !== ''
      ? String(row.workspaceId).trim()
      : null;
  const memoryType = row.memoryType != null ? String(row.memoryType) : 'fact';
  const key = row.key != null ? String(row.key) : '';
  const value = row.value != null ? String(row.value) : '';
  const source = row.source != null ? String(row.source) : 'agent_sam';
  if (!tenantId || !userId || !key || !value) return { ok: false, error: 'missing_fields' };

  const syncKey = `${tenantId}:${userId}:${key}`;
  const summary =
    row.summary != null ? String(row.summary) : value.slice(0, 400);
  const title = row.title != null ? String(row.title) : null;
  const importance = Math.min(10, Math.max(1, Math.floor(Number(row.importance ?? 5))));
  const isPinned = row.isPinned || row.is_pinned ? 1 : 0;
  let tagsJson = '[]';
  if (row.tags != null) {
    tagsJson =
      typeof row.tags === 'string' ? row.tags : JSON.stringify(row.tags);
  }

  let d1Row = null;
  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_memory (
         tenant_id, user_id, workspace_id, memory_type, key, value,
         title, summary, source, tags, sync_key, importance, is_pinned,
         confidence, decay_score, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1.0, 1.0, unixepoch())
       ON CONFLICT(tenant_id, user_id, key) DO UPDATE SET
         workspace_id = COALESCE(excluded.workspace_id, agentsam_memory.workspace_id),
         memory_type = excluded.memory_type,
         value = excluded.value,
         title = COALESCE(excluded.title, agentsam_memory.title),
         summary = COALESCE(excluded.summary, agentsam_memory.summary),
         source = excluded.source,
         tags = excluded.tags,
         sync_key = excluded.sync_key,
         importance = excluded.importance,
         is_pinned = excluded.is_pinned,
         confidence = excluded.confidence,
         decay_score = excluded.decay_score,
         updated_at = unixepoch()`,
    )
      .bind(
        tenantId,
        userId,
        workspaceId,
        memoryType,
        key,
        value,
        title,
        summary,
        source,
        tagsJson,
        syncKey,
        importance,
        isPinned,
      )
      .run();

    d1Row = await env.DB.prepare(
      `SELECT * FROM agentsam_memory WHERE tenant_id = ? AND user_id = ? AND key = ? LIMIT 1`,
    )
      .bind(tenantId, userId, key)
      .first();
  } catch (e) {
    console.warn('[agentsam_memory] upsertAgentsamMemory', e?.message ?? e);
    return { ok: false, error: String(e?.message ?? e) };
  }

  if (d1Row && workspaceId) {
    const { mirrorD1MemoryToPrivatePg } = await import('../../backend/http/agentsam/routes/private-memory.js');
    const mirror = await mirrorD1MemoryToPrivatePg(env, d1Row, opts);
    return { ok: true, key, mirror };
  }
  return { ok: true, key };
}
