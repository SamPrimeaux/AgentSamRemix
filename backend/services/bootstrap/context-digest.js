/**
 * Canonical agentsam_context_digest read/write — workspace compaction ledger.
 * source_updated_at_unix: when upstream material changed (unix seconds).
 * expires_at_unix: bounded TTL for time-sensitive digest types.
 *
 * Write modes:
 *   upsertContextDigest      — structural / idempotent (schema, session hook seed, project)
 *   insertContextDigestEvent — append-only per compaction (conversation, handoff)
 */
import { sha256Hex } from './hash.js';

const DIGEST_TYPES = [
  'schema',
  'repo',
  'docs',
  'memory',
  'tool_registry',
  'route_map',
  'session',
  'deployment',
  'rag',
  'conversation',
  'handoff',
  'project',
];

/** Digest types that get a new D1 row per compaction event (never ON CONFLICT rewrite). */
export const APPEND_DIGEST_TYPES = new Set(['conversation', 'handoff']);

/** Default TTL seconds per digest_type (null = no expiry). */
const DIGEST_TTL_SEC = Object.freeze({
  session: 14 * 86400,
  conversation: 14 * 86400,
  handoff: 7 * 86400,
  project: 30 * 86400,
  deployment: 30 * 86400,
});

const MAX_DIGEST_TEXT_BYTES = 12_000;
const MAX_DIGEST_TOKENS = 3_000;

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function boundDigestText(value) {
  const text = trim(value);
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= MAX_DIGEST_TEXT_BYTES) return text;
  return new TextDecoder().decode(bytes.slice(0, MAX_DIGEST_TEXT_BYTES)).trim();
}

function defaultExpiresAtUnix(digestType, nowUnix) {
  const ttl = DIGEST_TTL_SEC[trim(digestType)];
  if (!ttl || ttl <= 0) return null;
  return nowUnix + ttl;
}

/**
 * @param {unknown} env
 * @param {string} workspaceId
 * @param {string[]} [types]
 */
export async function loadWorkspaceDigestManifest(env, workspaceId, types = DIGEST_TYPES) {
  const wid = trim(workspaceId);
  if (!env?.DB || !wid) return [];

  const want = (types || DIGEST_TYPES).map((t) => trim(t)).filter(Boolean);
  if (!want.length) return [];

  try {
    const ph = want.map(() => '?').join(', ');
    const { results } = await env.DB.prepare(
      `SELECT d.id, d.workspace_id, d.digest_type, d.source_hash, d.digest_hash,
              d.raw_size_bytes, d.reduced_size_bytes, d.token_count,
              d.source_updated_at_unix, d.updated_at_unix, d.expires_at_unix,
              d.generation_model, d.session_id, d.project_id
         FROM agentsam_context_digest d
        INNER JOIN (
          SELECT digest_type, MAX(COALESCE(source_updated_at_unix, updated_at_unix, 0)) AS max_ts
            FROM agentsam_context_digest
           WHERE workspace_id = ?
             AND digest_type IN (${ph})
             AND (expires_at_unix IS NULL OR expires_at_unix > unixepoch())
           GROUP BY digest_type
        ) latest ON latest.digest_type = d.digest_type
                AND COALESCE(d.source_updated_at_unix, d.updated_at_unix, 0) = latest.max_ts
        WHERE d.workspace_id = ?
          AND d.digest_type IN (${ph})
          AND (d.expires_at_unix IS NULL OR d.expires_at_unix > unixepoch())
        ORDER BY d.digest_type ASC`,
    )
      .bind(wid, ...want, wid, ...want)
      .all();

    return (results || []).map((row) => ({
      id: trim(row.id),
      workspace_id: trim(row.workspace_id),
      digest_type: trim(row.digest_type),
      source_hash: trim(row.source_hash),
      digest_hash: trim(row.digest_hash),
      raw_size_bytes: Number(row.raw_size_bytes) || 0,
      reduced_size_bytes: Number(row.reduced_size_bytes) || 0,
      token_count: Number(row.token_count) || 0,
      source_updated_at_unix: Number(row.source_updated_at_unix) || 0,
      updated_at_unix: Number(row.updated_at_unix) || 0,
      expires_at_unix:
        row.expires_at_unix != null && Number(row.expires_at_unix) > 0
          ? Number(row.expires_at_unix)
          : null,
      generation_model: row.generation_model != null ? String(row.generation_model) : null,
      session_id: row.session_id != null ? String(row.session_id) : null,
      project_id: row.project_id != null ? String(row.project_id) : null,
    }));
  } catch (error) {
    console.warn('[context-digest] manifest read failed', error?.message ?? error);
    throw error;
  }
}

/**
 * Stable manifest slice for bootstrap context_hash.
 * @param {Awaited<ReturnType<typeof loadWorkspaceDigestManifest>>} manifest
 */
export function normalizeDigestManifestForHash(manifest = []) {
  return [...manifest]
    .map((d) => ({
      digest_type: d.digest_type,
      digest_hash: d.digest_hash,
      source_hash: d.source_hash,
      source_updated_at_unix: d.source_updated_at_unix,
      expires_at_unix: d.expires_at_unix ?? null,
    }))
    .filter((d) => d.digest_type && d.digest_hash)
    .sort((a, b) => a.digest_type.localeCompare(b.digest_type));
}

/**
 * @param {string} workspaceId
 * @param {string} digestType
 * @param {string} sourceMaterial
 * @param {{ sessionId?: string|null, eventKey?: string|number|null }} [opts]
 */
export async function computeContextDigestIdentity(workspaceId, digestType, sourceMaterial, opts = {}) {
  const ws = trim(workspaceId);
  const type = trim(digestType);
  const sourceHash = await sha256Hex(String(sourceMaterial ?? ''));
  const sessionPart = opts.sessionId != null ? trim(opts.sessionId) : '';
  const eventPart =
    opts.eventKey != null && String(opts.eventKey).trim() !== ''
      ? String(opts.eventKey).trim()
      : '';
  const digestHash = APPEND_DIGEST_TYPES.has(type)
    ? await sha256Hex(`${ws}:${type}:${sessionPart}:${sourceHash}:${eventPart || Math.floor(Date.now() / 1000)}`)
    : await sha256Hex(`${ws}:${type}:${sourceHash}`);
  return {
    sourceHash,
    digestHash,
    id: `cd_${digestHash.slice(0, 16)}`,
  };
}

/**
 * @param {unknown} env
 * @param {string} digestHash
 */
export async function contextDigestExistsByHash(env, digestHash) {
  const hash = trim(digestHash);
  if (!env?.DB || !hash) return false;
  try {
    const row = await env.DB.prepare(
      `SELECT 1 AS ok FROM agentsam_context_digest WHERE digest_hash = ? LIMIT 1`,
    )
      .bind(hash)
      .first();
    return Boolean(row?.ok);
  } catch (error) {
    console.warn('[context-digest] hash existence read failed', error?.message ?? error);
    throw error;
  }
}

/**
 * context_load and similar hooks: skip D1 rewrite when content hash already exists.
 * @param {{ refreshContext?: boolean, digestExists?: boolean }} p
 */
export function shouldWriteContextLoadDigest(p = {}) {
  if (p.refreshContext === true) return true;
  if (p.digestExists === true) return false;
  return true;
}

function buildDigestRow(fields, { id, digestHash, sourceHash, nowUnix }) {
  const workspaceId = trim(fields.workspaceId);
  const digestType = trim(fields.digestType);
  const digestText = boundDigestText(fields.digestText);
  const sourceUpdatedAt =
    Number(fields.sourceUpdatedAtUnix) > 0
      ? Math.floor(Number(fields.sourceUpdatedAtUnix))
      : nowUnix;
  const defaultExpiry = defaultExpiresAtUnix(digestType, nowUnix);
  const requestedExpiry = Number(fields.expiresAtUnix) > 0
    ? Math.floor(Number(fields.expiresAtUnix))
    : 0;
  const expiresAt = defaultExpiry
    ? Math.min(requestedExpiry || defaultExpiry, defaultExpiry)
    : requestedExpiry || null;
  const sourceMaterial =
    fields.sourceMaterial != null ? String(fields.sourceMaterial) : digestText;
  const rawSize =
    Number(fields.rawSizeBytes) > 0
      ? Math.floor(Number(fields.rawSizeBytes))
      : new TextEncoder().encode(sourceMaterial).length;
  const reducedSize =
    Number(fields.reducedSizeBytes) > 0
      ? Math.floor(Number(fields.reducedSizeBytes))
      : new TextEncoder().encode(digestText).length;
  const tokenCount = Math.min(
    MAX_DIGEST_TOKENS,
    Number(fields.tokenCount) > 0
      ? Math.floor(Number(fields.tokenCount))
      : Math.ceil(reducedSize / 4),
  );

  const row = {
    id,
    workspace_id: workspaceId,
    digest_type: digestType,
    source_hash: sourceHash,
    digest_hash: digestHash,
    digest_text: digestText,
    raw_size_bytes: rawSize,
    reduced_size_bytes: reducedSize,
    token_count: tokenCount,
    // Summary generator; the vectorizer is recorded separately below.
    generation_model: fields.generationModel != null ? String(fields.generationModel) : null,
    // Embedding lane model and vector width.
    embedding_model:
      fields.embeddingModel != null ? String(fields.embeddingModel) : null,
    embedding_dimensions:
      Number(fields.embeddingDimensions) > 0
        ? Math.floor(Number(fields.embeddingDimensions))
        : null,
    compaction_event_id:
      fields.compactionEventId != null ? trim(fields.compactionEventId) || null : null,
    namespace: fields.namespace != null ? String(fields.namespace) : workspaceId,
    source_updated_at_unix: sourceUpdatedAt,
    updated_at_unix: nowUnix,
    expires_at_unix: expiresAt,
    session_id: fields.sessionId != null ? trim(fields.sessionId) || null : null,
    project_id: fields.projectId != null ? trim(fields.projectId) || null : null,
    next_session_id: fields.nextSessionId != null ? trim(fields.nextSessionId) || null : null,
    parent_run_id: fields.parentRunId != null ? trim(fields.parentRunId) || null : null,
    escalation_id: fields.escalationId != null ? trim(fields.escalationId) || null : null,
  };

  const insertCols = Object.keys(row);
  return { row, insertCols, binds: insertCols.map((c) => row[c]), sourceUpdatedAt, expiresAt };
}

/**
 * Append-only digest row — one row per compaction event (conversation / handoff).
 * @param {unknown} env
 * @param {Parameters<typeof upsertContextDigest>[1]} fields
 */
export async function insertContextDigestEvent(env, fields) {
  if (!env?.DB) return null;

  const workspaceId = trim(fields.workspaceId);
  const digestType = trim(fields.digestType);
  const digestText = trim(fields.digestText);
  if (!workspaceId || !digestType || !digestText) return null;
  if (!DIGEST_TYPES.includes(digestType)) return null;
  if (!APPEND_DIGEST_TYPES.has(digestType)) {
    return upsertContextDigest(env, fields);
  }

  const nowUnix = Math.floor(Date.now() / 1000);
  const sourceMaterial =
    fields.sourceMaterial != null ? String(fields.sourceMaterial) : digestText;
  const sourceHash = fields.sourceHash || (await sha256Hex(sourceMaterial));
  const eventKey =
    fields.compactionEventId ||
    fields.sourceUpdatedAtUnix ||
    nowUnix;
  const { digestHash } = await computeContextDigestIdentity(
    workspaceId,
    digestType,
    sourceMaterial,
    { sessionId: fields.sessionId, eventKey },
  );
  const id =
    fields.id != null && trim(fields.id)
      ? trim(fields.id)
      : `cd_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

  const { insertCols, binds, sourceUpdatedAt, expiresAt } = buildDigestRow(fields, {
    id,
    digestHash,
    sourceHash,
    nowUnix,
  });
  if (!insertCols.length) return null;

  await env.DB.prepare(
    `INSERT INTO agentsam_context_digest (${insertCols.join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`,
  )
    .bind(...binds)
    .run();

  return {
    id,
    digest_hash: digestHash,
    source_hash: sourceHash,
    source_updated_at_unix: sourceUpdatedAt,
    expires_at_unix: expiresAt,
  };
}

/**
 * Idempotent upsert for structural digest types (schema, session seed, project, …).
 * @param {unknown} env
 * @param {{
 *   workspaceId: string,
 *   digestType: string,
 *   digestText: string,
 *   sourceMaterial?: string,
 *   sourceHash?: string,
 *   sessionId?: string|null,
 *   projectId?: string|null,
 *   nextSessionId?: string|null,
 *   parentRunId?: string|null,
 *   generationModel?: string|null,
 *   embeddingModel?: string|null,
 *   embeddingDimensions?: number|null,
 *   compactionEventId?: string|null,
 *   namespace?: string|null,
 *   rawSizeBytes?: number,
 *   reducedSizeBytes?: number,
 *   tokenCount?: number,
 *   sourceUpdatedAtUnix?: number,
 *   expiresAtUnix?: number|null,
 *   escalationId?: string|null,
 * }} fields
 */
export async function upsertContextDigest(env, fields) {
  if (!env?.DB) return null;

  const workspaceId = trim(fields.workspaceId);
  const digestType = trim(fields.digestType);
  const digestText = trim(fields.digestText);
  if (!workspaceId || !digestType || !digestText) return null;
  if (!DIGEST_TYPES.includes(digestType)) return null;

  if (APPEND_DIGEST_TYPES.has(digestType)) {
    return insertContextDigestEvent(env, fields);
  }

  const nowUnix = Math.floor(Date.now() / 1000);
  const sourceMaterial =
    fields.sourceMaterial != null ? String(fields.sourceMaterial) : digestText;
  const sourceHash = fields.sourceHash || (await sha256Hex(sourceMaterial));
  const { digestHash } = await computeContextDigestIdentity(workspaceId, digestType, sourceMaterial);
  const id = `cd_${digestHash.slice(0, 16)}`;

  const { insertCols, binds, sourceUpdatedAt, expiresAt } = buildDigestRow(fields, {
    id,
    digestHash,
    sourceHash,
    nowUnix,
  });
  if (!insertCols.length) return null;

  const updates = insertCols
    .filter((c) => !['id', 'digest_hash'].includes(c))
    .map((c) => `${c} = excluded.${c}`);

  const sql = `INSERT INTO agentsam_context_digest (${insertCols.join(', ')})
       VALUES (${insertCols.map(() => '?').join(', ')})
       ON CONFLICT(digest_hash) DO UPDATE SET ${updates.join(', ')}`;

  const write = env.DB.prepare(sql).bind(...binds);
  if (typeof env.DB.batch === 'function') {
    const prior = env.DB.prepare(
      `DELETE FROM agentsam_context_digest
        WHERE workspace_id = ?
          AND digest_type = ?
          AND digest_hash != ?`,
    ).bind(workspaceId, digestType, digestHash);
    await env.DB.batch([prior, write]);
  } else {
    await env.DB.prepare(
      `DELETE FROM agentsam_context_digest
        WHERE workspace_id = ?
          AND digest_type = ?
          AND digest_hash != ?`,
    )
      .bind(workspaceId, digestType, digestHash)
      .run();
    await write.run();
  }

  return {
    id,
    digest_hash: digestHash,
    source_updated_at_unix: sourceUpdatedAt,
    expires_at_unix: expiresAt,
  };
}

export { DIGEST_TYPES, DIGEST_TTL_SEC };
