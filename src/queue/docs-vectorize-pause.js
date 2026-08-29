/**
 * Pause / circuit-break for autorag → AGENTSAM_VECTORIZE_DOCUMENTS embeds.
 * Uses provider_circuit_breaker.provider = 'openai_embeddings' (epoch ints).
 */
import { isOpenAiBillingOrQuotaError } from '../core/agentsam-vectorize.js';

export const DOCS_EMBED_CIRCUIT_PROVIDER = 'openai_embeddings';
const DEFAULT_PAUSE_SEC = 24 * 60 * 60;

/**
 * Hard env pause or open D1 circuit.
 * @param {any} env
 * @returns {Promise<{ paused: boolean, reason: string|null }>}
 */
export async function getDocsVectorizePauseState(env) {
  if (String(env?.DOCS_VECTORIZE_PAUSE || '').trim() === '1') {
    return { paused: true, reason: 'DOCS_VECTORIZE_PAUSE=1' };
  }
  if (String(env?.DOCS_VECTORIZE_ENABLED || '').trim() === '0') {
    return { paused: true, reason: 'DOCS_VECTORIZE_ENABLED=0' };
  }
  if (!env?.DB) return { paused: false, reason: null };

  const now = Math.floor(Date.now() / 1000);
  try {
    const row = await env.DB.prepare(
      `SELECT status, auto_reset_at, last_error
       FROM provider_circuit_breaker WHERE provider = ? LIMIT 1`,
    )
      .bind(DOCS_EMBED_CIRCUIT_PROVIDER)
      .first();
    if (!row || String(row.status) !== 'open') return { paused: false, reason: null };

    const resetAt = row.auto_reset_at != null ? Number(row.auto_reset_at) : null;
    if (resetAt != null && Number.isFinite(resetAt) && resetAt > 0 && resetAt <= now) {
      await env.DB.prepare(
        `UPDATE provider_circuit_breaker
         SET status = 'closed', opened_at = NULL, auto_reset_at = NULL,
             failure_count = 0, updated_at = ?
         WHERE provider = ?`,
      )
        .bind(now, DOCS_EMBED_CIRCUIT_PROVIDER)
        .run();
      return { paused: false, reason: null };
    }
    return {
      paused: true,
      reason: `circuit_open:${String(row.last_error || 'openai_embeddings').slice(0, 120)}`,
    };
  } catch (e) {
    console.warn('[docs-vectorize-pause] read failed', e?.message ?? e);
    return { paused: false, reason: null };
  }
}

/**
 * Open the embeddings circuit so queue consumers stop calling OpenAI.
 * @param {any} env
 * @param {unknown} err
 * @param {{ ttlSec?: number }} [opts]
 */
export async function tripDocsVectorizeEmbedCircuit(env, err, opts = {}) {
  if (!env?.DB) return;
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max(60, Number(opts.ttlSec) || DEFAULT_PAUSE_SEC);
  const msg = String(
    err && typeof err === 'object' && 'message' in err ? err.message : err || 'quota',
  ).slice(0, 500);
  try {
    await env.DB.prepare(
      `INSERT INTO provider_circuit_breaker (
         provider, status, failure_count, last_failure_at, last_error,
         opened_at, auto_reset_at, success_count_since_half_open, updated_at
       ) VALUES (?, 'open', 1, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(provider) DO UPDATE SET
         status = 'open',
         failure_count = COALESCE(provider_circuit_breaker.failure_count, 0) + 1,
         last_failure_at = excluded.last_failure_at,
         last_error = excluded.last_error,
         opened_at = COALESCE(provider_circuit_breaker.opened_at, excluded.opened_at),
         auto_reset_at = excluded.auto_reset_at,
         updated_at = excluded.updated_at`,
    )
      .bind(DOCS_EMBED_CIRCUIT_PROVIDER, now, msg, now, now + ttl, now)
      .run();
    console.warn('[docs-vector-index] circuit OPEN', {
      provider: DOCS_EMBED_CIRCUIT_PROVIDER,
      ttl_sec: ttl,
      error: msg.slice(0, 160),
    });
  } catch (e) {
    console.warn('[docs-vectorize-pause] trip failed', e?.message ?? e);
  }
}

/**
 * @param {unknown} err
 */
export function shouldTripDocsVectorizeCircuit(err) {
  return (
    (err && typeof err === 'object' && err.code === 'embedding_quota_exhausted') ||
    isOpenAiBillingOrQuotaError(err)
  );
}
