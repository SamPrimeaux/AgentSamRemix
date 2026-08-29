import {
  MEMORY_DEFAULT_CONFIDENCE,
  MEMORY_DEFAULT_IMPORTANCE,
  MEMORY_DEFAULT_LIMIT,
  MEMORY_MAX_LIMIT,
} from './constants.js';

export function normalizeMemoryContent(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function requireNonEmptyString(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new TypeError(`${field} is required`);
  }
  return normalized;
}

export function clamp01(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

export function normalizeLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return MEMORY_DEFAULT_LIMIT;
  return Math.max(1, Math.min(MEMORY_MAX_LIMIT, Math.trunc(n)));
}

export function nowUnix(nowMs = Date.now()) {
  return Math.floor(Number(nowMs) / 1000);
}

export function nullableString(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeExpiresAtUnix(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new TypeError('expiresAtUnix must be a positive unixepoch integer');
  }
  return n;
}

export function normalizeMemoryInput(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('memory input is required');
  }

  const content = normalizeMemoryContent(input.content);
  if (!content) throw new TypeError('content is required');

  return {
    workspaceId: requireNonEmptyString(input.workspaceId, 'workspaceId'),
    content,
    memoryType: String(input.memoryType ?? 'fact').trim() || 'fact',
    subjectId: nullableString(input.subjectId),
    agentId: nullableString(input.agentId),
    tenantId: nullableString(input.tenantId),
    importance: clamp01(input.importance, MEMORY_DEFAULT_IMPORTANCE),
    confidence: clamp01(input.confidence, MEMORY_DEFAULT_CONFIDENCE),
    sourceType: nullableString(input.sourceType ?? input.source),
    sourceId: nullableString(input.sourceId),
    metadata: isPlainObject(input.metadata) ? input.metadata : {},
    expiresAtUnix: normalizeExpiresAtUnix(input.expiresAtUnix),
  };
}

export function normalizeMemorySearch(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('memory search input is required');
  }

  return {
    workspaceId: requireNonEmptyString(input.workspaceId, 'workspaceId'),
    query: requireNonEmptyString(input.query, 'query'),
    limit: normalizeLimit(input.limit),
    subjectId: nullableString(input.subjectId),
    memoryType: nullableString(input.memoryType),
    minConfidence: clamp01(input.minConfidence, 0),
    includeExpired: Boolean(input.includeExpired),
  };
}

/**
 * Persistence does not extract memories from chat.
 * Callers decide whether to remember; this only rejects empty/invalid rows.
 */
export function shouldRemember(input) {
  return normalizeMemoryContent(input?.content).length > 0;
}

export function isTemporary(input) {
  const type = String(input?.memoryType ?? '').trim();
  return type === 'context' || input?.expiresAtUnix != null;
}

export function canShareAcrossAgents(input) {
  const share = input?.metadata?.shareAcrossAgents;
  if (share === false) return false;
  return true;
}

export function shouldExpire(row, now = nowUnix()) {
  const expires = Number(row?.expires_at_unix);
  return Number.isInteger(expires) && expires > 0 && expires <= now;
}

export function shouldSupersede(oldRow, nextInput) {
  if (!oldRow || !nextInput) return false;
  if (oldRow.workspace_id !== nextInput.workspaceId) return false;
  if (!oldRow.is_active) return false;
  if (nextInput.content && nextInput.content !== oldRow.content) return true;
  return false;
}
