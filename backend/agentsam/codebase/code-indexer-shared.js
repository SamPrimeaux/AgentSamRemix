/**
 * Code indexer — shared constants, embed helper, chunk/vector I/O, notify.
 *
 * Embed + PG table names resolve from D1 via resolveCodeIndexLaneConfig(env).
 * PG writes = session pooler SUPABASE_DB_URL — one client per batch (never connect-per-call).
 */
import { createCodeIndexEmbedding } from './code-index-embed.js';
import {
  runCodeIndexPgQuery,
  runCodeIndexPgTransaction,
} from './code-index-write-pipe.js';
import {
  resolveCodeIndexLaneConfig,
  requireCodeIndexLaneConfig,
  embedSpecFromCodeIndexLaneConfig,
} from './code-index-lane-resolve.js';
import { embedTextsViaGeminiBatchMode } from './gemini-batch-embed.js';
import { FULL_INDEX_MODE, normalizeCodeIndexMode } from './codebase-full-index.js';

/** @deprecated Not used — code index has no CF Vectorize binding. */
export const CODE_BINDING = null;
/** Per queue page — tune vs Worker wall/CPU; was 6, raised to 12 (2026-08 full-run throughput). */
export const FULL_FILES_PER_RUN = 12;
export const FULL_SYMBOLS_PER_RUN = 40;
export const FULL_FILES_CAP = 12;
export const FULL_SYMBOLS_CAP = 60;
export const EMBED_CONCURRENCY = 3;
/** Auto-stop full-index crawl when failures explode — stop burning embed spend on doomed runs. */
export const FULL_FAIL_ABORT_ABS = 50;
export const FULL_FAIL_ABORT_RATIO = 0.2;
export const FULL_FAIL_ABORT_MIN_ATTEMPTED = 20;
/** @deprecated CF Vectorize is not part of code index — kept so imports do not break. */
export const VECTORIZE_UPSERT_CONCURRENCY = 0;
export const CHUNK_TARGET_CHARS = 1600; // ~400 tokens
export const CHUNK_OVERLAP_CHARS = 200; // ~50 tokens
export const EMBED_BATCH = 20;
export const MAX_FILES_PER_RUN = 8;
/** WaitUntil kills leave status=running; reclaim quickly so resume kicks aren't stuck on job_not_idle. */
export const STALE_RUNNING_MINUTES = 1;
/** Explicit /api/internal/code-index/run?job_id= can reclaim sooner than the global stale window. */
export const EXPLICIT_STALE_SECONDS = 45;
/** Five-minute cron: running + no heartbeat longer than a queue batch wall is a dead isolate. */
export const MINUTE_STALE_RECLAIM_SECONDS = 120;
export const EMBED_TIMEOUT_MS = 12_000;
export const MAX_FILE_BYTES = 250 * 1024;

/**
 * Live chunks table from D1 lane registry (after resolveCodeIndexLaneConfig).
 * @param {any} env
 * @returns {string}
 */
export function getCodeIndexChunksTable(env) {
  return requireCodeIndexLaneConfig(env).tables.chunks;
}

/**
 * Live symbols table from D1 lane registry (after resolveCodeIndexLaneConfig).
 * @param {any} env
 * @returns {string}
 */
export function getCodeIndexSymbolsTable(env) {
  return requireCodeIndexLaneConfig(env).tables.symbols;
}

/**
 * Embed spec for createCodeIndexEmbedding (after resolveCodeIndexLaneConfig).
 * @param {any} env
 * @returns {{ provider: 'google', model: string, dimensions: number }}
 */
export function getCodeIndexEmbedSpec(env) {
  return embedSpecFromCodeIndexLaneConfig(requireCodeIndexLaneConfig(env));
}

/**
 * @deprecated Prefer getCodeIndexChunksTable(env). Throws unless lane already resolved.
 * @param {any} env
 */
export function CHUNKS_TABLE(env) {
  return getCodeIndexChunksTable(env);
}

/**
 * @deprecated Prefer getCodeIndexSymbolsTable(env). Throws unless lane already resolved.
 * @param {any} env
 */
export function SYMBOL_TABLE(env) {
  return getCodeIndexSymbolsTable(env);
}

/**
 * @deprecated Prefer getCodeIndexEmbedSpec(env). Throws unless lane already resolved.
 * @param {any} env
 */
export function EMBED_SPEC(env) {
  return getCodeIndexEmbedSpec(env);
}

export function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

/**
 * status=running with a frozen updated_at is a corpse, not an active worker.
 * @param {unknown} updatedAtUnix
 * @param {number} [nowSec]
 */
export function isCodeIndexRunningStale(updatedAtUnix, nowSec = nowUnix()) {
  const ts = Number(updatedAtUnix);
  if (!Number.isFinite(ts) || ts <= 1e9) return true;
  return nowSec - ts >= MINUTE_STALE_RECLAIM_SECONDS;
}

export async function embedForIndex(env, text, opts, timeoutMs = EMBED_TIMEOUT_MS) {
  await resolveCodeIndexLaneConfig(env);
  const embedOpts =
    opts?.spec != null
      ? opts
      : { ...opts, spec: embedSpecFromCodeIndexLaneConfig(requireCodeIndexLaneConfig(env)) };
  const embedPromise = createCodeIndexEmbedding(env, text, embedOpts);
  let timedOut = false;
  const marker = await Promise.race([
    embedPromise.then((result) => ({ ok: true, result })),
    new Promise((resolve) => {
      setTimeout(() => {
        timedOut = true;
        resolve({ ok: false, timedOut: true });
      }, timeoutMs);
    }),
  ]);
  if (marker.ok) return marker.result;
  // Soft timeout: still wait for the in-flight OpenAI call (usage + vector).
  try {
    const result = await embedPromise;
    if (timedOut) {
      console.warn('[code-indexer] embed_soft_timeout_recovered', {
        timeout_ms: timeoutMs,
        chars: String(text || '').length,
      });
    }
    return result;
  } catch (error) {
    const msg = error?.message != null ? String(error.message) : String(error);
    throw new Error(timedOut ? `embed_timeout: ${msg}` : msg);
  }
}

/**
 * Embed many texts for code-index.
 * mode=full → Gemini Batch Mode ($0.10/M). incremental/other → online ($0.20/M).
 *
 * @param {any} env
 * @param {string[]} texts
 * @param {{
 *   mode?: string,
 *   spec?: object,
 *   userId?: string|null,
 *   usage?: false | Record<string, unknown>,
 *   displayName?: string,
 * }} [opts]
 * @returns {Promise<Array<{ embedding: number[], provider: string, model: string, batch_name?: string }>>}
 */
export async function embedTextsForCodeIndex(env, texts, opts = {}) {
  const raw = Array.isArray(texts) ? texts : [];
  if (!raw.length) return [];
  // Preserve input indices — empty slots stay null so callers can align 1:1.
  /** @type {number[]} */
  const nonemptyIdx = [];
  /** @type {string[]} */
  const nonempty = [];
  for (let i = 0; i < raw.length; i += 1) {
    const t = String(raw[i] ?? '').trim();
    if (!t) continue;
    nonemptyIdx.push(i);
    nonempty.push(t);
  }
  /** @type {Array<{ embedding: number[], provider: string, model: string, batch_name?: string }|null>} */
  const out = raw.map(() => null);
  if (!nonempty.length) return out;

  await resolveCodeIndexLaneConfig(env);
  const spec = opts.spec || embedSpecFromCodeIndexLaneConfig(requireCodeIndexLaneConfig(env));
  const mode = normalizeCodeIndexMode(opts.mode);
  /** @type {Array<{ embedding: number[], provider: string, model: string, batch_name?: string }>} */
  let embedded;
  if (mode === FULL_INDEX_MODE && String(spec.provider || '').toLowerCase() === 'google') {
    embedded = await embedTextsViaGeminiBatchMode(env, nonempty, {
      spec,
      userId: opts.userId ?? null,
      usage: opts.usage,
      displayName: opts.displayName || `cidx_full_${Date.now()}`,
    });
  } else {
    embedded = [];
    for (const text of nonempty) {
      embedded.push(await embedForIndex(env, text, { ...opts, spec }));
    }
  }
  for (let j = 0; j < nonemptyIdx.length; j += 1) {
    out[nonemptyIdx[j]] = embedded[j] || null;
  }
  return out;
}

export function shouldAbortFullIndexForFailures({ failedFiles, attempted }) {
  const failed = Math.max(0, Number(failedFiles) || 0);
  const tried = Math.max(0, Number(attempted) || 0);
  if (failed >= FULL_FAIL_ABORT_ABS) return { abort: true, reason: 'abs' };
  if (tried >= FULL_FAIL_ABORT_MIN_ATTEMPTED && failed / tried >= FULL_FAIL_ABORT_RATIO) {
    return { abort: true, reason: 'ratio' };
  }
  return { abort: false, reason: null };
}

export async function notifyCodeIndexPush(env, job, outcome, detail = null) {
  const userId = job?.user_id != null ? String(job.user_id).trim() : '';
  if (!userId || !env) return { ok: false, reason: 'no_user' };
  const status = String(outcome || '').toLowerCase().trim();
  if (!status) return { ok: false, reason: 'no_outcome' };

  const repoFullName = job.repo_full_name != null ? String(job.repo_full_name).trim() : '';
  const projectId = job.project_id != null ? String(job.project_id).trim() : '';
  const workspaceId = job.workspace_id != null ? String(job.workspace_id).trim() : '';
  const err =
    detail != null && String(detail).trim()
      ? String(detail).trim()
      : job.last_error != null
        ? String(job.last_error).trim()
        : '';

  let subject = 'Codebase index update';
  let bodyText = repoFullName || 'Index job finished';
  let eventType = `code_index.${status}`;
  if (status === 'completed') {
    subject = 'Codebase index complete';
    bodyText = repoFullName ? `${repoFullName} is ready for retrieve` : 'Index completed successfully';
  } else if (status === 'failed') {
    subject = 'Codebase index failed';
    bodyText = (repoFullName ? `${repoFullName}: ` : '') + (err || 'Index failed — open Projects to inspect');
  } else if (status === 'cancelled') {
    const auto = /auto_stopped/i.test(err);
    subject = auto ? 'Codebase index auto-stopped' : 'Codebase index stopped';
    bodyText = (repoFullName ? `${repoFullName}: ` : '') + (err || 'Index cancelled');
    eventType = auto ? 'code_index.auto_stopped' : 'code_index.cancelled';
  }

  const url = projectId
    ? `https://inneranimalmedia.com/dashboard/projects/${encodeURIComponent(projectId)}`
    : 'https://inneranimalmedia.com/dashboard/projects';

  try {
    const { notifyUserInAppAndPush } =
      await import('../../identity/web-push-runtime.js');
    return await notifyUserInAppAndPush(
      env,
      {},
      {
        tenantId: job.tenant_id ?? null,
        userId,
        workspaceId: workspaceId || null,
        eventType,
        subject,
        bodyText: bodyText.slice(0, 280),
        entityType: 'agentsam_code_index_job',
        entityId: job.id != null ? String(job.id) : null,
        payloadJson: {
          url,
          // One tag per job so OS replaces prior stage notices instead of stacking.
          tag: `code-index-${job.id}`,
          job_id: job.id,
          outcome: status,
          repoFullName: repoFullName || null,
        },
      },
    );
  } catch (e) {
    console.warn('[code-indexer] push_notify_failed', e?.message || e);
    return { ok: false, reason: 'push_notify_failed' };
  }
}

export async function notifyCodeIndexJobTerminal(env, jobId, status, detail = null) {
  const id = jobId != null ? String(jobId).trim() : '';
  if (!id || !env?.DB) return;
  try {
    // project_id is a real column (IAM proj_*); tenant_id is not on this table.
    let selectErr = null;
    const job = await env.DB.prepare(
      `SELECT id, user_id, workspace_id, project_id, repo_full_name, last_error, status
         FROM agentsam_code_index_job WHERE id = ? LIMIT 1`,
    )
      .bind(id)
      .first()
      .catch((e) => {
        selectErr = e?.message || String(e);
        return null;
      });
    if (!job) {
      console.warn('[code-indexer] terminal_push_skip', {
        jobId: id,
        reason: selectErr ? 'job_select_failed' : 'job_not_found',
        error: selectErr,
      });
      return;
    }
    if (!job.user_id) {
      console.warn('[code-indexer] terminal_push_skip', { jobId: id, reason: 'no_user' });
      return;
    }
    // Resolve tenant for push hook scoping when present on workspace row.
    if (!job.tenant_id && job.workspace_id) {
      job.tenant_id = await resolveTenantIdForWorkspace(env, job.workspace_id);
    }
    // Deep-link fallback when older runs omitted project_id on INSERT.
    if (!job.project_id && job.workspace_id) {
      const proj = await env.DB.prepare(
        `SELECT id FROM workspace_projects WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 1`,
      )
        .bind(String(job.workspace_id))
        .first()
        .catch(() => null);
      if (proj?.id) job.project_id = String(proj.id);
    }
    const result = await notifyCodeIndexPush(env, job, status, detail);
    const lastError =
      typeof detail === 'string' && detail.trim()
        ? detail.trim()
        : detail?.error || detail?.last_error || detail?.message || job.last_error || null;
    console.warn('[code-indexer] terminal_push', {
      jobId: id,
      status,
      ok: result?.ok !== false,
      sent: result?.push?.sent ?? result?.sent ?? 0,
      last_error: lastError != null ? String(lastError).slice(0, 300) : null,
      reason: result?.push?.reason || result?.reason || null,
    });
  } catch (e) {
    console.warn('[code-indexer] terminal_push_failed', e?.message || e);
  }
}

export async function resolveTenantIdForWorkspace(env, workspaceId) {
  const ws = String(workspaceId || '').trim();
  if (!env?.DB || !ws) return null;
  try {
    const row = await env.DB.prepare(`SELECT tenant_id FROM workspaces WHERE id = ? LIMIT 1`)
      .bind(ws)
      .first();
    return row?.tenant_id != null ? String(row.tenant_id).trim() : null;
  } catch {
    return null;
  }
}

export function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text ?? '').length / 4));
}

export function chunkFileContent(content) {
  const text = String(content ?? '');
  if (!text.trim()) return [];
  if (text.length <= CHUNK_TARGET_CHARS) return [text];

  const lines = text.split('\n');
  const chunks = [];
  let buf = '';
  let bufLen = 0;

  const flush = () => {
    const slice = buf.trim();
    if (slice) chunks.push(slice);
    if (CHUNK_OVERLAP_CHARS > 0 && slice.length > CHUNK_OVERLAP_CHARS) {
      buf = slice.slice(-CHUNK_OVERLAP_CHARS);
      bufLen = buf.length;
    } else {
      buf = '';
      bufLen = 0;
    }
  };

  for (const line of lines) {
    const add = (buf ? '\n' : '') + line;
    if (bufLen + add.length > CHUNK_TARGET_CHARS && buf) {
      flush();
    }
    buf += (buf ? '\n' : '') + line;
    bufLen = buf.length;
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

export async function buildCodeVectorizeId(workspaceId, filePath, chunkIndex) {
  const ws = String(workspaceId || '').trim().replace(/^ws_/, 'ws');
  const pathHash = await contentHash16(filePath);
  const idx = String(Number(chunkIndex) || 0).padStart(4, '0');
  return `code::${ws}::${pathHash}::${idx}`;
}

export async function contentHash16(text) {
  const bytes = new TextEncoder().encode(String(text ?? ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

export function vectorLiteral(embedding) {
  return `[${embedding.join(',')}]`;
}

export async function mapPool(items, concurrency, fn) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, list.length));
  /** @type {R[]} */
  const out = new Array(list.length);
  let cursor = 0;
  async function worker() {
    while (cursor < list.length) {
      const idx = cursor;
      cursor += 1;
      out[idx] = await fn(list[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return out;
}

export async function deleteChunksForFile(env, workspaceUuid, filePath, opts = {}) {
  await resolveCodeIndexLaneConfig(env);
  const chunksTable = requireCodeIndexLaneConfig(env).tables.chunks;
  const r = await runCodeIndexPgQuery(
    env,
    `DELETE FROM agentsam.${chunksTable}
      WHERE workspace_id = $1::uuid AND file_path = $2`,
    [workspaceUuid, filePath],
    opts,
  );
  if (!r.ok) throw new Error(r.error || 'delete_chunks_failed');
}

function upsertChunkSql(chunksTable) {
  return `
    INSERT INTO agentsam.${chunksTable} (
      id, workspace_id, file_path, content, chunk_index, token_count, embedding, metadata, node_id,
      index_generation_id
    ) VALUES (
      $1::uuid, $2::uuid, $3, $4, $5, $6, $7::vector, $8::jsonb, $9, $10
    )
    ON CONFLICT (workspace_id, index_generation_id, file_path, chunk_index)
    DO UPDATE SET
      content = EXCLUDED.content,
      token_count = EXCLUDED.token_count,
      embedding = EXCLUDED.embedding,
      metadata = EXCLUDED.metadata,
      node_id = EXCLUDED.node_id`;
}

function chunkUpsertParams(row) {
  const generationId =
    row.index_generation_id != null && String(row.index_generation_id).trim()
      ? String(row.index_generation_id).trim()
      : row.metadata?.index_generation_id != null && String(row.metadata.index_generation_id).trim()
        ? String(row.metadata.index_generation_id).trim()
        : null;
  if (!generationId) {
    throw new Error(`chunk_upsert_generation_required:${row.file_path || '?'}`);
  }
  return [
    row.id,
    row.workspace_id,
    row.file_path,
    row.content,
    row.chunk_index,
    row.token_count,
    vectorLiteral(row.embedding),
    JSON.stringify(row.metadata || {}),
    row.node_id != null ? String(row.node_id) : null,
    generationId,
  ];
}

export async function upsertChunkRow(env, row) {
  await upsertChunkRowsBatch(env, [row]);
}

/**
 * One session-pooler client for many chunk upserts.
 * Pass `{ client }` from withCodeIndexPgClient to avoid connect-per-file churn.
 *
 * @param {any} env
 * @param {object[]} rows
 * @param {{ client?: any }} [opts]
 */
export async function upsertChunkRowsBatch(env, rows, opts = {}) {
  await resolveCodeIndexLaneConfig(env);
  const chunksTable = requireCodeIndexLaneConfig(env).tables.chunks;
  const sql = upsertChunkSql(chunksTable);
  const list = Array.isArray(rows) ? rows.filter((r) => r?.id && r?.embedding) : [];
  if (!list.length) return { ok: true, upserted: 0 };
  const session = await runCodeIndexPgTransaction(
    env,
    async (client) => {
      let upserted = 0;
      for (const row of list) {
        await client.query(sql, chunkUpsertParams(row));
        upserted += 1;
      }
      return { upserted, rows: [] };
    },
    opts,
  );
  if (!session.ok) throw new Error(session.error || 'chunk_upsert_batch_failed');
  return { ok: true, upserted: Number(session.result?.upserted) || list.length };
}

export function isVectorizeRateLimitError(err) {
  const msg = String(err?.message || err || '');
  const status = Number(err?.status ?? err?.statusCode ?? err?.code ?? 0);
  if (status === 429) return true;
  return /too many requests|rate.?limit|429/i.test(msg);
}

export function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Cloudflare Vectorize is not part of code index (law). Always no-op.
 * @param {any} _env
 * @param {{ id: string, embedding: number[], metadata?: Record<string, unknown> }} _item
 */
export async function upsertCodeVector(_env, _item) {
  return { ok: true, skipped: 'code_index_no_cf_vectorize' };
}

/**
 * @param {any} _env
 * @param {string[]} _ids
 */
export async function deleteCodeVectors(_env, _ids) {
  return { ok: true, attempted: 0, deleted: 0, soft_fails: 0, skipped: 'code_index_no_cf_vectorize' };
}

export async function updateVectorizeRegistry(_env, _patch = {}) {
  return { ok: true, skipped: 'code_index_no_cf_vectorize' };
}
