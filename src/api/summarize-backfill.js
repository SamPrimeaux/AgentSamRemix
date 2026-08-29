/**
 * POST /api/internal/summarize-backfill — queue summarize-thread for sessions missing summaries.
 */
import { jsonResponse } from '../core/responses.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js'; import { getAuthUser } from '../../backend/identity/index.js';
import {
  listD1SessionsNeedingSummary,
  queueSummarizeThreadBatch,
} from '../core/summarize-thread.js';

/**
 * @param {Request} request
 * @param {any} env
 */
export async function handleSummarizeBackfill(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const internalOk = verifyBridgeKey(request, env);
  if (!internalOk) {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const limit = Math.min(100, Math.max(1, Number(body.limit) || 50));
  const batchSize = Math.min(10, Math.max(1, Number(body.batch_size) || 5));
  const delayMs = Math.max(0, Number(body.delay_ms) || 500);

  const candidates = await listD1SessionsNeedingSummary(env, { limit });
  if (!candidates.length) {
    return jsonResponse({
      ok: true,
      queued: 0,
      candidates: 0,
      message: 'No sessions need summarization',
    });
  }

  const results = await queueSummarizeThreadBatch(env, candidates, { batchSize, delayMs });
  const invoked = results.filter((r) => r.invoked).length;
  const succeeded = results.filter((r) => r.invoked && r.ok).length;

  return jsonResponse({
    ok: true,
    candidates: candidates.length,
    queued: invoked,
    succeeded,
    failed: invoked - succeeded,
    results: results.slice(0, 25),
  });
}
