/**
 * source_client + cost_basis for tool_call_log / daily tool stats board.
 * Write-time stamping preferred; model-family inference is NULL-backfill only.
 */

export const SOURCE_CLIENTS = Object.freeze([
  'chatgpt',
  'claude_ai',
  'cursor',
  'dashboard',
  'internal_agent',
  'unknown',
]);

export const COST_BASES = Object.freeze([
  'api_metered',
  'external_subscription',
  'platform_included',
  'unknown',
]);

const SOURCE_SET = new Set(SOURCE_CLIENTS);

/**
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeSourceClient(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (SOURCE_SET.has(s)) return s;
  if (/chatgpt|openai/.test(s)) return 'chatgpt';
  if (/claude_ai|claude\.ai|anthropic/.test(s) || s === 'claude') return 'claude_ai';
  if (/cursor/.test(s)) return 'cursor';
  if (/dashboard|catalog|web/.test(s)) return 'dashboard';
  if (/internal|agent_sam|agentsam|in[_-]?app/.test(s)) return 'internal_agent';
  if (/mcp_bridge|mcp/.test(s) && !/chatgpt|claude|cursor/.test(s)) return 'unknown';
  return null;
}

/**
 * @param {{
 *   source_client?: unknown,
 *   client_surface?: unknown,
 *   clientSurface?: unknown,
 *   actor_source?: unknown,
 *   mode?: unknown,
 * }} ctx
 */
export function resolveSourceClientForToolLog(ctx = {}) {
  const explicit =
    normalizeSourceClient(ctx.source_client) ||
    normalizeSourceClient(ctx.client_surface) ||
    normalizeSourceClient(ctx.clientSurface) ||
    normalizeSourceClient(ctx.actor_source);
  if (explicit) return explicit;

  const mode = String(ctx.mode || '')
    .trim()
    .toLowerCase();
  if (mode === 'mcp_agent') return 'unknown';
  if (['agent', 'ask', 'plan', 'debug', 'multitask', 'codemode'].includes(mode)) {
    return 'internal_agent';
  }
  return 'unknown';
}

/**
 * @param {{ source_client?: unknown, mode?: unknown, model_key?: unknown }} row
 */
export function inferSourceClientForBackfill(row = {}) {
  const stored = normalizeSourceClient(row.source_client);
  if (stored) return stored;

  const mode = String(row.mode || '')
    .trim()
    .toLowerCase();
  const mk = String(row.model_key || '')
    .trim()
    .toLowerCase();

  if (mode === 'mcp_agent') {
    if (/^gpt|^o[1-9]|openai|chatgpt/.test(mk)) return 'chatgpt';
    if (/^claude|anthropic|sonnet|opus|haiku/.test(mk)) return 'claude_ai';
    return 'unknown';
  }
  if (['agent', 'ask', 'plan', 'debug', 'multitask', 'codemode'].includes(mode)) {
    return 'internal_agent';
  }
  return 'unknown';
}

/**
 * @param {string} sourceClient
 * @returns {'api_metered'|'external_subscription'|'platform_included'|'unknown'}
 */
export function costBasisForSourceClient(sourceClient) {
  const sc = normalizeSourceClient(sourceClient) || String(sourceClient || '').trim();
  if (sc === 'internal_agent' || sc === 'dashboard') return 'api_metered';
  if (sc === 'chatgpt' || sc === 'claude_ai' || sc === 'cursor') return 'external_subscription';
  return 'unknown';
}
