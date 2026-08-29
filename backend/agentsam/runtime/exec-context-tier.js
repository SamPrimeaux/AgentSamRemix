/**
 * Unified context tier — hot KV / warm R2 / cold digest.
 * Sprint 1A: exec session snapshots + chat compaction helpers.
 */

export const CHAT_SOFT_TOKEN_LIMIT = 14_000;
export const CHAT_COMPACT_TOKEN_THRESHOLD = 12_000;
export const CHAT_KV_TTL_SEC = 900;
export const EXEC_KV_TTL_SEC = 900;

/** @param {{ userId: string, workspaceId: string, conversationId: string }} input */
export function chatSessionR2Prefix({ userId, workspaceId, conversationId }) {
  const au = String(userId || '').trim();
  const ws = String(workspaceId || '').trim();
  const cv = String(conversationId || '').trim();
  return `context/${au}/${ws}/chats/${cv}`;
}

/** @param {{ tenantId: string, userId: string, sessionId: string }} input */
export function execSessionR2Prefix({ tenantId, userId, sessionId }) {
  const tenant = String(tenantId || '').trim();
  const user = String(userId || '').trim();
  const sid = String(sessionId || '').trim();
  return `context/${tenant}/${user}/exec/${sid}`;
}

/** @param {any} env */
export function resolveContextBucket(env) {
  return env?.AUTORAG_BUCKET ?? env?.R2 ?? null;
}

/** @param {string} str */
export function estimateContextTokens(str) {
  return Math.ceil(String(str || '').length / 4);
}

/** @param {any} env @param {string} key */
export async function readR2Text(env, key) {
  const bucket = resolveContextBucket(env);
  if (!bucket || !key) return null;
  try {
    const obj = await bucket.get(key);
    if (!obj) return null;
    return await obj.text();
  } catch {
    return null;
  }
}

/** @param {any} env @param {string} key @param {string} body @param {string} contentType */
export async function writeR2Text(env, key, body, contentType = 'application/json') {
  const bucket = resolveContextBucket(env);
  if (!bucket || !key) return false;
  try {
    await bucket.put(key, body, { httpMetadata: { contentType } });
    return true;
  } catch (e) {
    console.warn('[exec-context-tier] R2 write failed', key, e?.message ?? e);
    return false;
  }
}

/**
 * @param {Array<{ role?: string, content?: string }>} messages
 */
export function estimateMessagesTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((sum, m) => {
    try {
      return sum + estimateContextTokens(JSON.stringify(m ?? ''));
    } catch {
      return sum + estimateContextTokens(m?.content);
    }
  }, 0);
}

/**
 * Build a plain-text digest from chat messages for cold tier storage.
 * @param {Array<{ role?: string, content?: string, ts?: string }>} messages
 */
export function buildChatDigestText(messages) {
  const lines = (Array.isArray(messages) ? messages : [])
    .slice(-40)
    .map((m) => {
      const role = String(m?.role || 'unknown').toUpperCase();
      const content = String(m?.content || '').replace(/\s+/g, ' ').trim().slice(0, 400);
      return content ? `[${role}] ${content}` : null;
    })
    .filter(Boolean);
  return `# Session digest\n\n${lines.join('\n\n')}\n`;
}

/** TTFT penalty for Thompson priors — pure helper for tests + routing.js */
export const TTFT_INTERACTIVE_PENALTY_MS = 8000;
const TTFT_LATENCY_INSENSITIVE_MODES = new Set(['plan', 'multitask']);

/**
 * @param {number} successAlpha
 * @param {{ avgLatencyMs?: number, sampleN?: number, mode?: string }} opts
 */
export function applyTtftPenaltyToAlpha(successAlpha, opts = {}) {
  const mode = String(opts.mode || 'agent').trim().toLowerCase();
  if (TTFT_LATENCY_INSENSITIVE_MODES.has(mode)) return successAlpha;
  const sampleN = Math.max(0, Math.floor(Number(opts.sampleN) || 0));
  const avgLat = Number(opts.avgLatencyMs) || 0;
  if (sampleN >= 5 && avgLat > TTFT_INTERACTIVE_PENALTY_MS) {
    return successAlpha * 0.7;
  }
  return successAlpha;
}
