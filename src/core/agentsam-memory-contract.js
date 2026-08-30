/**
 * Canonical Agent Sam memory contract — draft, hash, keys, secrets, types.
 * D1 agentsam_memory is SSOT; projections are rebuildable via outbox.
 */
export const MEMORY_COMMIT_TYPES = Object.freeze([
  'fact',
  'preference',
  'decision',
  'policy',
  'state',
  'procedure',
  'event',
  'error',
]);

/** Legacy values preserved in DB; new commits normalize away from these. */
export const MEMORY_LEGACY_TYPES = Object.freeze(['project', 'skill']);

/** Postgres `agentsam.agentsam_memory` + managed_pg mirror — must match D1 commit CHECK (947). */
export const MANAGED_MEMORY_TYPES = Object.freeze([
  ...MEMORY_COMMIT_TYPES,
  ...MEMORY_LEGACY_TYPES,
]);

export const MEMORY_SENSITIVITIES = Object.freeze([
  'normal',
  'internal',
  'confidential',
  'secret',
]);

/** Rebuildable projections for new commits — semantic SSOT is pgvector (Hyperdrive), not Vectorize. */
export const DESIRED_PROJECTIONS = Object.freeze(['managed_pg', 'pgvector_chunk']);

const SECRET_PATTERNS = [
  /\bsk-[a-zA-Z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/i,
  /\bCLOUDFLARE_API_TOKEN\s*[=:]\s*\S+/i,
  /\bapi[_-]?key\s*[=:]\s*['\"]?[A-Za-z0-9_-]{20,}/i,
  /\bpassword\s*[=:]\s*\S+/i,
  /\bcookie\s*[=:]\s*\S+/i,
];

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {string} type
 * @returns {string}
 */
export function normalizeMemoryCommitType(type) {
  const t = trim(type).toLowerCase();
  if (t === 'skill') return 'procedure';
  if (t === 'project') return 'fact'; // project is scope/entity/tag, not a type
  if (MEMORY_COMMIT_TYPES.includes(t)) return t;
  return 'fact';
}

/**
 * @param {unknown} tags
 * @returns {string[]}
 */
export function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return [...new Set(tags.map((t) => trim(t)).filter(Boolean))].slice(0, 32);
  }
  if (typeof tags === 'string' && tags.trim()) {
    try {
      const parsed = JSON.parse(tags);
      if (Array.isArray(parsed)) return normalizeTags(parsed);
    } catch {
      return tags
        .split(',')
        .map((t) => trim(t))
        .filter(Boolean)
        .slice(0, 32);
    }
  }
  return [];
}

/**
 * Stable semantic slot — never title alone.
 * @param {{ memory_type?: string, memory_key?: string, title?: string, content?: string, tags?: string[] }} input
 */
export function proposeMemoryKey(input = {}) {
  const existing = trim(input.memory_key || input.key);
  if (existing) {
    return existing
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9:_-]+/g, '')
      .replace(/_+/g, '_')
      .slice(0, 160);
  }
  const type = normalizeMemoryCommitType(input.memory_type);
  const tags = normalizeTags(input.tags);
  const domain =
    tags.find((t) => /^[a-z][a-z0-9_-]{1,40}$/i.test(t) && !['mcp', 'chat', 'auto'].includes(t)) ||
    'general';
  const base = trim(input.title) || trim(input.content).slice(0, 48) || 'note';
  const slot = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return `${type}:${domain}:${slot || 'note'}`;
}

/**
 * @param {string} text
 */
export function detectSecrets(text) {
  const s = String(text || '');
  const hits = [];
  for (const re of SECRET_PATTERNS) {
    if (re.test(s)) hits.push(re.source.slice(0, 40));
  }
  return hits;
}

/**
 * @param {string} text
 */
export function approxTokenCount(text) {
  return Math.ceil(String(text || '').length / 4);
}

/**
 * Clean retrieval representation for embedding — never raw value_json / secrets.
 * @param {{ title?: string, memory_type?: string, scope_type?: string, scope_id?: string, summary?: string, content?: string, tags?: string[] }} row
 */
export function buildRetrievalText(row = {}) {
  const tags = normalizeTags(row.tags);
  const lines = [
    `Title: ${trim(row.title) || trim(row.memory_key) || 'memory'}`,
    `Type: ${trim(row.memory_type) || 'fact'}`,
    `Scope: ${trim(row.scope_type) || 'user'}:${trim(row.scope_id) || ''}`,
    `Summary: ${trim(row.summary) || trim(row.content)}`,
  ];
  if (tags.length) lines.push(`Tags: ${tags.join(', ')}`);
  return lines.join('\n').trim();
}

/**
 * @param {string} text
 */
export async function sha256Hex(text) {
  const data = new TextEncoder().encode(String(text ?? ''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Deterministic projection key.
 * @param {{ memory_id: string, revision: number, chunk_index?: number, embedding_version?: string }} p
 */
export function buildProjectionKey(p) {
  const chunk = Number.isFinite(Number(p.chunk_index)) ? Number(p.chunk_index) : 0;
  const ver = trim(p.embedding_version);
  if (!ver) throw new Error('memory_embedding_version_required');
  return `memory:${trim(p.memory_id)}:revision:${Number(p.revision) || 1}:chunk:${chunk}:embed:${ver}`;
}

/**
 * UUIDv5-ish deterministic UUID from projection_key (namespace DNS + SHA-1 truncated).
 * Workers crypto has no UUID v5; use SHA-256 hex formatted as UUID.
 * @param {string} projectionKey
 */
export async function uuidFromProjectionKey(projectionKey) {
  const hex = await sha256Hex(`iam.memory.projection:${projectionKey}`);
  const h = hex.slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0')}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/**
 * Draft + validate. Does not write.
 * @param {Record<string, unknown>} args
 * @param {{ tenant_id: string, user_id: string, workspace_id?: string|null, authorized_workspaces?: string[] }} auth
 */
export async function draftMemoryCommit(args = {}, auth = {}) {
  const errors = [];
  const warnings = [];
  const tenantId = trim(auth.tenant_id);
  const userId = trim(auth.user_id);
  const workspaceId = trim(auth.workspace_id) || null;
  if (!tenantId || !userId) errors.push('auth_tenant_user_required');

  // Never trust agent-supplied user_id/tenant_id
  if (trim(args.user_id) && trim(args.user_id) !== userId) {
    errors.push('agent_supplied_user_id_rejected');
  }
  if (trim(args.tenant_id) && trim(args.tenant_id) !== tenantId) {
    errors.push('agent_supplied_tenant_id_rejected');
  }

  const requestedWs = trim(args.workspace_id);
  let effectiveWorkspace = workspaceId;
  if (requestedWs && requestedWs !== workspaceId) {
    if (!auth.authorized_workspaces?.includes?.(requestedWs)) {
      errors.push('workspace_not_authorized');
    } else {
      effectiveWorkspace = requestedWs;
    }
  }

  const rawText = trim(args.raw_text);
  const content =
    trim(args.content) ||
    rawText ||
    trim(args.value) ||
    trim(args.prompt) ||
    trim(args.text) ||
    trim(args.message);
  const summary = trim(args.summary) || content.slice(0, 280);
  const title = trim(args.title) || content.slice(0, 80);
  const memoryType = normalizeMemoryCommitType(args.memory_type);
  let tags = normalizeTags(args.tags);
  if (trim(args.memory_type).toLowerCase() === 'project' && !tags.includes('project')) {
    tags = [...tags, 'project'];
    warnings.push('project_mapped_to_fact_with_project_tag');
  }
  if (trim(args.memory_type).toLowerCase() === 'skill' && !tags.includes('procedure')) {
    tags = [...tags, 'procedure'];
    warnings.push('skill_aliased_to_procedure');
  }

  if (!content || content.length < 12) errors.push('content_too_short');
  if (content && !/[.!?:]/.test(content) && content.split(/\s+/).length < 6) {
    warnings.push('content_may_not_be_self_contained');
  }

  const secretHits = detectSecrets(`${title}\n${summary}\n${content}\n${JSON.stringify(args.value_json || {})}`);
  if (secretHits.length) errors.push('secret_content_rejected');

  const sensitivity = MEMORY_SENSITIVITIES.includes(trim(args.sensitivity))
    ? trim(args.sensitivity)
    : 'normal';
  if (sensitivity === 'secret') errors.push('secret_sensitivity_not_embeddable');

  const importance = Math.min(10, Math.max(1, Number(args.importance) || 5));
  const isPinned = args.is_pinned === true || args.is_pinned === 1;
  // Do NOT auto-pin importance >= 8

  const memoryKey = proposeMemoryKey({
    memory_type: memoryType,
    memory_key: args.memory_key || args.key,
    title,
    content,
    tags,
  });

  const longPolicy = ['extract', 'document', 'chunk'].includes(trim(args.long_content_policy))
    ? trim(args.long_content_policy)
    : 'extract';
  const tokens = approxTokenCount(content);
  let route = 'single_vector';
  if (tokens > 600) {
    if (longPolicy === 'document') route = 'document_lane_pointer';
    else if (longPolicy === 'chunk') route = 'chunked_memory';
    else route = 'extract_atomic';
    warnings.push(`long_content_${route}`);
  }

  const scopeType = trim(args.scope_type) || 'user';
  const scopeId = trim(args.scope_id) || userId;
  const retrievalText = buildRetrievalText({
    title,
    memory_type: memoryType,
    scope_type: scopeType,
    scope_id: scopeId,
    summary,
    content,
    tags,
    memory_key: memoryKey,
  });
  const contentHash = await sha256Hex(
    `${memoryType}|${memoryKey}|${title}|${summary}|${content}|${tags.join(',')}|${sensitivity}`,
  );
  const idempotencyKey =
    trim(args.idempotency_key) || `idem:${tenantId}:${userId}:${memoryKey}:${contentHash.slice(0, 16)}`;

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    draft: {
      tenant_id: tenantId,
      user_id: userId,
      workspace_id: effectiveWorkspace,
      scope_type: scopeType,
      scope_id: scopeId,
      memory_type: memoryType,
      memory_key: memoryKey,
      title,
      summary,
      content,
      tags,
      importance,
      is_pinned: isPinned,
      sensitivity,
      expires_at: args.expires_at ?? null,
      supersedes: trim(args.supersedes) || null,
      source_type: trim(args.source_type) || (rawText ? 'raw_text' : 'structured'),
      source_ref: trim(args.source_ref) || null,
      source: trim(args.source) || 'agentsam_memory_commit',
      value_json: args.value_json && typeof args.value_json === 'object' ? args.value_json : null,
      content_hash: contentHash,
      idempotency_key: idempotencyKey,
      retrieval_text: retrievalText,
      long_content_route: route,
      embedding: { routing_task: 'memory_embed' },
      desired_projections: [...DESIRED_PROJECTIONS],
    },
  };
}
