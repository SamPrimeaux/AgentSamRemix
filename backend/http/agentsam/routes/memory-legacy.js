/**
 * RAG API — OpenAI embeddings + Supabase (Hyperdrive/pgvector) + R2 (S3-compatible).
 * Live Agent Sam RAG is **1536** (`EMBEDDING_DIMS.balancedProductionRag` / `agentsam_*_oai3large_1536`).
 * Prefer `createAgentSamEmbedding` for production ingest/retrieve; `createEmbedding` is legacy-compat.
 */
import { AwsClient } from 'aws4fetch';
import { httpJsonResponse as jsonResponse } from '../../responses.js';
import { getAuthUser, fetchAuthUserTenantId } from '../../../../src/core/auth.js';
import { evaluateGuardrails } from '../../../../src/core/guardrails.js';
import {
  hyperdriveNativeQueryAvailable,
  isHyperdriveUsable,
  runHyperdriveQuery,
} from '../../../services/database/hyperdrive.js';
import {
  embeddingPolicy,
  resolveMultimodalEmbeddingRoute,
  EMBEDDING_DIMS,
} from '../../../../src/core/embedding-routes.js';
import { embedMultimodalContent } from '../../../../src/core/multimodal-embedding.js';
import {
  AGENTSAM_VECTOR_DIM,
  agentsamEmbeddingDims,
  agentsamEmbeddingModel,
  createAgentSamEmbedding,
  upsertAgentsamVectorizeMemory,
} from '../../../../src/core/agentsam-vectorize.js';
import { resolveAutoragBucketName } from '../../../../src/core/r2-storage-scope.js';

export { AGENTSAM_VECTOR_DIM, agentsamEmbeddingDims, agentsamEmbeddingModel, createAgentSamEmbedding };

export const RAG_CHUNK_MAX_CHARS = 600;
export const RAG_CHUNK_OVERLAP = 80;
export const RAG_EMBED_BATCH_SIZE = 32;
export const RAG_COMPACT_MAX_MSG_CHARS = 800;
export const RAG_COMPACT_HOURS = 48;

/**
 * Live Hyperdrive / agentsam RAG width — same as `EMBEDDING_DIMS.balancedProductionRag`.
 * Tables: agentsam_documents|codebase_*|memory_*_oai3large_1536 (text-embedding-3-large truncated to 1536).
 */
export const RAG_SUPABASE_VECTOR_DIM = EMBEDDING_DIMS.balancedProductionRag;

/** Fail-loud marker — public.documents / search_all_context / match_session_summaries / search_agent_memory are gone. */
export const LEGACY_PUBLIC_RAG_RETIRED =
  'legacy_public_rag_retired: use agentsam semantic retrieval (semantic-retrieval-dispatch / agentsam_*_oai3large_1536); do not call public.documents or public.search_* RPCs';

// ── small utilities (kept for callers / chunking) ─────────────────────────────

export function sanitizeUnifiedRagLike(q) {
  return String(q || '').slice(0, 120).replace(/[%_\[\]^]/g, ' ').trim();
}

export function unifiedRagContentHash(s) {
  const t = String(s || '').trim().replace(/\s+/g, ' ').slice(0, 600);
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return String(h);
}

export function unifiedRagRecency01(ts) {
  const now = Math.floor(Date.now() / 1000);
  let sec = 0;
  if (!ts) return 0.5;
  if (typeof ts === 'number') {
    sec = ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts);
  } else {
    const parsed = Date.parse(String(ts));
    if (Number.isNaN(parsed)) return 0.5;
    sec = Math.floor(parsed / 1000);
  }
  const ageDays = Math.max(0, (now - sec) / 86400);
  return Math.max(0, Math.min(1, 1 - Math.min(ageDays, 365) / 365));
}

export function unifiedRagCosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

function timingSafeEqualUtf8(a, b) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

async function hmacSha256HexFromUtf8Key(secretUtf8, messageUtf8) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secretUtf8),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(messageUtf8));
  return [...new Uint8Array(sig)].map((c) => c.toString(16).padStart(2, '0')).join('');
}

async function verifySupabaseWebhookSignature(secret, rawBody, sigHeader) {
  if (!secret || !sigHeader) return false;
  const trimmed = String(sigHeader).trim();
  const got = trimmed.replace(/^sha256=/i, '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(got)) return false;
  const expectedHex = (await hmacSha256HexFromUtf8Key(secret, rawBody)).toLowerCase();
  return timingSafeEqualUtf8(expectedHex, got);
}

function ragAgentId(env) {
  return String(env.RAG_AGENT_ID || '').trim();
}

function ragDocumentsProjectId(env) {
  return String(env.RAG_DOCUMENTS_PROJECT_ID || '').trim();
}

export function ragEmbeddingModel(env) {
  return String(env.RAG_OPENAI_EMBEDDING_MODEL || '').trim();
}

export function ragEmbeddingDims(env) {
  // Must match RAG_SUPABASE_VECTOR_DIM / Supabase vector(N) for Hyperdrive RAG; changing N requires a DB migration.
  const n = Number(env.RAG_EMBEDDING_DIMENSIONS || RAG_SUPABASE_VECTOR_DIM);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

/** @typedef {'text_default' | 'edge_bulk' | 'multimodal'} RagEmbedLane */

export const RAG_EMBED_LANE_TEXT_DEFAULT = 'text_default';
export const RAG_EMBED_LANE_EDGE_BULK = 'edge_bulk';
export const RAG_EMBED_LANE_MULTIMODAL = 'multimodal';

/**
 * Provider-aware embeddings with optional lane. Text width is **1536** (`RAG_SUPABASE_VECTOR_DIM`).
 *
 * - **text_default** / **edge_bulk** — OpenAI `text-embedding-3-large` @1536 (same as balancedProductionRag).
 * - **multimodal** — Gemini `gemini-embedding-2` @1536; separate index only.
 *
 * Prefer `createAgentSamEmbedding` for Agent Sam / Vectorize / agentsam.* lanes.
 * Do not use Workers AI `@cf/baai/bge-m3` here — wrong width for live agentsam tables.
 *
 * @param {any} env
 * @param {string} text
 * @param {RagEmbedLane} [lane='text_default']
 * @param {{ parts?: import('../../../../src/core/multimodal-embedding.js').MultimodalContentPart[] }} [options]
 * @returns {Promise<{ embedding: number[], provider: 'ollama' | 'openai' | 'workers_ai' | 'google', model?: string, dimensions?: number }>}
 */
export async function createEmbedding(env, text, lane = RAG_EMBED_LANE_TEXT_DEFAULT, options = {}) {
  const input = String(text ?? '');
  const laneNorm = String(lane || RAG_EMBED_LANE_TEXT_DEFAULT).trim();
  const dim = Number(env.RAG_EMBEDDING_DIMENSIONS || RAG_SUPABASE_VECTOR_DIM) || RAG_SUPABASE_VECTOR_DIM;
  const multimodalParts = Array.isArray(options?.parts) ? options.parts : null;
  const openaiModel =
    String(env.RAG_OPENAI_EMBEDDING_MODEL || '').trim() || 'text-embedding-3-large';

  async function embedTextDefault() {
    /** @type {string|null} */
    let openaiErr = null;

    if (env.OPENAI_API_KEY) {
      try {
        const base = String(env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/$/, '');
        const res = await fetch(`${base}/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: openaiModel,
            input: input,
            dimensions: dim,
          }),
        });
        const raw = await res.text();
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          openaiErr = `OpenAI embeddings: non-JSON (${res.status})`;
        }
        if (data && res.ok) {
          const emb = data?.data?.[0]?.embedding;
          if (Array.isArray(emb) && emb.length === dim) {
            return { embedding: emb, provider: 'openai', model: openaiModel, dimensions: dim };
          }
          openaiErr = openaiErr || `OpenAI embeddings: expected ${dim} dimensions, got ${emb?.length ?? 0}`;
        } else if (data) {
          openaiErr = data?.error?.message || `OpenAI embeddings HTTP ${res.status}`;
        } else if (!res.ok) {
          openaiErr = openaiErr || `OpenAI embeddings HTTP ${res.status}`;
        }
      } catch (e) {
        openaiErr = e?.message != null ? String(e.message) : String(e);
      }
    }

    if (!env.OPENAI_API_KEY) throw new Error('no_embedding_provider');
    throw new Error(openaiErr || 'no_embedding_provider');
  }

  if (laneNorm === RAG_EMBED_LANE_MULTIMODAL) {
    const route = resolveMultimodalEmbeddingRoute();
    const embedDim = Number(
      env.RAG_MULTIMODAL_EMBEDDING_DIMENSIONS || route.dimensions || EMBEDDING_DIMS.balancedProductionRag,
    );
    try {
      return await embedMultimodalContent(env, {
        text: input,
        parts: multimodalParts || undefined,
        dimensions: embedDim,
        modelKey: env.RAG_MULTIMODAL_EMBEDDING_MODEL || route.model,
      });
    } catch (e) {
      throw new Error(
        e?.message != null
          ? String(e.message)
          : `multimodal_embedding_failed (${embeddingPolicy.migrationRule})`,
      );
    }
  }

  // edge_bulk aliases text_default — bge-m3 is not a 1536 production lane.
  return embedTextDefault();
}

function resolveAutoragFolder(env, metadata) {
  const prefixes = String(env.RAG_AUTORAG_FOLDER_PREFIXES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const fallback = prefixes[0] || 'knowledge/';
  const folder = metadata && metadata.folder != null ? String(metadata.folder) : '';
  const normalized = folder.endsWith('/') ? folder : folder ? `${folder}/` : '';
  if (normalized && prefixes.includes(normalized)) return normalized;
  return fallback;
}

function safeObjectSuffix(source) {
  const s = String(source || 'doc')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 200);
  return s || 'doc';
}

function r2AwsClient(env) {
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  return new AwsClient({
    accessKeyId,
    secretAccessKey,
    service: 's3',
    region: 'auto',
  });
}

function parseListKeys(xml) {
  const keys = [];
  const re = /<Key>([^<]*)<\/Key>/g;
  let m;
  while ((m = re.exec(xml))) keys.push(m[1]);
  return keys;
}

function parseListTruncated(xml) {
  return /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
}

function parseNextContinuationToken(xml) {
  const m = xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/);
  return m ? m[1] : '';
}

async function r2ListAllObjectKeys(env) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const bucket = resolveAutoragBucketName(env);
  const client = r2AwsClient(env);
  if (!accountId || !bucket || !client) throw new Error('R2 list: missing account, bucket name, or credentials');
  const keys = [];
  let token = '';
  do {
    const q = new URLSearchParams({ 'list-type': '2' });
    if (token) q.set('continuation-token', token);
    const url = `https://${accountId}.r2.cloudflarestorage.com/${bucket}?${q}`;
    const res = await client.fetch(url);
    if (!res.ok) throw new Error(`R2 ListObjects failed: ${res.status}`);
    const xml = await res.text();
    keys.push(...parseListKeys(xml));
    const truncated = parseListTruncated(xml);
    token = truncated ? parseNextContinuationToken(xml) : '';
  } while (token);
  return keys;
}

function encodeS3ObjectKey(key) {
  return String(key)
    .split('/')
    .filter((seg) => seg.length > 0)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

async function r2GetObjectText(env, key) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const bucket = resolveAutoragBucketName(env);
  const client = r2AwsClient(env);
  if (!accountId || !bucket || !client) throw new Error('R2 get: missing account, bucket name, or credentials');
  const url = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${encodeS3ObjectKey(key)}`;
  const res = await client.fetch(url);
  if (!res.ok) throw new Error(`R2 GetObject failed: ${res.status}`);
  return await res.text();
}

async function r2PutObjectText(env, key, bodyText) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const bucket = resolveAutoragBucketName(env);
  const client = r2AwsClient(env);
  if (!accountId || !bucket || !client) throw new Error('R2 put: missing account, bucket name, or credentials');
  const url = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${encodeS3ObjectKey(key)}`;
  const res = await client.fetch(url, {
    method: 'PUT',
    body: bodyText,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
  if (!res.ok) throw new Error(`R2 PutObject failed: ${res.status}`);
}

function vectorLiteral(vec) {
  return `[${vec.join(',')}]`;
}

/**
 * Run SQL against Supabase Postgres via Hyperdrive.
 * Prefers native `env.HYPERDRIVE.query` when available (no TCP `pg` in Worker);
 * falls back to `pg` + `connectionString` for local or legacy configs.
 * @param {any} env
 * @param {(client: { query: (sql: string, params?: unknown[]) => Promise<{ rows?: unknown[] }> }) => Promise<unknown>} fn
 */
async function withPg(env, fn) {
  if (hyperdriveNativeQueryAvailable(env)) {
    const adapter = {
      /**
       * @param {string} sql
       * @param {unknown[]} [params]
       */
      query: async (sql, params = []) => {
        const result = await env.HYPERDRIVE.query(sql, params);
        return { rows: result?.rows ?? [], rowCount: result?.rows?.length ?? 0 };
      },
    };
    return await fn(adapter);
  }
  const cs = env.HYPERDRIVE?.connectionString;
  if (!cs) throw new Error('HYPERDRIVE not configured');
  const { Client } = await import('pg');
  const client = new Client({ connectionString: cs });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Hybrid keyword + vector search against Supabase `agent_memory` via Hyperdrive (pgvector RPC).
 * Uses `createAgentSamEmbedding` (@1536). Returns null on missing bindings or errors.
 *
 * @param {any} env
 * @param {string} query
 * @param {string|null|undefined} workspaceId
 * @param {{ matchLimit?: number, keywordWeight?: number, semanticWeight?: number }} [options]
 * @returns {Promise<Array<{ id: unknown, content: unknown, hybrid_score?: unknown, embedding_distance?: unknown, trigram_similarity?: unknown }>|null>}
 */
export async function searchAgentMemoryHybrid(env, query, workspaceId, options = {}) {
  void env;
  void query;
  void workspaceId;
  void options;
  console.error('[rag]', LEGACY_PUBLIC_RAG_RETIRED, { fn: 'searchAgentMemoryHybrid' });
  return null;
}

/**
 * Insert one observability row into `agentsam.agentsam_search_log` (Hyperdrive / pg).
 * Legacy `public.semantic_search_log` is retired — do not recreate it.
 *
 * @param {any} env
 * @param {{
 *   searchFn: string,
 *   tenantId?: string | null,
 *   workspaceId?: string | null,
 *   sessionId?: string | null,
 *   queryPreview?: string,
 *   matchThreshold: number,
 *   matchCountRequested: number,
 *   matchCountReturned: number,
 *   topSimilarity?: number | null,
 *   avgSimilarity?: number | null,
 *   sourcesHit?: string[],
 *   latencyMs?: number,
 *   metadata?: Record<string, unknown>,
 * }} args
 */
export async function logSemanticSearch(env, args) {
  const workspaceIdD1 =
    args.workspaceId != null && String(args.workspaceId).trim() !== ''
      ? String(args.workspaceId).trim()
      : args.metadata?.workspace_id != null
        ? String(args.metadata.workspace_id).trim()
        : '';
  if (!workspaceIdD1 || !isHyperdriveUsable(env)) return;

  let workspaceUuid = null;
  try {
    const { resolveSupabaseWorkspaceId } = await import('../../../agentsam/rag/index.js');
    workspaceUuid = await resolveSupabaseWorkspaceId(env, workspaceIdD1);
  } catch {
    workspaceUuid = null;
  }
  if (!workspaceUuid) return;

  const metaObj = {
    ...(args.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata)
      ? args.metadata
      : {}),
    search_fn: String(args.searchFn || 'unknown').slice(0, 200),
    tenant_id: args.tenantId != null ? String(args.tenantId).trim() : null,
    session_id:
      args.sessionId != null && String(args.sessionId).trim() !== ''
        ? String(args.sessionId).trim().slice(0, 500)
        : null,
    match_threshold: args.matchThreshold,
    match_count_requested: args.matchCountRequested,
    top_similarity: args.topSimilarity ?? null,
    avg_similarity: args.avgSimilarity ?? null,
    sources_hit: Array.isArray(args.sourcesHit) ? args.sourcesHit : [],
  };

  const sql = `INSERT INTO agentsam.agentsam_search_log (
      workspace_id, user_id, query_text, result_count, duration_ms, search_type, metadata
    ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb)`;

  try {
    const r = await runHyperdriveQuery(env, sql, [
      workspaceUuid,
      null,
      String(args.queryPreview ?? '').slice(0, 4000),
      Number(args.matchCountReturned) || 0,
      Math.max(0, Math.floor(args.latencyMs ?? 0)),
      String(args.searchFn || 'unified_search').slice(0, 120),
      JSON.stringify(metaObj),
    ]);
    if (!r.ok) {
      console.warn('[rag] agentsam_search_log insert:', r.error ?? 'query_failed');
    }
  } catch (e) {
    console.warn('[rag] agentsam_search_log insert:', e?.message ?? e);
  }
}

async function d1RagIngestLog(env, { source, status, chunks }) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO rag_ingest_log (object_key, status, chunk_count, triggered_by) VALUES (?,?,?,?)`
    )
      .bind(String(source || '').slice(0, 2000), status, Number(chunks) || 0, 'rag_ingest')
      .run();
  } catch (e) {
    console.warn('[rag] rag_ingest_log:', e?.message ?? e);
  }
}

function normalizeSearchRow(row, origin) {
  const similarity = Number(row.similarity ?? row.score ?? 0);
  const text =
    row.content ||
    row.summary ||
    row.body ||
    row.text ||
    '';
  const source = row.source || row.source_type || origin;
  return {
    id: row.id ?? row.session_id ?? null,
    content: text,
    source,
    title: row.title ?? null,
    similarity,
    _origin: origin,
  };
}

function mergeDedupeSort(rows) {
  const byHash = new Map();
  for (const r of rows) {
    const h = unifiedRagContentHash(r.content || JSON.stringify(r));
    const prev = byHash.get(h);
    if (!prev || r.similarity > prev.similarity) byHash.set(h, r);
  }
  return Array.from(byHash.values()).sort((a, b) => b.similarity - a.similarity);
}

/**
 * Retired — public.search_all_context / match_session_summaries no longer exist.
 * Callers must use semantic-retrieval-dispatch (agentsam.* @1536).
 */
export async function runUnifiedRagQuery(env, { query, tenantId, threshold, limit, includeSessions }) {
  void env;
  void query;
  void tenantId;
  void threshold;
  void limit;
  void includeSessions;
  return { results: [], error: LEGACY_PUBLIC_RAG_RETIRED };
}

/**
 * Legacy unified RAG — retired public.search_all_context. Not for normal Agent chat.
 * Returns `_error: legacy_public_rag_retired` (fail loud; no silent empty matches).
 */
export async function unifiedRagSearch(env, query, opts = {}) {
  void env;
  void opts;
  const q = String(query || '').trim();
  if (!q) {
    return { matches: [], results: [], count: 0, _error: 'empty query' };
  }
  console.warn('[rag] unifiedRagSearch blocked:', LEGACY_PUBLIC_RAG_RETIRED);
  return { matches: [], results: [], count: 0, _error: LEGACY_PUBLIC_RAG_RETIRED };
}

/**
 * Explicit legacy/admin compat only — logs legacy_unified_rag_used.
 */
export async function legacyUnifiedRagSearch(env, query, opts = {}) {
  console.warn(
    '[rag] legacy_unified_rag_used',
    JSON.stringify({
      path: opts?.caller ?? 'legacyUnifiedRagSearch',
      query_len: String(query || '').length,
    }),
  );
  return unifiedRagSearch(env, query, opts);
}

export function chunkMarkdown(text, maxChars = RAG_CHUNK_MAX_CHARS, overlap = RAG_CHUNK_OVERLAP) {
  const chunks = [];
  const sections = text.split(/(?=^##?\s)/m).map((s) => s.trim()).filter(Boolean);
  for (const section of sections) {
    if (section.length <= maxChars) {
      chunks.push(section);
      continue;
    }
    let start = 0;
    while (start < section.length) {
      const end = Math.min(start + maxChars, section.length);
      const slice = section.slice(start, end);
      if (slice.trim()) chunks.push(slice.trim());
      start = end - (end < section.length ? overlap : 0);
    }
  }
  return chunks.length ? chunks : [text.slice(0, maxChars)];
}

export async function compactAgentChatsToR2(env) {
  if (!env.DB || !env.R2) return { error: 'DB or R2 missing' };
  const cutoff = Math.floor(Date.now() / 1000) - RAG_COMPACT_HOURS * 3600;
  const out = await env.DB.prepare(`SELECT conversation_id, role, content FROM agent_messages WHERE created_at < ?`)
    .bind(cutoff)
    .all();
  const rows = out?.results || [];
  return { conversations_compacted: rows.length };
}

/**
 * POST /api/rag/ingest | /api/rag/search | /api/rag/sync | /api/search (POST)
 *
 * public.documents / search_all_context lane is retired. Reads → semantic-retrieval-dispatch;
 * writes → knowledge/ingest-segment.js (agentsam_documents_oai3large_1536).
 */
export async function handleRagApi(request, url, env, ctx) {
  void env;
  void ctx;
  const path = url.pathname.replace(/\/$/, '') || '/';
  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  if (
    (path === '/api/search' || path === '/api/rag/search' || path === '/api/rag/ingest' || path === '/api/rag/sync') &&
    method === 'POST'
  ) {
    return jsonResponse(
      {
        error: LEGACY_PUBLIC_RAG_RETIRED,
        search: 'use dispatchSemanticRetrieval (docs / client_project)',
        ingest: 'use knowledge ingestSegment → agentsam_documents_oai3large_1536 (not /api/rag/ingest)',
      },
      410,
    );
  }
  return jsonResponse({ error: 'Not found' }, 404);
}

/* handleRagIngest / handleRagSearchRoute / handleRagSync removed — /api/rag/* returns 410.
 * Docs write path: knowledge/ingest-segment.js → agentsam_documents_oai3large_1536
 * Docs/search path: backend/agentsam/rag/semantic-retrieval.js
 */


/**
 * Insert one curated row into `public.agent_memory` with an OpenAI embedding (same model/dims as RAG).
 * Requires HYPERDRIVE + `createAgentSamEmbedding` (@1536). Optional `RAG_OPENAI_EMBEDDING_MODEL` for OpenAI path label in DB.
 *
 * @param {any} env
 * @param {{
 *   content: string,
 *   session_id: string,
 *   role?: string,
 *   agent_id?: string,
 *   metadata?: Record<string, unknown>,
 *   workspace_id?: string | null,
 *   tenant_id?: string | null,
 *   user_id?: string | null,
 * }} params
 * @returns {Promise<{ id: string, embedding_dims: number, embed_model: string }>}
 */
export async function insertCuratedAgentMemory(env, params) {
  const content = String(params.content || '').trim();
  if (!content) throw new Error('content required');
  const session_id = String(params.session_id || '').trim();
  if (!session_id) throw new Error('session_id required');

  const roleRaw = String(params.role || 'assistant').toLowerCase();
  if (roleRaw !== 'user' && roleRaw !== 'assistant') {
    throw new Error('role must be user or assistant');
  }
  const agent_id = String(params.agent_id || 'agent-sam').trim() || 'agent-sam';
  const metadata =
    params.metadata && typeof params.metadata === 'object' && params.metadata !== null && !Array.isArray(params.metadata)
      ? params.metadata
      : {};

  const workspace_id =
    params.workspace_id != null && String(params.workspace_id).trim() !== ''
      ? String(params.workspace_id).trim()
      : null;
  const tenant_id =
    params.tenant_id != null && String(params.tenant_id).trim() !== '' ? String(params.tenant_id).trim() : null;
  const user_id =
    params.user_id != null && String(params.user_id).trim() !== '' ? String(params.user_id).trim() : null;

  const { embedding, model: embed_model } = await createAgentSamEmbedding(env, content);
  const dims = embedding.length;
  const expectedDims = await agentsamEmbeddingDims(env);
  if (dims !== expectedDims) {
    throw new Error(`embedding length ${dims} does not match index ${expectedDims}`);
  }

  const vecLit = vectorLiteral(embedding);

  return await withPg(env, async (client) => {
    const ins = await client.query(
      `INSERT INTO public.agent_memory (
        session_id, agent_id, role, content, metadata,
        embedding, workspace_id, embed_model, tenant_id, user_id
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::vector, $7, $8, $9, $10)
      RETURNING id`,
      [
        session_id,
        agent_id,
        roleRaw,
        content,
        metadata,
        vecLit,
        workspace_id,
        embed_model,
        tenant_id,
        user_id,
      ],
    );
    const id = ins.rows?.[0]?.id;
    if (!id) throw new Error('insert returned no id');

    const verify = await client.query(
      `SELECT vector_dims(embedding) AS dims FROM public.agent_memory WHERE id = $1::uuid`,
      [id],
    );
    const vd = verify.rows?.[0]?.dims;
    if (vd != null && Number(vd) !== expectedDims) {
      throw new Error(`vector_dims check failed: got ${vd}, expected ${expectedDims}`);
    }

    try {
      await upsertAgentsamVectorizeMemory(env, {
        id: String(id),
        embedding,
        metadata: {
          session_id,
          workspace_id,
          tenant_id,
          user_id,
          role: roleRaw,
        },
      });
    } catch (e) {
      console.warn('[rag] AGENTSAMVECTORIZE upsert:', e?.message ?? e);
    }

    return {
      id: String(id),
      embedding_dims: dims,
      embed_model,
    };
  });
}

/**
 * Semantic-only search on `public.agent_memory` (cosine distance via pgvector).
 * Unlike `search_agent_memory`, this does **not** require trigram `%` on query text,
 * so paraphrased questions still match.
 *
 * @param {any} env
 * @param {{
 *   query: string,
 *   workspace_id: string,
 *   tenant_id: string | null,
 *   user_id?: string | null,
 *   session_id?: string | null,
 *   limit?: number,
 * }} opts
 * @returns {Promise<{ embed_model: string, results: Array<Record<string, unknown>> }>}
 */
export async function searchCuratedAgentMemory(env, opts) {
  const query = String(opts.query || '').trim();
  if (!query) throw new Error('query required');
  const workspace_id = String(opts.workspace_id || '').trim();
  if (!workspace_id) throw new Error('workspace_id required');

  const tenant_id =
    opts.tenant_id != null && String(opts.tenant_id).trim() !== '' ? String(opts.tenant_id).trim() : null;
  const user_id =
    opts.user_id != null && String(opts.user_id).trim() !== '' ? String(opts.user_id).trim() : null;
  const session_id =
    opts.session_id != null && String(opts.session_id).trim() !== '' ? String(opts.session_id).trim() : null;

  let limit = Number(opts.limit);
  if (!Number.isFinite(limit) || limit < 1) limit = 10;
  if (limit > 50) limit = 50;

  const { embedding, model: embed_model } = await createAgentSamEmbedding(env, query);
  const dim = embedding.length;
  const expectedDims = await agentsamEmbeddingDims(env);
  if (dim !== expectedDims) {
    throw new Error(`embedding must be ${expectedDims} dimensions, got ${dim}`);
  }
  const vecLit = vectorLiteral(embedding);

  return await withPg(env, async (client) => {
    const sql = `
      SELECT
        am.id,
        am.session_id,
        am.agent_id,
        am.role,
        am.content,
        am.metadata,
        am.created_at,
        am.tenant_id,
        am.workspace_id,
        am.user_id,
        (am.embedding <=> $1::vector(${dim}))::double precision AS embedding_distance
      FROM public.agent_memory am
      WHERE am.embedding IS NOT NULL
        AND am.workspace_id = $2
        AND ($3::text IS NULL OR am.tenant_id = $3)
        AND ($4::text IS NULL OR am.user_id = $4 OR am.user_id IS NULL)
        AND ($5::text IS NULL OR am.session_id = $5)
      ORDER BY am.embedding <=> $1::vector(${dim})
      LIMIT $6`;
    const { rows } = await client.query(sql, [vecLit, workspace_id, tenant_id, user_id, session_id, limit]);

    const results = (rows || []).map((r) => {
      const d = r.embedding_distance != null ? Number(r.embedding_distance) : NaN;
      const similarity = Number.isFinite(d) ? Math.max(0, Math.min(1, 1 - d)) : null;
      return {
        id: r.id,
        session_id: r.session_id,
        agent_id: r.agent_id,
        role: r.role,
        content: r.content,
        metadata: r.metadata,
        created_at: r.created_at,
        tenant_id: r.tenant_id,
        workspace_id: r.workspace_id,
        user_id: r.user_id,
        embedding_distance: r.embedding_distance,
        similarity,
      };
    });

    return { embed_model, results };
  });
}

/**
 * POST /api/agent/memory/sync — Supabase webhook: embed new/updated rows.
 */
export async function handleAgentMemorySync(request, env) {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  const rawBody = await request.text();
  const sig =
    request.headers.get('x-supabase-signature') || request.headers.get('X-Supabase-Signature') || '';
  const secret = env.SUPABASE_WEBHOOK_SECRET;
  if (!secret || !(await verifySupabaseWebhookSignature(secret, rawBody, sig))) {
    return jsonResponse({ error: 'Invalid webhook signature' }, 401);
  }

  let body;
  try {
    body = JSON.parse(rawBody || '{}');
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const record = body.record || body;
  const id = record.id;
  const content = String(record.content || '').trim();
  if (!id || !content) {
    return jsonResponse({ error: 'record.id and record.content required' }, 400);
  }

  const emb = record.embedding;
  const needsEmbedding =
    emb == null || (Array.isArray(emb) && emb.length === 0) || (typeof emb === 'string' && !emb.trim());

  if (!needsEmbedding) {
    await d1RagIngestLog(env, { source: `agent_memory:${id}`, status: 'skipped_has_embedding', chunks: 0 });
    return jsonResponse({ ok: true });
  }

  try {
    const { embedding } = await createAgentSamEmbedding(env, content);
    const vecLit = vectorLiteral(embedding);
    await withPg(env, async (client) => {
      await client.query(`UPDATE public.agent_memory SET embedding = $1::vector WHERE id = $2::uuid`, [
        vecLit,
        id,
      ]);
    });
    try {
      await upsertAgentsamVectorizeMemory(env, {
        id: String(id),
        embedding,
        metadata: { session_id: record.session_id, workspace_id: record.workspace_id },
      });
    } catch (e) {
      console.warn('[rag] AGENTSAMVECTORIZE sync upsert:', e?.message ?? e);
    }
    await d1RagIngestLog(env, { source: `agent_memory:${id}`, status: 'success', chunks: 1 });
    return jsonResponse({ ok: true });
  } catch (e) {
    await d1RagIngestLog(env, {
      source: `agent_memory:${id}`,
      status: `error:${String(e?.message || e).slice(0, 80)}`,
      chunks: 0,
    });
    return jsonResponse({ error: e?.message || 'sync failed' }, 500);
  }
}
